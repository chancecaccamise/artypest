import { readString } from '@/lib/format'
import { ENTITY_TYPE_LABELS, type Entity, type EntityType } from '@/lib/data/types'

/*
  Global search.

  Stands in for the Postgres side of this, which is a `search_vector` column, a
  pg_trgm index, and a trigger to maintain it. The ranking rules here are the
  ones that will be expressed as weights in `ts_rank` later, so the behaviour a
  board member learns now is the behaviour they keep.

  Two things shape the design. There are over ten thousand records, almost all
  of them county parcels, so this runs over an index built once rather than
  re-reading every record on every keystroke. And a board member searching
  "10 whitaker" is typing an address from memory, not a query: tokens have to
  match in any order, across fields, without needing the punctuation right.
*/

/** Fields that would add noise rather than recall. */
const IGNORED_FIELDS = new Set(['notes'])

/*
  Fields worth showing under the name in a result, in the order they are tried.
  An address tells a reader which record they are looking at; a zoning code does
  not.
*/
const DETAIL_FIELDS = [
  'situsAddress',
  'mailingAddress',
  'countyOwnerName',
  'lotNumber',
  'pin',
  'neighborhood',
]

export interface SearchDocument {
  id: string
  type: EntityType
  name: string
  /** What is shown under the name in a result. */
  detail: string
  nameKey: string
  detailKey: string
  /** Name, detail, and every other searchable value, lowercased. */
  haystack: string
}

export interface SearchHit {
  entity: Entity
  document: SearchDocument
  score: number
  /** Which part of the record matched, for the result to explain itself. */
  matchedOn: 'name' | 'detail' | 'other'
}

/**
 * Lowercases, drops the punctuation people leave out when typing from memory,
 * and collapses whitespace.
 *
 * `1402 E. 49th St.` and `1402 e 49th st` have to reduce to the same thing, and
 * a PIN typed `20003-15001` has to find `20003 15001`.
 */
export function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,'’#/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query)
  return normalized === '' ? [] : normalized.split(' ')
}

function detailFor(entity: Entity): string {
  for (const field of DETAIL_FIELDS) {
    const value = readString(entity.data[field])
    // A property whose name is already its address should not repeat it.
    if (value !== '' && value.toLowerCase() !== entity.name.toLowerCase()) return value
  }
  return ENTITY_TYPE_LABELS[entity.type].singular
}

/**
 * Builds the searchable form of every record, once.
 *
 * Every string and number in `data` is indexed rather than a fixed list of
 * fields, because the per-type field lists are still provisional: a whitelist
 * here would quietly stop finding things the day a field is renamed.
 */
export function buildSearchIndex(entities: readonly Entity[]): SearchDocument[] {
  const documents: SearchDocument[] = []

  for (const entity of entities) {
    if (entity.deletedAt !== null) continue

    const detail = detailFor(entity)
    const parts: string[] = [entity.name, detail]

    for (const [key, value] of Object.entries(entity.data)) {
      if (IGNORED_FIELDS.has(key)) continue
      if (typeof value === 'string') parts.push(value)
      else if (typeof value === 'number') parts.push(String(value))
    }

    documents.push({
      id: entity.id,
      type: entity.type,
      name: entity.name,
      detail,
      nameKey: normalizeSearchText(entity.name),
      detailKey: normalizeSearchText(detail),
      haystack: normalizeSearchText(parts.join(' ')),
    })
  }

  return documents
}

function containsAll(haystack: string, tokens: readonly string[]): boolean {
  return tokens.every((token) => haystack.includes(token))
}

/*
  Archived records still answer, because "where did that lot go" is a real
  question, but they rank below live ones.
*/
const ARCHIVED_PENALTY = 0.4

/**
 * Scores one record against the query.
 *
 * The order is deliberate: an exact name beats a name that starts with the
 * query, which beats a name containing all the words, which beats a match in
 * the address, which beats a match anywhere else. Shorter names win ties,
 * because `10 Whitaker St` is a better answer than `1005 Whitaker St Unit B`
 * for someone who typed `10 whitaker`.
 */
function scoreDocument(
  document: SearchDocument,
  query: string,
  tokens: readonly string[]
): { score: number; matchedOn: SearchHit['matchedOn'] } | null {
  const normalizedQuery = normalizeSearchText(query)

  if (document.nameKey === normalizedQuery) return { score: 1000, matchedOn: 'name' }
  if (document.nameKey.startsWith(normalizedQuery)) return { score: 800, matchedOn: 'name' }
  if (containsAll(document.nameKey, tokens)) return { score: 600, matchedOn: 'name' }
  if (document.detailKey.startsWith(normalizedQuery)) return { score: 500, matchedOn: 'detail' }
  if (containsAll(document.detailKey, tokens)) return { score: 400, matchedOn: 'detail' }
  if (containsAll(document.haystack, tokens)) return { score: 200, matchedOn: 'other' }

  return null
}

export interface SearchOptions {
  limit?: number
  /** Restrict to one kind of record. */
  type?: EntityType | null
}

/**
 * Runs a query against a prebuilt index.
 *
 * `byId` is passed rather than looked up, so a caller holding the entity list
 * does not pay to build a map on every keystroke.
 */
export function searchEntities(
  index: readonly SearchDocument[],
  byId: ReadonlyMap<string, Entity>,
  query: string,
  options: SearchOptions = {}
): SearchHit[] {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return []

  const limit = options.limit ?? 20
  const hits: SearchHit[] = []

  for (const document of index) {
    if (options.type && document.type !== options.type) continue

    const scored = scoreDocument(document, query, tokens)
    if (!scored) continue

    const entity = byId.get(document.id)
    if (!entity) continue

    hits.push({
      entity,
      document,
      score: entity.archivedAt === null ? scored.score : scored.score * ARCHIVED_PENALTY,
      matchedOn: scored.matchedOn,
    })
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // A shorter name is the more specific answer.
    if (a.document.name.length !== b.document.name.length) {
      return a.document.name.length - b.document.name.length
    }
    return a.document.name.localeCompare(b.document.name)
  })

  return hits.slice(0, limit)
}

/** Results grouped for display, in the order the groups should be shown. */
export interface SearchGroup {
  type: EntityType
  label: string
  hits: SearchHit[]
}

export function groupHits(hits: readonly SearchHit[]): SearchGroup[] {
  const groups = new Map<EntityType, SearchHit[]>()

  for (const hit of hits) {
    const existing = groups.get(hit.entity.type)
    if (existing) existing.push(hit)
    else groups.set(hit.entity.type, [hit])
  }

  // Insertion order, so the strongest match decides which group leads.
  return [...groups.entries()].map(([type, groupHits]) => ({
    type,
    label: ENTITY_TYPE_LABELS[type].plural,
    hits: groupHits,
  }))
}

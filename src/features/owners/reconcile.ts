import type { Entity } from '@/lib/data/types'
import { normalizeOwnerName, parseOwner, type ParsedOwner } from '@/lib/parcels/owner'
import { normalizePin } from '@/lib/parcels/pin'

/*
  Reconciling the county's owner field against the directory, across the whole
  parcel layer at once.

  The parcel import already does this for a handful of parcels at a time, one
  screen and one decision each. That is the right shape for an import somebody
  is watching. It is the wrong shape for 16,656 parcels and 13,528 distinct
  owner names, which is what the harvested layer holds.

  Two things make the bulk case different.

  Scale. `findOwnerMatch` walks the candidate list per owner, which is fine for
  sixty parcels and is 13,528 walks of several thousand candidates here. The
  candidates are indexed once instead.

  Asymmetry of risk. Creating a record is safe and reversible: at worst there is
  a duplicate to merge. Linking a parcel to an existing person is neither. A
  confident wrong link silently attaches somebody's house to a stranger, and
  nothing on the screen afterwards says it happened. So the two are not held to
  the same standard: creation is allowed on a confident parse, linking needs
  either a byte-identical name or a confident parse behind it, and everything
  else waits for a human.
*/

export type OwnerVerdict = 'link' | 'create' | 'review' | 'skip'

export interface OwnerGroup {
  /** The county's string, exactly as filed. The key for the whole group. */
  raw: string
  parsed: ParsedOwner
  /** Every parcel this owner name holds. One owner, many lots. */
  pins: string[]
  /** The property records for those parcels. */
  propertyIds: string[]
  /** An existing directory record this name resolves to. */
  match: Entity | null
  matchConfidence: 'exact' | 'normalized' | null
  verdict: OwnerVerdict
  /** Why, in words a board member can read. Shown in the review queue. */
  reason: string
}

export interface ReconcileInput {
  /** Property records carrying `pin` and the county owner name in `data`. */
  properties: readonly Entity[]
  /** People, businesses and associations already in the directory. */
  candidates: readonly Entity[]
}

/** How the county's owner name is stored on a property record. */
function ownerNameOf(property: Entity): string {
  const raw = property.data.countyOwnerRaw ?? property.data.countyOwnerName
  return typeof raw === 'string' ? raw.trim() : ''
}

function pinOf(property: Entity): string {
  const pin = property.data.pin
  return typeof pin === 'string' ? normalizePin(pin) : ''
}

/**
 * An index of the directory, keyed the way owner names are compared.
 *
 * Built once. The exact map is keyed on the trimmed name and the normalised map
 * on the sorted, punctuation-stripped form, which is what makes
 * `SMITH JOHN A` and `John A. Smith` the same key.
 */
interface CandidateIndex {
  byExact: Map<string, Entity>
  byNormalized: Map<string, Entity>
}

export function indexCandidates(candidates: readonly Entity[]): CandidateIndex {
  const byExact = new Map<string, Entity>()
  const byNormalized = new Map<string, Entity>()

  for (const candidate of candidates) {
    const trimmed = candidate.name.trim()
    if (trimmed === '') continue
    // First writer wins, so the oldest record is preferred over a later
    // duplicate. Reconciliation should converge on what is already there.
    if (!byExact.has(trimmed)) byExact.set(trimmed, candidate)

    const key = normalizeOwnerName(trimmed)
    if (key !== '' && !byNormalized.has(key)) byNormalized.set(key, candidate)
  }

  return { byExact, byNormalized }
}

function lookup(
  raw: string,
  parsed: ParsedOwner,
  index: CandidateIndex
): { match: Entity; confidence: 'exact' | 'normalized' } | null {
  const trimmed = raw.trim()

  const exact = index.byExact.get(trimmed)
  if (exact) return { match: exact, confidence: 'exact' }

  const key = normalizeOwnerName(trimmed)
  if (key !== '') {
    const normalized = index.byNormalized.get(key)
    if (normalized) return { match: normalized, confidence: 'normalized' }
  }

  /*
    A joint owner string does not normalise onto either person on its own, so
    the people it names are tried before giving up. `BELZER NATHAN C & ALLISON S`
    should find Nathan Belzer if he is already in the directory.
  */
  for (const person of parsed.people) {
    const personKey = normalizeOwnerName(person.display)
    if (personKey === '') continue
    const found = index.byNormalized.get(personKey)
    if (found) return { match: found, confidence: 'normalized' }
  }

  return null
}

/**
 * What should happen to one owner name, and why.
 *
 * Exported for the tests, because the rule is the feature: everything else here
 * is grouping and indexing.
 */
export function decide(
  parsed: ParsedOwner,
  match: { match: Entity; confidence: 'exact' | 'normalized' } | null
): { verdict: OwnerVerdict; reason: string } {
  if (parsed.raw.trim() === '') {
    return { verdict: 'skip', reason: 'The county records no owner for this lot.' }
  }

  /*
    Truncated at 40 characters before it reached us, so the name is incomplete
    and cannot be completed by anything. Never linked and never created from,
    because both would file a record under a name that is missing its end.
  */
  if (parsed.truncated) {
    return {
      verdict: 'review',
      reason: 'The county truncated this name at 40 characters, so it is incomplete.',
    }
  }

  if (match) {
    /*
      A byte-identical name is the one case where linking needs no further
      evidence: the directory already holds this exact string.
    */
    if (match.confidence === 'exact') {
      return { verdict: 'link', reason: `Already in the directory as ${match.match.name}.` }
    }

    if (parsed.confidence === 'high') {
      return {
        verdict: 'link',
        reason: `Reads as ${match.match.name}, which is already in the directory.`,
      }
    }

    /*
      A near match on a name nobody could parse confidently is exactly the
      shape of a wrong link, so it is the one that waits for a human.
    */
    return {
      verdict: 'review',
      reason: `Looks like ${match.match.name}, but the name could not be read confidently.`,
    }
  }

  if (parsed.confidence === 'high') {
    const kind = parsed.government ? 'government body' : parsed.kind
    return { verdict: 'create', reason: `Not in the directory. Reads as a ${kind}.` }
  }

  return {
    verdict: 'review',
    reason: 'Not in the directory, and the name could not be read confidently.',
  }
}

/**
 * Groups every property by its county owner name and decides what to do with
 * each.
 *
 * Grouped rather than listed per parcel because an owner is one record however
 * many lots they hold: 1,286 owners here hold more than one, and one of them
 * holds 170. Deciding per parcel would ask the same question 170 times and risk
 * 170 different answers.
 */
export function reconcileOwners({ properties, candidates }: ReconcileInput): OwnerGroup[] {
  const index = indexCandidates(candidates)
  const groups = new Map<string, { raw: string; pins: string[]; propertyIds: string[] }>()

  for (const property of properties) {
    if (property.deletedAt !== null) continue
    const raw = ownerNameOf(property)
    if (raw === '') continue

    // Keyed case-insensitively: the county is not consistent about capitals.
    const key = raw.toUpperCase()
    const group = groups.get(key)
    const pin = pinOf(property)

    if (group) {
      if (pin !== '') group.pins.push(pin)
      group.propertyIds.push(property.id)
    } else {
      groups.set(key, { raw, pins: pin === '' ? [] : [pin], propertyIds: [property.id] })
    }
  }

  const result: OwnerGroup[] = []
  for (const { raw, pins, propertyIds } of groups.values()) {
    const parsed = parseOwner(raw)
    const match = lookup(raw, parsed, index)
    const { verdict, reason } = decide(parsed, match)

    result.push({
      raw,
      parsed,
      pins,
      propertyIds,
      match: match?.match ?? null,
      matchConfidence: match?.confidence ?? null,
      verdict,
      reason,
    })
  }

  /*
    Most lots first. An owner holding 170 parcels is worth a human's attention
    before one holding a single lot, whichever way the decision goes.
  */
  result.sort(
    (a, b) => b.propertyIds.length - a.propertyIds.length || a.raw.localeCompare(b.raw)
  )
  return result
}

export interface ReconcileSummary {
  owners: number
  parcels: number
  link: number
  create: number
  review: number
  skip: number
  /** Of the review pile, how many are beyond recovery rather than merely unclear. */
  truncated: number
}

export function summarizeOwners(groups: readonly OwnerGroup[]): ReconcileSummary {
  const summary: ReconcileSummary = {
    owners: groups.length,
    parcels: 0,
    link: 0,
    create: 0,
    review: 0,
    skip: 0,
    truncated: 0,
  }

  for (const group of groups) {
    summary.parcels += group.propertyIds.length
    summary[group.verdict] += 1
    if (group.parsed.truncated) summary.truncated += 1
  }

  return summary
}

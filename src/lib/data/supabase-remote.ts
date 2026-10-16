import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'
import {
  auditFromRow,
  entityFromRow,
  entityToRow,
  orgFromRow,
  orgUserFromRow,
  referenceItemFromRow,
  relationFromRow,
  relationToRow,
  relationTypeFromRow,
  type AuditQuery,
  type EntityChanges,
  type RelationChanges,
  type RemoteChanges,
  type RemoteSnapshot,
  type RemoteStore,
  type SharedDatabase,
  type WriteContext,
} from './remote'
import type { AuditEntry, Entity, Org, ReferenceItem, Relation } from './types'

/*
  The shared records, in Supabase.

  Thin on purpose: every method is one PostgREST call and a row mapping. What
  to write and when lives in SyncedProvider. Row level security decides what
  any of this can see, so the org id is only ever used to fill in a row, never
  to decide access.
*/

/** PostgREST returns at most this many rows a request on Supabase's defaults. */
const PAGE = 1000

/** The batch and source headers the audit trigger reads. See 20261016130000. */
function headersFor(context: WriteContext): Record<string, string> {
  const headers: Record<string, string> = {}
  if (context.batchId) headers['x-artypest-batch'] = context.batchId
  if (context.source !== 'hand') headers['x-artypest-source'] = context.source
  return headers
}

function fail(what: string, error: PostgrestError): never {
  throw new Error(`${what} could not be saved to the shared records: ${error.message}`)
}

export function createSupabaseRemote(
  base: SupabaseClient<Database>,
  orgId: string
): RemoteStore {
  /*
    Typed against the schema the migrations describe rather than the one the
    generated file last saw. See SharedDatabase in remote.ts.
  */
  const client = base as unknown as SupabaseClient<SharedDatabase>

  /** Every row of a table, a page at a time, in a stable order. */
  async function everyRow<Row>(
    fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>
  ): Promise<Row[]> {
    const rows: Row[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await fetchPage(from, from + PAGE - 1)
      if (error) throw new Error(`The shared records could not be read: ${error.message}`)
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) return rows
    }
  }

  /** The request with the audit headers for `context` attached. */
  function withHeaders<B extends { setHeader(name: string, value: string): B }>(
    builder: B,
    context: WriteContext
  ): B {
    let next = builder
    for (const [name, value] of Object.entries(headersFor(context))) {
      next = next.setHeader(name, value)
    }
    return next
  }

  async function importAuditSince(since: string | null): Promise<AuditEntry[]> {
    const rows = await everyRow((from, to) => {
      let query = client.from('audit_entries').select('*').eq('source', 'import')
      if (since) query = query.gte('changed_at', since)
      return query.order('id').range(from, to)
    })
    return rows.map(auditFromRow)
  }

  return {
    async loadAll(): Promise<RemoteSnapshot> {
      const [org, types, items, users, entities, relations, importAudit] = await Promise.all([
        client.from('orgs').select('*').eq('id', orgId).single(),
        client.from('relation_types').select('*').order('key'),
        client.from('reference_items').select('*').order('list').order('sort_order'),
        client.from('org_users').select('*').order('name'),
        everyRow((from, to) => client.from('entities').select('*').order('id').range(from, to)),
        everyRow((from, to) => client.from('relations').select('*').order('id').range(from, to)),
        importAuditSince(null),
      ])

      for (const result of [org, types, items, users]) {
        if (result.error) {
          throw new Error(`The shared records could not be read: ${result.error.message}`)
        }
      }
      if (!org.data) throw new Error('This account is not a member of any association.')

      return {
        org: orgFromRow(org.data),
        relationTypes: (types.data ?? []).map(relationTypeFromRow),
        referenceItems: (items.data ?? []).map(referenceItemFromRow),
        users: (users.data ?? []).map(orgUserFromRow),
        entities: entities.map(entityFromRow),
        relations: relations.map(relationFromRow),
        importAudit,
      }
    },

    async loadChangedSince(since: string): Promise<RemoteChanges> {
      const [entities, relations, importAudit] = await Promise.all([
        everyRow((from, to) =>
          client.from('entities').select('*').gte('updated_at', since).order('id').range(from, to)
        ),
        everyRow((from, to) =>
          client.from('relations').select('*').gte('updated_at', since).order('id').range(from, to)
        ),
        importAuditSince(since),
      ])
      return {
        entities: entities.map(entityFromRow),
        relations: relations.map(relationFromRow),
        importAudit,
      }
    },

    async materialize(entities: readonly Entity[], relations: readonly Relation[]): Promise<void> {
      if (entities.length === 0 && relations.length === 0) return
      const { error } = await client.rpc('materialize_records', {
        entity_rows: entities.map(entityToRow) as unknown as Json,
        relation_rows: relations.map(relationToRow) as unknown as Json,
      })
      if (error) fail('A county record', error)
    },

    async insertEntity(entity: Entity, context: WriteContext): Promise<Entity> {
      const row = entityToRow(entity)
      const builder = client
        .from('entities')
        .insert({
          id: row.id,
          org_id: row.org_id,
          type: row.type,
          name: row.name,
          data: row.data,
          folder_id: row.folder_id,
        })
        .select('*')
        .single()
      const { data, error } = await withHeaders(builder, context)
      if (error) fail(`"${entity.name}"`, error)
      return entityFromRow(data)
    },

    async updateEntity(id: string, changes: EntityChanges, context: WriteContext): Promise<Entity> {
      const update: SharedDatabase['public']['Tables']['entities']['Update'] = {}
      if (changes.name !== undefined) update.name = changes.name
      if (changes.folderId !== undefined) update.folder_id = changes.folderId
      if (changes.data !== undefined) update.data = changes.data as Json
      if (changes.archivedAt !== undefined) update.archived_at = changes.archivedAt
      if (changes.deletedAt !== undefined) update.deleted_at = changes.deletedAt
      if (changes.reviewedAt !== undefined) update.reviewed_at = changes.reviewedAt

      const builder = client.from('entities').update(update).eq('id', id).select('*').single()
      const { data, error } = await withHeaders(builder, context)
      if (error) fail('The change', error)
      return entityFromRow(data)
    },

    async insertRelation(relation: Relation, context: WriteContext): Promise<Relation> {
      const row = relationToRow(relation)
      const builder = client
        .from('relations')
        .insert({
          id: row.id,
          org_id: row.org_id,
          relation_type_id: row.relation_type_id,
          from_entity_id: row.from_entity_id,
          to_entity_id: row.to_entity_id,
          start_date: row.start_date,
          end_date: row.end_date,
          attributes: row.attributes,
        })
        .select('*')
        .single()
      const { data, error } = await withHeaders(builder, context)
      if (error) fail('The connection', error)
      return relationFromRow(data)
    },

    async updateRelation(
      id: string,
      changes: RelationChanges,
      context: WriteContext
    ): Promise<Relation> {
      const update: Database['public']['Tables']['relations']['Update'] = {}
      if (changes.relationTypeId !== undefined) update.relation_type_id = changes.relationTypeId
      if (changes.fromEntityId !== undefined) update.from_entity_id = changes.fromEntityId
      if (changes.toEntityId !== undefined) update.to_entity_id = changes.toEntityId
      if (changes.startDate !== undefined) update.start_date = changes.startDate
      if (changes.endDate !== undefined) update.end_date = changes.endDate
      if (changes.deletedAt !== undefined) update.deleted_at = changes.deletedAt

      const builder = client.from('relations').update(update).eq('id', id).select('*').single()
      const { data, error } = await withHeaders(builder, context)
      if (error) fail('The connection', error)
      return relationFromRow(data)
    },

    async updateOrg(changes): Promise<Org> {
      const update: Database['public']['Tables']['orgs']['Update'] = {}
      if (changes.name !== undefined) update.name = changes.name
      if (changes.sagisUrlTemplate !== undefined) update.sagis_url_template = changes.sagisUrlTemplate
      const { data, error } = await client
        .from('orgs')
        .update(update)
        .eq('id', orgId)
        .select('*')
        .single()
      if (error) fail('The association settings', error)
      return orgFromRow(data)
    },

    async insertReferenceItem(item: ReferenceItem): Promise<ReferenceItem> {
      const { data, error } = await client
        .from('reference_items')
        .insert({
          id: item.id,
          org_id: item.orgId,
          list: item.list,
          value: item.value,
          label: item.label,
          sort_order: item.sortOrder,
          active: item.active,
        })
        .select('*')
        .single()
      if (error) fail(`"${item.label}"`, error)
      return referenceItemFromRow(data)
    },

    async updateReferenceItem(id, changes): Promise<ReferenceItem> {
      const update: Database['public']['Tables']['reference_items']['Update'] = {}
      if (changes.label !== undefined) update.label = changes.label
      if (changes.sortOrder !== undefined) update.sort_order = changes.sortOrder
      if (changes.active !== undefined) update.active = changes.active
      const { data, error } = await client
        .from('reference_items')
        .update(update)
        .eq('id', id)
        .select('*')
        .single()
      if (error) fail('The list item', error)
      return referenceItemFromRow(data)
    },

    async listAuditEntries(recordId: string): Promise<AuditEntry[]> {
      const rows = await everyRow((from, to) =>
        client
          .from('audit_entries')
          .select('*')
          .eq('record_id', recordId)
          .order('changed_at', { ascending: false })
          .range(from, to)
      )
      return rows.map(auditFromRow)
    },

    async listAudit(query: AuditQuery): Promise<{ rows: AuditEntry[]; total: number }> {
      let request = client.from('audit_entries').select('*', { count: 'exact' })
      if (query.action) request = request.eq('action', query.action)
      if (query.actor) request = request.eq('changed_by', query.actor)
      if (query.batchId) request = request.eq('batch_id', query.batchId)
      if (query.source) request = request.eq('source', query.source)
      if (query.since) request = request.gte('changed_at', query.since)
      if (query.from) request = request.gte('changed_at', query.from)
      // Inclusive of the whole last day.
      if (query.to) request = request.lt('changed_at', nextDay(query.to))

      const { data, error, count } = await request
        .order('changed_at', { ascending: false })
        .range(query.offset, query.offset + query.limit - 1)
      if (error) throw new Error(`The activity log could not be read: ${error.message}`)
      return { rows: (data ?? []).map(auditFromRow), total: count ?? 0 }
    },

    async listActors(): Promise<string[]> {
      const { data, error } = await client.rpc('audit_actors')
      if (error) throw new Error(`The activity log could not be read: ${error.message}`)
      return data ?? []
    },
  }
}

function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

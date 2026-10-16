import { getActiveActor } from '@/lib/data/actor'
import type {
  AuditQuery,
  EntityChanges,
  RelationChanges,
  RemoteSnapshot,
  RemoteStore,
  WriteContext,
} from '@/lib/data/remote'
import type {
  AuditEntry,
  Entity,
  Org,
  OrgUser,
  ReferenceItem,
  Relation,
  RelationType,
} from '@/lib/data/types'

/*
  The shared database, in memory, for testing SyncedProvider.

  Does what the triggers do, in as much detail as the provider can observe:
  one audit row per changed field (keys inside `data` separately), the hand
  mark claimed by a hand write and not by an import, and nothing at all for a
  record copied in from the county layer. The SQL itself is tested against a
  real Postgres in supabase/schema.test.ts; this only has to agree with it.
*/

export interface FakeRemote extends RemoteStore {
  /** Who the next writes are attributed to, as the signed-in session would be. */
  actAs(actor: string): void
  /** Everything copied in from the county layer, in order. */
  materialized: string[]
  entityRows(): Entity[]
  auditRows(): AuditEntry[]
}

export interface FakeRemoteSeed {
  org: Org
  relationTypes: RelationType[]
  referenceItems?: ReferenceItem[]
  users?: OrgUser[]
  entities?: Entity[]
  relations?: Relation[]
}

const clone = <T>(value: T): T => structuredClone(value)

export function createFakeRemote(seed: FakeRemoteSeed): FakeRemote {
  const entities = new Map((seed.entities ?? []).map((row) => [row.id, clone(row)]))
  const relations = new Map((seed.relations ?? []).map((row) => [row.id, clone(row)]))
  const audit: AuditEntry[] = []
  let org = clone(seed.org)
  let referenceItems = clone(seed.referenceItems ?? [])
  /** Null follows the signed-in account, as the database's session would. */
  let explicitActor: string | null = null
  const who = () => explicitActor ?? getActiveActor()
  let clock = Date.now()
  const materialized: string[] = []

  // Real time, but strictly increasing, so "changed since" is never ambiguous in a test.
  const tick = () => {
    clock = Math.max(clock + 1, Date.now())
    return new Date(clock).toISOString()
  }

  const log = (
    context: WriteContext,
    tableName: AuditEntry['tableName'],
    recordId: string,
    action: AuditEntry['action'],
    fieldName: string | null = null,
    oldValue: string | null = null,
    newValue: string | null = null
  ) => {
    audit.push({
      id: crypto.randomUUID(),
      orgId: org.id,
      tableName,
      recordId,
      action,
      fieldName,
      oldValue,
      newValue,
      changedBy: who(),
      changedAt: new Date(clock).toISOString(),
      source: context.source,
      batchId: context.batchId,
    })
  }

  const text = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null
    return typeof value === 'string' ? value : JSON.stringify(value)
  }

  return {
    actAs(next) {
      explicitActor = next
    },
    materialized,
    entityRows: () => [...entities.values()].map(clone),
    auditRows: () => clone(audit),

    loadAll(): Promise<RemoteSnapshot> {
      return Promise.resolve({
        org: clone(org),
        relationTypes: clone(seed.relationTypes),
        referenceItems: clone(referenceItems),
        users: clone(seed.users ?? []),
        entities: [...entities.values()].map(clone),
        relations: [...relations.values()].map(clone),
        importAudit: audit.filter((entry) => entry.source === 'import').map(clone),
      })
    },

    loadChangedSince(since) {
      return Promise.resolve({
        entities: [...entities.values()].filter((row) => row.updatedAt >= since).map(clone),
        relations: [...relations.values()].filter((row) => row.updatedAt >= since).map(clone),
        importAudit: audit
          .filter((entry) => entry.source === 'import' && entry.changedAt >= since)
          .map(clone),
      })
    },

    materialize(newEntities, newRelations) {
      for (const row of newEntities) {
        if (entities.has(row.id)) continue
        entities.set(row.id, clone(row))
        materialized.push(row.id)
      }
      for (const row of newRelations) {
        if (relations.has(row.id)) continue
        if (!entities.has(row.fromEntityId) || !entities.has(row.toEntityId)) {
          return Promise.reject(new Error('foreign key violation'))
        }
        relations.set(row.id, clone(row))
        materialized.push(row.id)
      }
      return Promise.resolve()
    },

    insertEntity(entity, context) {
      const now = tick()
      const hand = context.source === 'hand'
      const row: Entity = {
        ...clone(entity),
        createdAt: now,
        updatedAt: now,
        reviewedAt: hand ? now : null,
        reviewedBy: hand ? who() : null,
      }
      entities.set(row.id, row)
      log(context, 'entities', row.id, 'insert')
      return Promise.resolve(clone(row))
    },

    updateEntity(id, changes: EntityChanges, context) {
      const row = entities.get(id)
      if (!row) return Promise.reject(new Error(`No row ${id}`))
      const now = tick()
      let moved = false

      if (changes.name !== undefined && changes.name !== row.name) {
        log(context, 'entities', id, 'update', 'name', row.name, changes.name)
        row.name = changes.name
        moved = true
      }
      if (changes.data !== undefined) {
        const keys = new Set([...Object.keys(row.data), ...Object.keys(changes.data)])
        for (const key of keys) {
          const before = text(row.data[key])
          const after = text(changes.data[key])
          if (before === after) continue
          log(context, 'entities', id, 'update', `data.${key}`, before, after)
          moved = true
        }
        row.data = clone(changes.data)
      }
      for (const field of ['archivedAt', 'deletedAt', 'folderId'] as const) {
        const next = changes[field]
        if (next === undefined || next === row[field]) continue
        log(context, 'entities', id, 'update', field, row[field], next)
        row[field] = next
        moved = true
      }
      if (changes.reviewedAt !== undefined && changes.reviewedAt !== row.reviewedAt) {
        log(context, 'entities', id, 'update', 'reviewedAt', row.reviewedAt, changes.reviewedAt)
        row.reviewedAt = changes.reviewedAt
        row.reviewedBy = changes.reviewedAt === null ? null : who()
      } else if (moved && context.source === 'hand') {
        log(context, 'entities', id, 'update', 'reviewedAt', row.reviewedAt, now)
        row.reviewedAt = now
        row.reviewedBy = who()
      }
      row.updatedAt = now
      return Promise.resolve(clone(row))
    },

    insertRelation(relation, context) {
      if (!entities.has(relation.fromEntityId) || !entities.has(relation.toEntityId)) {
        return Promise.reject(new Error('foreign key violation'))
      }
      const now = tick()
      const row: Relation = { ...clone(relation), createdAt: now, updatedAt: now }
      relations.set(row.id, row)
      log(context, 'relations', row.id, 'insert')
      return Promise.resolve(clone(row))
    },

    updateRelation(id, changes: RelationChanges, context) {
      const row = relations.get(id)
      if (!row) return Promise.reject(new Error(`No relation ${id}`))
      const now = tick()
      for (const field of [
        'relationTypeId',
        'fromEntityId',
        'toEntityId',
        'startDate',
        'endDate',
        'deletedAt',
      ] as const) {
        const next = changes[field]
        if (next === undefined || next === row[field]) continue
        log(context, 'relations', id, 'update', field, row[field], next)
        Object.assign(row, { [field]: next })
      }
      row.updatedAt = now
      return Promise.resolve(clone(row))
    },

    updateOrg(changes) {
      org = { ...org, ...changes }
      return Promise.resolve(clone(org))
    },

    insertReferenceItem(item) {
      referenceItems = [...referenceItems, clone(item)]
      return Promise.resolve(clone(item))
    },

    updateReferenceItem(id, changes) {
      referenceItems = referenceItems.map((item) => (item.id === id ? { ...item, ...changes } : item))
      const found = referenceItems.find((item) => item.id === id)
      return found ? Promise.resolve(clone(found)) : Promise.reject(new Error(`No item ${id}`))
    },

    listAuditEntries(recordId) {
      return Promise.resolve(
        audit
          .filter((entry) => entry.recordId === recordId)
          .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
          .map(clone)
      )
    },

    listAudit(query: AuditQuery) {
      const rows = audit
        .filter((entry) => !query.action || entry.action === query.action)
        .filter((entry) => !query.actor || entry.changedBy === query.actor)
        .filter((entry) => !query.batchId || entry.batchId === query.batchId)
        .filter((entry) => !query.source || entry.source === query.source)
        .filter((entry) => !query.since || entry.changedAt >= query.since)
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
      return Promise.resolve({
        rows: rows.slice(query.offset, query.offset + query.limit).map(clone),
        total: rows.length,
      })
    },

    listActors() {
      return Promise.resolve(
        [...new Set(audit.map((entry) => entry.changedBy).filter((value) => value !== null))].sort()
      )
    },
  }
}

import {
  DEMO_AUDIT_ENTRIES,
  DEMO_ENTITIES,
  DEMO_ORG,
  DEMO_RELATIONS,
  DEMO_RELATION_TYPES,
} from './fixtures'
import type {
  AuditEntry,
  DataProvider,
  Entity,
  EntityInput,
  EntityPatch,
  ListEntitiesOptions,
  Org,
  Page,
  Relation,
  RelationType,
} from './types'

/*
  Temporary in-memory provider. Holds state for the lifetime of the tab and
  resets on reload. It exists so the UI can be built and reviewed before the
  local Supabase stack is set up.

  It deliberately mimics two behaviours the Postgres schema will own, so the
  UI written against it does not have to change later:

    1. Soft delete and archive are separate states, not a single flag.
    2. Updates write one audit row per changed field, which is what makes the
       History tab a field-level diff rather than a list of "record updated".
*/

const DEFAULT_PAGE_SIZE = 25

/** Stand-in for auth. The Supabase provider will read this from the session. */
const CURRENT_USER = 'Demo User'

function clone<T>(value: T): T {
  return structuredClone(value)
}

let sequence = 0

function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence.toString().padStart(4, '0')}`
}

/**
 * Renders a value the way an audit row stores it: a string, or null.
 * Objects are JSON so a nested `data` change is still readable in the diff.
 */
function toAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

class MemoryProvider implements DataProvider {
  readonly kind = 'memory' as const

  private org: Org = clone(DEMO_ORG)
  private entities: Entity[] = clone(DEMO_ENTITIES)
  private relations: Relation[] = clone(DEMO_RELATIONS)
  private relationTypes: RelationType[] = clone(DEMO_RELATION_TYPES)
  private auditEntries: AuditEntry[] = clone(DEMO_AUDIT_ENTRIES)

  getOrg(): Promise<Org> {
    return Promise.resolve(clone(this.org))
  }

  listEntities(options: ListEntitiesOptions = {}): Promise<Page<Entity>> {
    const { type, search, page = 1, pageSize = DEFAULT_PAGE_SIZE, include = 'active' } = options

    let rows = this.entities.filter((entity) => {
      switch (include) {
        case 'active':
          return entity.deletedAt === null && entity.archivedAt === null
        case 'archived':
          return entity.deletedAt === null && entity.archivedAt !== null
        case 'deleted':
          return entity.deletedAt !== null
        case 'all':
          return true
      }
    })

    if (type) {
      rows = rows.filter((entity) => entity.type === type)
    }

    if (search && search.trim() !== '') {
      // Stands in for the pg_trgm search_vector index.
      const needle = search.trim().toLowerCase()
      rows = rows.filter(
        (entity) =>
          entity.name.toLowerCase().includes(needle) ||
          JSON.stringify(entity.data).toLowerCase().includes(needle)
      )
    }

    rows.sort((a, b) => a.name.localeCompare(b.name))

    const total = rows.length
    const start = (page - 1) * pageSize

    return Promise.resolve({
      rows: clone(rows.slice(start, start + pageSize)),
      total,
      page,
      pageSize,
    })
  }

  getEntity(id: string): Promise<Entity | null> {
    const found = this.entities.find((entity) => entity.id === id)
    return Promise.resolve(found ? clone(found) : null)
  }

  createEntity(input: EntityInput): Promise<Entity> {
    const now = new Date().toISOString()
    const entity: Entity = {
      id: nextId('ent'),
      orgId: this.org.id,
      type: input.type,
      name: input.name,
      data: input.data ?? {},
      folderId: input.folderId ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      archivedAt: null,
    }

    this.entities.push(entity)
    this.recordAudit(entity.id, 'insert', null, null, null, now)

    return Promise.resolve(clone(entity))
  }

  updateEntity(id: string, patch: EntityPatch): Promise<Entity> {
    const entity = this.requireEntity(id)
    const now = new Date().toISOString()

    if (patch.name !== undefined && patch.name !== entity.name) {
      this.recordAudit(id, 'update', 'name', entity.name, patch.name, now)
      entity.name = patch.name
    }

    if (patch.folderId !== undefined && patch.folderId !== entity.folderId) {
      this.recordAudit(id, 'update', 'folderId', entity.folderId, patch.folderId, now)
      entity.folderId = patch.folderId
    }

    if (patch.data !== undefined) {
      // One audit row per changed key inside the JSONB blob, not one for the blob.
      const keys = new Set([...Object.keys(entity.data), ...Object.keys(patch.data)])
      for (const key of keys) {
        const before = toAuditValue(entity.data[key])
        const after = toAuditValue(patch.data[key])
        if (before !== after) {
          this.recordAudit(id, 'update', `data.${key}`, before, after, now)
        }
      }
      entity.data = { ...patch.data }
    }

    entity.updatedAt = now
    return Promise.resolve(clone(entity))
  }

  archiveEntity(id: string): Promise<Entity> {
    return Promise.resolve(this.setLifecycleField(id, 'archivedAt', new Date().toISOString()))
  }

  deleteEntity(id: string): Promise<Entity> {
    return Promise.resolve(this.setLifecycleField(id, 'deletedAt', new Date().toISOString()))
  }

  /** Clears both archive and soft delete, whichever was set. */
  restoreEntity(id: string): Promise<Entity> {
    const entity = this.requireEntity(id)
    if (entity.archivedAt !== null) {
      this.setLifecycleField(id, 'archivedAt', null)
    }
    if (entity.deletedAt !== null) {
      this.setLifecycleField(id, 'deletedAt', null)
    }
    return Promise.resolve(clone(entity))
  }

  listRelationTypes(): Promise<RelationType[]> {
    return Promise.resolve(clone(this.relationTypes))
  }

  listRelations(entityId?: string): Promise<Relation[]> {
    const rows = this.relations.filter((relation) => {
      if (relation.deletedAt !== null) return false
      if (!entityId) return true
      // One stored row serves both directions. Match either end.
      return relation.fromEntityId === entityId || relation.toEntityId === entityId
    })
    return Promise.resolve(clone(rows))
  }

  listAuditEntries(recordId: string): Promise<AuditEntry[]> {
    const rows = this.auditEntries
      .filter((entry) => entry.recordId === recordId)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    return Promise.resolve(clone(rows))
  }

  private requireEntity(id: string): Entity {
    const entity = this.entities.find((candidate) => candidate.id === id)
    if (!entity) {
      throw new Error(`No entity with id ${id}`)
    }
    return entity
  }

  private setLifecycleField(
    id: string,
    field: 'archivedAt' | 'deletedAt',
    value: string | null
  ): Entity {
    const entity = this.requireEntity(id)
    const now = value ?? new Date().toISOString()

    this.recordAudit(id, 'update', field, entity[field], value, now)
    entity[field] = value
    entity.updatedAt = now

    return clone(entity)
  }

  private recordAudit(
    recordId: string,
    action: AuditEntry['action'],
    fieldName: string | null,
    oldValue: string | null,
    newValue: string | null,
    changedAt: string
  ): void {
    this.auditEntries.push({
      id: nextId('aud'),
      orgId: this.org.id,
      tableName: 'entities',
      recordId,
      action,
      fieldName,
      oldValue,
      newValue,
      changedBy: CURRENT_USER,
      changedAt,
    })
  }
}

export function createMemoryProvider(): DataProvider {
  return new MemoryProvider()
}

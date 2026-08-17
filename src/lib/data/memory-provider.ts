import { readString } from '../format'
import { centroidForPin } from '../geo'
import { geocodeSync } from '../geocoding'
import { resolveGraph } from '../insights'
import { resolveAllLocations, resolveLocation, type ResolveContext } from '../locations/resolve'
import { buildDemoData, type DemoData } from './fixtures'
import { ENTITY_TYPES } from './types'
import type {
  ActivityEntry,
  AuditEntry,
  DataProvider,
  Entity,
  EntityInput,
  EntityPatch,
  EntityType,
  ListActivityOptions,
  ListEntitiesOptions,
  LocationIndex,
  Org,
  OrgPatch,
  OrgUser,
  Page,
  ReferenceItem,
  ReferenceItemInput,
  ReferenceItemPatch,
  ReferenceList,
  Relation,
  RelationInput,
  RelationType,
  ResolvedLocation,
} from './types'

/*
  Temporary in-memory provider. Holds state for the lifetime of the tab and
  resets on reload. It exists so the UI can be built and reviewed before the
  local Supabase stack is set up.

  It deliberately mimics three behaviours the Postgres schema will own, so the
  UI written against it does not have to change later:

    1. Soft delete and archive are separate states, not a single flag.
    2. Updates write one audit row per changed field, which is what makes the
       History tab a field-level diff rather than a list of "record updated".
    3. Relation changes are audited too. "Unit 42 changed hands" is the
       highest-value entry in the log.
*/

const DEFAULT_PAGE_SIZE = 50

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
  if (typeof value === 'string') return value === '' ? null : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

class MemoryProvider implements DataProvider {
  readonly kind = 'memory' as const

  private org: Org
  private entities: Entity[]
  private relations: Relation[]
  private relationTypes: RelationType[]
  private auditEntries: AuditEntry[]
  private referenceItems: ReferenceItem[]
  private users: OrgUser[]

  /** Set while runBatch is in flight, so every audit row it causes is grouped. */
  private currentBatchId: string | null = null


  constructor(data: DemoData) {
    this.org = clone(data.org)
    this.entities = clone(data.entities)
    this.relations = clone(data.relations)
    this.relationTypes = clone(data.relationTypes)
    this.auditEntries = clone(data.auditEntries)
    this.referenceItems = clone(data.referenceItems)
    this.users = clone(data.users)
  }

  /* ----------------------------------------------------------------- org -- */

  getOrg(): Promise<Org> {
    return Promise.resolve(clone(this.org))
  }

  updateOrg(patch: OrgPatch): Promise<Org> {
    const now = new Date().toISOString()

    if (patch.name !== undefined && patch.name !== this.org.name) {
      this.recordAudit('entities', this.org.id, 'update', 'name', this.org.name, patch.name, now)
      this.org.name = patch.name
    }

    if (patch.sagisUrlTemplate !== undefined && patch.sagisUrlTemplate !== this.org.sagisUrlTemplate) {
      this.recordAudit(
        'entities',
        this.org.id,
        'update',
        'sagisUrlTemplate',
        this.org.sagisUrlTemplate,
        patch.sagisUrlTemplate,
        now
      )
      this.org.sagisUrlTemplate = patch.sagisUrlTemplate
    }

    return Promise.resolve(clone(this.org))
  }

  /* ------------------------------------------------------------ entities -- */

  listEntities(options: ListEntitiesOptions = {}): Promise<Page<Entity>> {
    const {
      type,
      search,
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
      include = 'active',
      sortBy = 'name',
      sortDir = 'asc',
      dataFilters,
    } = options

    let rows = this.entities.filter((entity) => this.matchesInclude(entity, include))

    if (type) {
      rows = rows.filter((entity) => entity.type === type)
    }

    if (dataFilters) {
      for (const [key, value] of Object.entries(dataFilters)) {
        if (value === '') continue
        rows = rows.filter((entity) => readString(entity.data[key]) === value)
      }
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

    const direction = sortDir === 'asc' ? 1 : -1
    rows = rows.slice().sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name) * direction
      return a[sortBy].localeCompare(b[sortBy]) * direction
    })

    const total = rows.length
    const start = (page - 1) * pageSize

    return Promise.resolve({
      rows: clone(rows.slice(start, start + pageSize)),
      total,
      page,
      pageSize,
    })
  }

  listAllEntities(): Promise<Entity[]> {
    return Promise.resolve(clone(this.entities.filter((entity) => entity.deletedAt === null)))
  }

  countsByType(): Promise<Record<EntityType, number>> {
    const counts = Object.fromEntries(ENTITY_TYPES.map((type) => [type, 0])) as Record<
      EntityType,
      number
    >

    for (const entity of this.entities) {
      if (entity.deletedAt !== null || entity.archivedAt !== null) continue
      counts[entity.type] += 1
    }

    return Promise.resolve(counts)
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
    this.recordAudit('entities', entity.id, 'insert', null, null, null, now)

    return Promise.resolve(clone(entity))
  }

  updateEntity(id: string, patch: EntityPatch): Promise<Entity> {
    const entity = this.requireEntity(id)
    const now = new Date().toISOString()

    if (patch.name !== undefined && patch.name !== entity.name) {
      this.recordAudit('entities', id, 'update', 'name', entity.name, patch.name, now)
      entity.name = patch.name
    }

    if (patch.folderId !== undefined && patch.folderId !== entity.folderId) {
      this.recordAudit('entities', id, 'update', 'folderId', entity.folderId, patch.folderId, now)
      entity.folderId = patch.folderId
    }

    if (patch.data !== undefined) {
      // One audit row per changed key inside the JSONB blob, not one for the blob.
      const keys = new Set([...Object.keys(entity.data), ...Object.keys(patch.data)])
      for (const key of keys) {
        const before = toAuditValue(entity.data[key])
        const after = toAuditValue(patch.data[key])
        if (before !== after) {
          this.recordAudit('entities', id, 'update', `data.${key}`, before, after, now)
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

  /* ----------------------------------------------------------- relations -- */

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

  createRelation(input: RelationInput): Promise<Relation> {
    const now = new Date().toISOString()
    const relation: Relation = {
      id: nextId('rel'),
      orgId: this.org.id,
      relationTypeId: input.relationTypeId,
      fromEntityId: input.fromEntityId,
      toEntityId: input.toEntityId,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      attributes: input.attributes ?? {},
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      archivedAt: null,
    }

    this.relations.push(relation)
    this.recordAudit('relations', relation.id, 'insert', null, null, null, now)

    return Promise.resolve(clone(relation))
  }

  deleteRelation(id: string): Promise<Relation> {
    const relation = this.relations.find((candidate) => candidate.id === id)
    if (!relation) throw new Error(`No relation with id ${id}`)

    const now = new Date().toISOString()
    this.recordAudit('relations', id, 'delete', 'deletedAt', null, now, now)
    relation.deletedAt = now
    relation.updatedAt = now

    return Promise.resolve(clone(relation))
  }

  /* ------------------------------------------------------------ location -- */

  /*
    Location is resolved, never stored, so these read through the cascade in
    src/lib/locations. In Postgres this becomes a view and these three methods
    become queries against it, which is why they sit on the provider rather
    than in the map feature.
  */

  private resolveContext(): ResolveContext {
    return {
      graph: resolveGraph({
        entities: this.entities,
        relations: this.relations.filter((relation) => relation.deletedAt === null),
        relationTypes: this.relationTypes,
      }),
      centroidForPin,
      geocode: geocodeSync,
    }
  }

  resolveLocation(entityId: string): Promise<ResolvedLocation | null> {
    const entity = this.entities.find((candidate) => candidate.id === entityId)
    if (!entity) return Promise.resolve(null)
    return Promise.resolve(resolveLocation(entity, this.resolveContext()))
  }

  listLocations(): Promise<LocationIndex> {
    return Promise.resolve(resolveAllLocations(this.resolveContext()))
  }

  setManualLocation(
    entityId: string,
    point: [longitude: number, latitude: number] | null
  ): Promise<Entity> {
    const entity = this.requireEntity(entityId)
    // Routed through updateEntity so the placement is audited like any other
    // field change, which is what makes "who moved this pin" answerable.
    const data = { ...entity.data }
    if (point === null) delete data.location
    else data.location = point

    return this.updateEntity(entityId, { data })
  }

  /* --------------------------------------------------------------- audit -- */

  listAuditEntries(recordId: string): Promise<AuditEntry[]> {
    const rows = this.auditEntries
      .filter((entry) => entry.recordId === recordId)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    return Promise.resolve(clone(rows))
  }

  listActivity(options: ListActivityOptions = {}): Promise<Page<ActivityEntry>> {
    const { entityType, action, actor, from, to, batchId, page = 1, pageSize = 100 } = options

    let rows = this.auditEntries.map((entry) => this.resolveActivity(entry))

    if (entityType) rows = rows.filter((entry) => entry.entityType === entityType)
    if (action) rows = rows.filter((entry) => entry.action === action)
    if (actor) rows = rows.filter((entry) => entry.changedBy === actor)
    if (batchId) rows = rows.filter((entry) => entry.batchId === batchId)
    // Dates are inclusive on both ends, compared on the date part only.
    if (from) rows = rows.filter((entry) => entry.changedAt.slice(0, 10) >= from)
    if (to) rows = rows.filter((entry) => entry.changedAt.slice(0, 10) <= to)

    rows.sort((a, b) => b.changedAt.localeCompare(a.changedAt))

    const total = rows.length
    const start = (page - 1) * pageSize

    return Promise.resolve({
      rows: clone(rows.slice(start, start + pageSize)),
      total,
      page,
      pageSize,
    })
  }

  listActors(): Promise<string[]> {
    const actors = new Set<string>()
    for (const entry of this.auditEntries) {
      if (entry.changedBy) actors.add(entry.changedBy)
    }
    return Promise.resolve([...actors].sort((a, b) => a.localeCompare(b)))
  }

  /* ----------------------------------------------------------- reference -- */

  listReferenceItems(list?: ReferenceList): Promise<ReferenceItem[]> {
    const rows = this.referenceItems
      .filter((item) => (list ? item.list === list : true))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    return Promise.resolve(clone(rows))
  }

  createReferenceItem(input: ReferenceItemInput): Promise<ReferenceItem> {
    const siblings = this.referenceItems.filter((item) => item.list === input.list)
    const item: ReferenceItem = {
      id: nextId('ref'),
      orgId: this.org.id,
      list: input.list,
      // The stored value is a slug, so renaming the label never rewrites data.
      value: input.value ?? input.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      label: input.label,
      sortOrder: input.sortOrder ?? siblings.length,
      active: input.active ?? true,
    }
    this.referenceItems.push(item)
    return Promise.resolve(clone(item))
  }

  updateReferenceItem(id: string, patch: ReferenceItemPatch): Promise<ReferenceItem> {
    const item = this.referenceItems.find((candidate) => candidate.id === id)
    if (!item) throw new Error(`No reference item with id ${id}`)

    if (patch.label !== undefined) item.label = patch.label
    if (patch.sortOrder !== undefined) item.sortOrder = patch.sortOrder
    if (patch.active !== undefined) item.active = patch.active

    return Promise.resolve(clone(item))
  }

  /* --------------------------------------------------------------- users -- */

  listUsers(): Promise<OrgUser[]> {
    return Promise.resolve(clone(this.users))
  }

  /* -------------------------------------------------------------- batch -- */

  async runBatch<T>(work: () => Promise<T>): Promise<{ batchId: string; result: T }> {
    const batchId = nextId('batch')
    const previous = this.currentBatchId
    this.currentBatchId = batchId
    try {
      const result = await work()
      return { batchId, result }
    } finally {
      this.currentBatchId = previous
    }
  }

  /* ------------------------------------------------------------ internal -- */

  private matchesInclude(entity: Entity, include: NonNullable<ListEntitiesOptions['include']>) {
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
  }

  /**
   * Resolves the subject of an audit row. For a relation change the subject is
   * the entity the relation starts from, because "Marguerite Hollis sold
   * 1207 E Washington" reads better than "relation rel-0001 changed".
   */
  private resolveActivity(entry: AuditEntry): ActivityEntry {
    let entityId: string | null = entry.recordId

    if (entry.tableName === 'relations') {
      const relation = this.relations.find((candidate) => candidate.id === entry.recordId)
      entityId = relation?.fromEntityId ?? null
    }

    const entity = entityId
      ? (this.entities.find((candidate) => candidate.id === entityId) ?? null)
      : null

    return {
      ...entry,
      entityId: entity?.id ?? null,
      entityName: entity?.name ?? null,
      entityType: entity?.type ?? null,
    }
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

    this.recordAudit('entities', id, 'update', field, entity[field], value, now)
    entity[field] = value
    entity.updatedAt = now

    return clone(entity)
  }

  private recordAudit(
    tableName: AuditEntry['tableName'],
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
      tableName,
      recordId,
      action,
      fieldName,
      oldValue,
      newValue,
      changedBy: CURRENT_USER,
      changedAt,
      batchId: this.currentBatchId,
    })
  }

  /*
    The whole store, for persistence and for the eventual migration into
    Postgres. Cloned, so a caller cannot reach in and mutate the store by
    holding on to what it was given.
  */
  snapshot(): DemoData {
    return {
      org: clone(this.org),
      entities: clone(this.entities),
      relations: clone(this.relations),
      relationTypes: clone(this.relationTypes),
      auditEntries: clone(this.auditEntries),
      referenceItems: clone(this.referenceItems),
      users: clone(this.users),
    }
  }

}

export function createMemoryProvider(data: DemoData = buildDemoData()): DataProvider {
  return new MemoryProvider(data)
}

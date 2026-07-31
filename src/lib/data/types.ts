/*
  Domain types and the data-access contract.

  These mirror the shape the Postgres schema will have, so the switch from the
  temporary in-memory provider to Supabase is a change of implementation only,
  not a change of call sites.

  Naming follows CLAUDE.md: Person, Property, Business, Association. Never the
  D&D vocabulary from the reference implementation.
*/

export const ENTITY_TYPES = [
  'person',
  'property',
  'business',
  'association',
  'asset',
  'document',
  'record',
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

/** Human-readable labels for UI copy. Board members read these, not developers. */
export const ENTITY_TYPE_LABELS: Record<EntityType, { singular: string; plural: string }> = {
  person: { singular: 'Person', plural: 'People' },
  property: { singular: 'Property', plural: 'Properties' },
  business: { singular: 'Business', plural: 'Businesses' },
  association: { singular: 'Association', plural: 'Associations' },
  asset: { singular: 'Asset', plural: 'Assets' },
  document: { singular: 'Document', plural: 'Documents' },
  record: { singular: 'Record', plural: 'Records' },
}

export interface Org {
  id: string
  name: string
  /** Municipal GIS viewers get replatformed, so the outbound URL is data, not code. */
  sagisUrlTemplate: string | null
  createdAt: string
}

/*
  One entities table with a type discriminator and a JSONB data column.
  Per-type fields live in `data`, typed per entity type by the Zod schemas in
  src/lib/validation once docs/BUILD-PLAN.md defines the field lists.
*/
export interface Entity {
  id: string
  orgId: string
  type: EntityType
  name: string
  data: Record<string, unknown>
  folderId: string | null
  createdAt: string
  updatedAt: string
  /** Soft delete. Distinct from archive, different meaning. */
  deletedAt: string | null
  /** Archive. The record is real and kept, just out of the active working set. */
  archivedAt: string | null
}

export interface RelationType {
  id: string
  orgId: string
  key: string
  /** Rendered on the forward edge, for example "owns". */
  label: string
  /** Rendered on the reverse edge, for example "is owned by". */
  reverseLabel: string
}

/*
  Bidirectionality is a read concern. One stored row, rendered both directions
  using label and reverseLabel.
*/
export interface Relation {
  id: string
  orgId: string
  relationTypeId: string
  fromEntityId: string
  toEntityId: string
  startDate: string | null
  endDate: string | null
  attributes: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  archivedAt: string | null
}

export type AuditAction = 'insert' | 'update' | 'delete'

/** One row per changed field, so history reads as a field-level diff. */
export interface AuditEntry {
  id: string
  orgId: string
  tableName: 'entities' | 'relations'
  recordId: string
  action: AuditAction
  fieldName: string | null
  oldValue: string | null
  newValue: string | null
  changedBy: string | null
  changedAt: string
}

export interface ListEntitiesOptions {
  type?: EntityType
  search?: string
  page?: number
  pageSize?: number
  /** Defaults to active only: neither deleted nor archived. */
  include?: 'active' | 'archived' | 'deleted' | 'all'
}

export interface Page<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export type EntityInput = Pick<Entity, 'type' | 'name'> & Partial<Pick<Entity, 'data' | 'folderId'>>

export type EntityPatch = Partial<Pick<Entity, 'name' | 'data' | 'folderId'>>

/*
  The seam. The temporary provider implements this against in-memory fixtures.
  The Supabase provider will implement the same contract against Postgres.
*/
export interface DataProvider {
  readonly kind: 'memory' | 'supabase'

  getOrg(): Promise<Org>

  listEntities(options?: ListEntitiesOptions): Promise<Page<Entity>>
  getEntity(id: string): Promise<Entity | null>
  createEntity(input: EntityInput): Promise<Entity>
  updateEntity(id: string, patch: EntityPatch): Promise<Entity>
  archiveEntity(id: string): Promise<Entity>
  restoreEntity(id: string): Promise<Entity>
  deleteEntity(id: string): Promise<Entity>

  listRelationTypes(): Promise<RelationType[]>
  listRelations(entityId?: string): Promise<Relation[]>

  /** Audit history for one record, newest first. */
  listAuditEntries(recordId: string): Promise<AuditEntry[]>
}

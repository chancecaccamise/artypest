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

export type OrgPatch = Partial<Pick<Org, 'name' | 'sagisUrlTemplate'>>

/*
  One entities table with a type discriminator and a JSONB data column.
  Per-type fields live in `data`, typed per entity type by the Zod schemas in
  src/lib/validation.
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
  /*
    When a person last checked this record against a source they trust, and who
    that person was. Real columns rather than keys inside `data`, because
    "everything nobody has checked yet" is a query the working list runs on
    every page load, and because review is the same question for all seven
    types. See docs/REVIEW-SPEC.md.
  */
  reviewedAt: string | null
  reviewedBy: string | null
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

export type RelationInput = Pick<Relation, 'relationTypeId' | 'fromEntityId' | 'toEntityId'> &
  Partial<Pick<Relation, 'startDate' | 'endDate' | 'attributes'>>

/**
 * Everything the store holds, in one object.
 *
 * The provider is constructed from one of these and can hand one back, which is
 * what makes both saving work locally and loading it into Postgres a matter of
 * moving data rather than reaching into the provider.
 */
export interface DataSnapshot {
  org: Org
  relationTypes: RelationType[]
  entities: Entity[]
  relations: Relation[]
  auditEntries: AuditEntry[]
  referenceItems: ReferenceItem[]
  users: OrgUser[]
}

export type AuditAction = 'insert' | 'update' | 'delete'

/**
 * Who or what wrote an audit row.
 *
 * This is the whole basis of the hand mark. `hand` is a person at a keyboard
 * changing one record; `import` is a bulk write from the county roll, however
 * many records it touched and whoever pressed the button; `system` is seeded
 * or derived data that nobody ever claimed.
 *
 * Attributing an import to the person who ran it would be true and useless:
 * the question the association actually asks is whether a human has read this
 * record, not whether a human started the job that wrote it.
 */
export type AuditSource = 'hand' | 'import' | 'system'

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
  /** Hand, import, or system. See AuditSource. */
  source: AuditSource
  /**
   * Groups the rows written by one user action, so the Activity feed can link
   * back to "the batch this came from". Postgres will set it per statement.
   */
  batchId: string | null
}

/**
 * An audit row with the subject resolved. The Postgres implementation gets
 * this from a view joining entities, which is why the join is not done in the
 * component layer.
 */
export interface ActivityEntry extends AuditEntry {
  entityId: string | null
  entityName: string | null
  entityType: EntityType | null
}

/** Reference lists the org maintains itself. Every row carries org_id. */
export const REFERENCE_LISTS = ['zoning', 'property_use', 'association_type', 'record_type'] as const

export type ReferenceList = (typeof REFERENCE_LISTS)[number]

export const REFERENCE_LIST_LABELS: Record<ReferenceList, string> = {
  zoning: 'Zoning districts',
  property_use: 'Property use',
  association_type: 'Association type',
  record_type: 'Record type',
}

export interface ReferenceItem {
  id: string
  orgId: string
  list: ReferenceList
  /** Stored on entities; renaming the label never rewrites stored values. */
  value: string
  label: string
  sortOrder: number
  active: boolean
}

export type ReferenceItemInput = Pick<ReferenceItem, 'list' | 'label'> &
  Partial<Pick<ReferenceItem, 'value' | 'sortOrder' | 'active'>>

export type ReferenceItemPatch = Partial<Pick<ReferenceItem, 'label' | 'sortOrder' | 'active'>>

/** Stubbed until real accounts arrive with the backend. */
export interface OrgUser {
  id: string
  orgId: string
  name: string
  email: string
  role: 'admin' | 'manager' | 'board' | 'resident'
  lastActiveAt: string | null
}

/*
  Location is resolved rather than stored. See docs/MAP-SPEC.md section 1 and
  src/lib/locations/resolve.ts for the cascade itself. The provider owns it
  because in Postgres it becomes a view, not a client-side walk.
*/
export type LocationSource =
  | 'manual'
  | 'parcel'
  | 'residence'
  | 'ownership'
  | 'geocoded'
  | 'related'
  | 'governed'

export interface ResolvedLocation {
  entityId: string
  /** Longitude first, as GeoJSON requires. */
  point: [longitude: number, latitude: number]
  source: LocationSource
  /** `exact` is the record's own location. `derived` was borrowed. */
  precision: 'exact' | 'derived'
  /** The record the location was borrowed from, when it was borrowed. */
  viaEntityId: string | null
  viaEntityName: string | null
  /** Board-readable. "Lives at 1147 E 46th St". */
  explanation: string
  /** Set when the location is a lot, so the plat can highlight the polygon. */
  pin: string | null
}

export interface LocationIndex {
  /** Entity id to its resolved location. Absent means unplaced. */
  byEntity: Map<string, ResolvedLocation>
  /** PIN to the property record drawn on that lot. */
  propertyByPin: Map<string, Entity>
  /** Records that resolved to nothing at all. A normal state, not an error. */
  unplaced: Entity[]
}

/*
  The hand mark.

  Three states, in the order a reader meets them:

    unchecked  nobody has read this record against anything
    checked    a person read it and said it was right
    recheck    a person checked it, and the county has written to it since

  `recheck` is the state that makes the other two worth storing. Without it a
  check is a claim about a record that quietly stops being true the next time
  the parcel import runs, and a stale green tick is worse than no tick.
*/
export type ReviewState = 'unchecked' | 'checked' | 'recheck'

export interface ReviewStatus {
  entityId: string
  state: ReviewState
  reviewedAt: string | null
  reviewedBy: string | null
  /** Field names the import has written since the check. Empty unless `recheck`. */
  changedSince: string[]
}

/**
 * Review status for every record that has ever been checked.
 *
 * Absent from `byEntity` means `unchecked`, which is the overwhelming majority:
 * the map ships 16,656 county lots and the association has read a few dozen of
 * them. Holding a row per checked record rather than per record is the
 * difference between a few kilobytes and a few megabytes.
 */
export interface ReviewIndex {
  byEntity: Map<string, ReviewStatus>
  /** Active, undeleted records that are checked and current, per type. */
  checkedByType: Record<EntityType, number>
  /** Active, undeleted records checked but written to since, per type. */
  recheckByType: Record<EntityType, number>
}

export interface ListEntitiesOptions {
  type?: EntityType
  search?: string
  page?: number
  pageSize?: number
  /** Defaults to active only: neither deleted nor archived. */
  include?: 'active' | 'archived' | 'deleted' | 'all'
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortDir?: 'asc' | 'desc'
  /** Matches against keys inside the JSONB `data` column. */
  dataFilters?: Record<string, string>
  /**
   * Narrows to one hand-mark state. This is what turns the directory into a
   * work queue: filter to `unchecked`, work down the list, watch it shrink.
   */
  review?: ReviewState
}

export interface ListActivityOptions {
  entityType?: EntityType
  action?: AuditAction
  actor?: string
  /** Inclusive ISO date, `YYYY-MM-DD`. */
  from?: string
  /** Inclusive ISO date, `YYYY-MM-DD`. */
  to?: string
  batchId?: string
  /**
   * Inclusive ISO timestamp. Distinct from `from`, which is a calendar date:
   * the work log asks for "since 9:12 this morning", not "since today".
   */
  since?: string
  source?: AuditSource
  page?: number
  pageSize?: number
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
  updateOrg(patch: OrgPatch): Promise<Org>

  listEntities(options?: ListEntitiesOptions): Promise<Page<Entity>>
  /** Every active entity. Used by the dashboard rollups and the Connection Map. */
  listAllEntities(): Promise<Entity[]>
  countsByType(): Promise<Record<EntityType, number>>
  getEntity(id: string): Promise<Entity | null>
  createEntity(input: EntityInput): Promise<Entity>
  updateEntity(id: string, patch: EntityPatch): Promise<Entity>
  archiveEntity(id: string): Promise<Entity>
  restoreEntity(id: string): Promise<Entity>
  deleteEntity(id: string): Promise<Entity>

  listRelationTypes(): Promise<RelationType[]>
  listRelations(entityId?: string): Promise<Relation[]>
  createRelation(input: RelationInput): Promise<Relation>
  deleteRelation(id: string): Promise<Relation>

  /** Where one record is, and where that answer came from. */
  resolveLocation(entityId: string): Promise<ResolvedLocation | null>
  /** Every record resolved at once, for the map. */
  listLocations(): Promise<LocationIndex>
  /** Places a record by hand. Passing null clears the placement. */
  setManualLocation(
    entityId: string,
    point: [longitude: number, latitude: number] | null
  ): Promise<Entity>

  /**
   * Marks a record as checked by hand, or clears the mark.
   *
   * Goes through the same write path as any other field change, so the check
   * is audited, appears in History as "Teresa Vaughn checked this record", and
   * shows up in the work log without the log needing a store of its own.
   */
  setReviewed(entityId: string, reviewed: boolean): Promise<Entity>
  /** Hand-mark state for every record that has one. */
  listReviewIndex(): Promise<ReviewIndex>

  /** The signed-in person, as the audit log records them. */
  getActor(): Promise<string>

  /** Audit history for one record, newest first. */
  listAuditEntries(recordId: string): Promise<AuditEntry[]>
  /** The global feed, newest first, with the subject entity resolved. */
  listActivity(options?: ListActivityOptions): Promise<Page<ActivityEntry>>
  /** Distinct actors, for the Activity page filter. */
  listActors(): Promise<string[]>

  listReferenceItems(list?: ReferenceList): Promise<ReferenceItem[]>
  createReferenceItem(input: ReferenceItemInput): Promise<ReferenceItem>
  updateReferenceItem(id: string, patch: ReferenceItemPatch): Promise<ReferenceItem>

  listUsers(): Promise<OrgUser[]>

  /**
   * The whole store, for saving work between page loads and for the eventual
   * migration into Postgres. A read: it changes nothing.
   */
  snapshot(): DataSnapshot

  /**
   * Runs `work` as one audited batch and returns the batch id alongside the
   * result, so the parcel import can link to exactly its own rows in Activity.
   */
  runBatch<T>(
    work: () => Promise<T>,
    source?: AuditSource
  ): Promise<{ batchId: string; result: T }>
}

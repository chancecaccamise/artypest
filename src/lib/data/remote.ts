import type { Database, Json } from '@/types/database'
import {
  ENTITY_TYPES,
  REFERENCE_LISTS,
  type AuditAction,
  type AuditEntry,
  type AuditSource,
  type Entity,
  type EntityType,
  type Org,
  type OrgUser,
  type ReferenceItem,
  type ReferenceList,
  type Relation,
  type RelationType,
} from './types'

/*
  What the shared records need from wherever they are kept.

  SyncedProvider talks to this, never to Supabase directly, so the logic that
  keeps every browser in step can be tested against an in-memory fake and the
  part that knows about PostgREST stays small. See supabase-remote.ts.
*/

/** Who is writing and why, carried onto every audit row the write causes. */
export interface WriteContext {
  batchId: string | null
  source: AuditSource
}

export interface RemoteSnapshot {
  org: Org
  relationTypes: RelationType[]
  referenceItems: ReferenceItem[]
  users: OrgUser[]
  entities: Entity[]
  relations: Relation[]
  /** Import rows only: they are what the hand mark reads. */
  importAudit: AuditEntry[]
}

export interface RemoteChanges {
  entities: Entity[]
  relations: Relation[]
  importAudit: AuditEntry[]
}

/** Columns an entity write can set. */
export type EntityChanges = Partial<
  Pick<Entity, 'name' | 'folderId' | 'data' | 'archivedAt' | 'deletedAt' | 'reviewedAt'>
>

export type RelationChanges = Partial<
  Pick<
    Relation,
    'relationTypeId' | 'fromEntityId' | 'toEntityId' | 'startDate' | 'endDate' | 'deletedAt'
  >
>

export interface AuditQuery {
  action?: AuditAction
  actor?: string
  batchId?: string
  source?: AuditSource
  /** Inclusive timestamp. */
  since?: string
  /** Inclusive dates, `YYYY-MM-DD`. */
  from?: string
  to?: string
  /** Zero-based, inclusive, as PostgREST ranges are. */
  offset: number
  limit: number
}

export interface RemoteStore {
  loadAll(): Promise<RemoteSnapshot>
  /** Everything written since `since`, by anyone. */
  loadChangedSince(since: string): Promise<RemoteChanges>
  /** Copies county-layer rows in as they are. No audit, no hand mark. */
  materialize(entities: readonly Entity[], relations: readonly Relation[]): Promise<void>

  insertEntity(entity: Entity, context: WriteContext): Promise<Entity>
  updateEntity(id: string, changes: EntityChanges, context: WriteContext): Promise<Entity>
  insertRelation(relation: Relation, context: WriteContext): Promise<Relation>
  updateRelation(id: string, changes: RelationChanges, context: WriteContext): Promise<Relation>

  updateOrg(changes: Partial<Pick<Org, 'name' | 'sagisUrlTemplate'>>): Promise<Org>
  insertReferenceItem(item: ReferenceItem): Promise<ReferenceItem>
  updateReferenceItem(
    id: string,
    changes: Partial<Pick<ReferenceItem, 'label' | 'sortOrder' | 'active'>>
  ): Promise<ReferenceItem>

  listAuditEntries(recordId: string): Promise<AuditEntry[]>
  /** Newest first, with the total that matched. */
  listAudit(query: AuditQuery): Promise<{ rows: AuditEntry[]; total: number }>
  listActors(): Promise<string[]>
}

/* -------------------------------------------------------- schema types -- */

/*
  The generated types, plus what migrations after they were generated add.

  src/types/database.ts is generated from the hosted project and never edited
  by hand. It was last generated before 20260902120000_review.sql reached the
  hosted database, so it does not know about `reviewed_at`, `source`, or the
  functions in 20261016130000_shared_records.sql. This states exactly those
  additions on top of it. Once `pnpm db:push` has run and `pnpm db:types` has
  regenerated the file, every addition here is already in the base type and
  this can be reduced to `Database`.
*/
type Public = Database['public']
type Tables = Public['Tables']

type ReviewColumns = { reviewed_at: string | null; reviewed_by: string | null }
type SourceColumn = { source: string }

export type SharedDatabase = Omit<Database, 'public'> & {
  public: Omit<Public, 'Tables' | 'Functions'> & {
    Tables: Omit<Tables, 'entities' | 'audit_entries'> & {
      entities: {
        Row: Tables['entities']['Row'] & ReviewColumns
        Insert: Tables['entities']['Insert'] & Partial<ReviewColumns>
        Update: Tables['entities']['Update'] & Partial<ReviewColumns>
        Relationships: Tables['entities']['Relationships']
      }
      audit_entries: {
        Row: Tables['audit_entries']['Row'] & SourceColumn
        Insert: Tables['audit_entries']['Insert'] & Partial<SourceColumn>
        Update: Tables['audit_entries']['Update'] & Partial<SourceColumn>
        Relationships: Tables['audit_entries']['Relationships']
      }
    }
    Functions: Public['Functions'] & {
      materialize_records: {
        Args: { entity_rows: Json; relation_rows: Json }
        Returns: undefined
      }
      audit_actors: { Args: never; Returns: string[] }
    }
  }
}

export type EntityRow = SharedDatabase['public']['Tables']['entities']['Row']
export type RelationRow = Tables['relations']['Row']
export type AuditRow = SharedDatabase['public']['Tables']['audit_entries']['Row']
export type OrgRow = Tables['orgs']['Row']
export type OrgUserRow = Tables['org_users']['Row']
export type ReferenceItemRow = Tables['reference_items']['Row']
export type RelationTypeRow = Tables['relation_types']['Row']

/* ------------------------------------------------------------- mapping -- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function entityType(value: string): EntityType {
  const found = ENTITY_TYPES.find((type) => type === value)
  if (!found) throw new Error(`The database holds a record of unknown type "${value}".`)
  return found
}

function referenceList(value: string): ReferenceList {
  const found = REFERENCE_LISTS.find((list) => list === value)
  if (!found) throw new Error(`The database holds a list item in unknown list "${value}".`)
  return found
}

const ROLES = ['admin', 'manager', 'board', 'resident'] as const

function role(value: string): OrgUser['role'] {
  return ROLES.find((candidate) => candidate === value) ?? 'resident'
}

const ACTIONS = ['insert', 'update', 'delete'] as const satisfies readonly AuditAction[]
const SOURCES = ['hand', 'import', 'system'] as const satisfies readonly AuditSource[]

export function entityFromRow(row: EntityRow): Entity {
  return {
    id: row.id,
    orgId: row.org_id,
    type: entityType(row.type),
    name: row.name,
    data: isRecord(row.data) ? row.data : {},
    folderId: row.folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    archivedAt: row.archived_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
  }
}

/** Every column, for an insert or a copy. `data` is plain JSON by construction. */
export function entityToRow(entity: Entity): EntityRow {
  return {
    id: entity.id,
    org_id: entity.orgId,
    type: entity.type,
    name: entity.name,
    data: entity.data as Json,
    folder_id: entity.folderId,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    deleted_at: entity.deletedAt,
    archived_at: entity.archivedAt,
    reviewed_at: entity.reviewedAt,
    reviewed_by: entity.reviewedBy,
  }
}

export function relationFromRow(row: RelationRow): Relation {
  return {
    id: row.id,
    orgId: row.org_id,
    relationTypeId: row.relation_type_id,
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    startDate: row.start_date,
    endDate: row.end_date,
    attributes: isRecord(row.attributes) ? row.attributes : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    archivedAt: row.archived_at,
  }
}

export function relationToRow(relation: Relation): RelationRow {
  return {
    id: relation.id,
    org_id: relation.orgId,
    relation_type_id: relation.relationTypeId,
    from_entity_id: relation.fromEntityId,
    to_entity_id: relation.toEntityId,
    start_date: relation.startDate,
    end_date: relation.endDate,
    attributes: relation.attributes as Json,
    created_at: relation.createdAt,
    updated_at: relation.updatedAt,
    deleted_at: relation.deletedAt,
    archived_at: relation.archivedAt,
  }
}

/**
 * A column name as the application names the field.
 *
 * The trigger logs Postgres column names. History and the hand mark were built
 * against the in-memory log, which uses the application's names, and match on
 * them: "reviewedAt" is what makes a row read as "checked this record". Keys
 * inside `data` are already the application's own.
 */
export function fieldNameFromColumn(column: string | null): string | null {
  if (column === null || column.startsWith('data.')) return column
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

export function auditFromRow(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    tableName: row.table_name === 'relations' ? 'relations' : 'entities',
    recordId: row.record_id,
    action: ACTIONS.find((action) => action === row.action) ?? 'update',
    fieldName: fieldNameFromColumn(row.field_name),
    oldValue: row.old_value,
    newValue: row.new_value,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
    source: SOURCES.find((source) => source === row.source) ?? 'hand',
    batchId: row.batch_id,
  }
}

export function orgFromRow(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    sagisUrlTemplate: row.sagis_url_template,
    createdAt: row.created_at,
  }
}

export function orgUserFromRow(row: OrgUserRow): OrgUser {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    email: row.email,
    role: role(row.role),
    lastActiveAt: row.last_active_at,
  }
}

export function referenceItemFromRow(row: ReferenceItemRow): ReferenceItem {
  return {
    id: row.id,
    orgId: row.org_id,
    list: referenceList(row.list),
    value: row.value,
    label: row.label,
    sortOrder: row.sort_order,
    active: row.active,
  }
}

export function relationTypeFromRow(row: RelationTypeRow): RelationType {
  return {
    id: row.id,
    orgId: row.org_id,
    key: row.key,
    label: row.label,
    reverseLabel: row.reverse_label,
  }
}

import { createMemoryStore, type MemoryStore } from './memory-provider'
import type { RemoteSnapshot, RemoteStore, WriteContext } from './remote'
import type {
  ActivityEntry,
  AuditEntry,
  AuditSource,
  DataProvider,
  DataSnapshot,
  Entity,
  EntityInput,
  EntityPatch,
  ListActivityOptions,
  ListEntitiesOptions,
  Org,
  OrgPatch,
  Page,
  ReferenceItem,
  ReferenceItemInput,
  ReferenceItemPatch,
  ReferenceList,
  Relation,
  RelationInput,
  RelationPatch,
} from './types'

/*
  The association's records, shared through the database.

  Reads are answered from memory, exactly as they always have been: search, the
  plat, the Connection Map, and the dashboard rollups all walk the whole record
  set, and asking Postgres for sixteen thousand lots on every keystroke is not
  a trade worth making. Writes go to the database first and only reach memory
  as the row the database hands back, so what is on screen is what was saved,
  including everything the triggers did to it.

  History, Activity, and who-changed-what are read from the database, because
  the audit log is the triggers' and nobody else's.

  The county parcel layer stays out of the database until somebody touches a
  lot. Then the lot is copied in as it is, without an audit row or a hand mark,
  and the edit is applied on top of it like any other.
*/

export interface SyncedProviderOptions {
  remote: RemoteStore
  /** The county layer and the supplied contacts, on stable ids. */
  baseline: DataSnapshot
  snapshot: RemoteSnapshot
}

export interface SyncedProvider extends DataProvider {
  /** Picks up what anyone else has written. True when something changed. */
  refresh(): Promise<boolean>
  /**
   * Makes the shared record match `entity`, creating it if it is new. For
   * copying in work saved in a browser before the records were shared.
   */
  adoptEntity(entity: Entity): Promise<void>
  adoptRelation(relation: Relation): Promise<void>
}

/** A moment a little before `iso`, so a refresh overlaps rather than gaps. */
function overlapFrom(iso: string): string {
  return new Date(new Date(iso).getTime() - 5_000).toISOString()
}

function latest(values: readonly string[], fallback: string): string {
  return values.reduce((max, value) => (value > max ? value : max), fallback)
}

class Synced implements SyncedProvider {
  readonly kind = 'supabase' as const

  private readonly remote: RemoteStore
  private readonly memory: MemoryStore
  private readonly orgId: string
  /** Ids that already have a row in the database. Everything else is county layer. */
  private readonly storedEntities = new Set<string>()
  private readonly storedRelations = new Set<string>()
  private context: WriteContext = { batchId: null, source: 'hand' }
  private watermark: string

  constructor({ remote, baseline, snapshot }: SyncedProviderOptions) {
    this.remote = remote
    this.orgId = snapshot.org.id

    /*
      The baseline was built against fixture relation type ids. The database
      has its own, so the baseline's connections are matched to them by key,
      and any kind the database does not offer is left out rather than shown
      under a type nobody can choose.
    */
    const typeIdByKey = new Map(snapshot.relationTypes.map((type) => [type.key, type.id]))
    const baselineKey = new Map(baseline.relationTypes.map((type) => [type.id, type.key]))
    const baselineRelations: Relation[] = []
    for (const relation of baseline.relations) {
      const key = baselineKey.get(relation.relationTypeId)
      const typeId = key ? typeIdByKey.get(key) : undefined
      if (!typeId) continue
      baselineRelations.push({ ...relation, orgId: this.orgId, relationTypeId: typeId })
    }

    // The database wins wherever it has a row: that row is somebody's work.
    const entities = new Map<string, Entity>()
    for (const entity of baseline.entities) entities.set(entity.id, { ...entity, orgId: this.orgId })
    for (const entity of snapshot.entities) {
      entities.set(entity.id, entity)
      this.storedEntities.add(entity.id)
    }

    const relations = new Map<string, Relation>()
    for (const relation of baselineRelations) relations.set(relation.id, relation)
    for (const relation of snapshot.relations) {
      relations.set(relation.id, relation)
      this.storedRelations.add(relation.id)
    }

    this.memory = createMemoryStore({
      org: snapshot.org,
      entities: [...entities.values()],
      relations: [...relations.values()],
      relationTypes: snapshot.relationTypes,
      auditEntries: snapshot.importAudit,
      referenceItems: snapshot.referenceItems,
      users: snapshot.users,
    })

    this.watermark = latest(
      [
        ...snapshot.entities.map((entity) => entity.updatedAt),
        ...snapshot.relations.map((relation) => relation.updatedAt),
      ],
      new Date(0).toISOString()
    )
  }

  /* ---------------------------------------------------------------- reads -- */

  getOrg(): Promise<Org> {
    return this.memory.getOrg()
  }

  listEntities(options?: ListEntitiesOptions): Promise<Page<Entity>> {
    return this.memory.listEntities(options)
  }

  listAllEntities(): Promise<Entity[]> {
    return this.memory.listAllEntities()
  }

  countsByType() {
    return this.memory.countsByType()
  }

  getEntity(id: string): Promise<Entity | null> {
    return this.memory.getEntity(id)
  }

  listRelationTypes() {
    return this.memory.listRelationTypes()
  }

  listRelations(entityId?: string): Promise<Relation[]> {
    return this.memory.listRelations(entityId)
  }

  resolveLocation(entityId: string) {
    return this.memory.resolveLocation(entityId)
  }

  listLocations() {
    return this.memory.listLocations()
  }

  listReviewIndex() {
    return this.memory.listReviewIndex()
  }

  getActor(): Promise<string> {
    return this.memory.getActor()
  }

  listReferenceItems(list?: ReferenceList): Promise<ReferenceItem[]> {
    return this.memory.listReferenceItems(list)
  }

  listUsers() {
    return this.memory.listUsers()
  }

  snapshot(): DataSnapshot {
    return this.memory.snapshot()
  }

  /* ---------------------------------------------------------------- audit -- */

  listAuditEntries(recordId: string): Promise<AuditEntry[]> {
    return this.remote.listAuditEntries(recordId)
  }

  async listActivity(options: ListActivityOptions = {}): Promise<Page<ActivityEntry>> {
    const { entityType, page = 1, pageSize = 100, ...filters } = options
    const subjects = new Map<string, Entity | null>()
    const subjectOf = async (id: string): Promise<Entity | null> => {
      if (!subjects.has(id)) subjects.set(id, await this.memory.getEntity(id))
      return subjects.get(id) ?? null
    }

    // As the in-memory log did: a connection's subject is the record it starts from.
    const resolve = async (entry: AuditEntry): Promise<ActivityEntry> => {
      const subjectId =
        entry.tableName === 'relations'
          ? (this.memory.getRelation(entry.recordId)?.fromEntityId ?? null)
          : entry.recordId
      const subject = subjectId ? await subjectOf(subjectId) : null
      return {
        ...entry,
        entityId: subject?.id ?? null,
        entityName: subject?.name ?? null,
        entityType: subject?.type ?? null,
      }
    }

    if (!entityType) {
      const { rows, total } = await this.remote.listAudit({
        ...filters,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      })
      return { rows: await Promise.all(rows.map(resolve)), total, page, pageSize }
    }

    /*
      The kind of record is known here, not in the log, so that filter runs on
      this side over the most recent rows. An association's log is small; the
      cap is there so a very old filter cannot read the whole table.
    */
    const { rows } = await this.remote.listAudit({ ...filters, offset: 0, limit: 5000 })
    const matching = (await Promise.all(rows.map(resolve))).filter(
      (entry) => entry.entityType === entityType
    )
    const start = (page - 1) * pageSize
    return { rows: matching.slice(start, start + pageSize), total: matching.length, page, pageSize }
  }

  listActors(): Promise<string[]> {
    return this.remote.listActors()
  }

  /* -------------------------------------------------------------- entities -- */

  async createEntity(input: EntityInput): Promise<Entity> {
    const now = new Date().toISOString()
    const saved = await this.remote.insertEntity(
      {
        id: crypto.randomUUID(),
        orgId: this.orgId,
        type: input.type,
        name: input.name,
        data: input.data ?? {},
        folderId: input.folderId ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        archivedAt: null,
        reviewedAt: null,
        reviewedBy: null,
      },
      this.context
    )
    this.storedEntities.add(saved.id)
    this.memory.upsertEntities([saved])
    return saved
  }

  async updateEntity(id: string, patch: EntityPatch): Promise<Entity> {
    await this.ensureStored([id], [])
    const saved = await this.remote.updateEntity(
      id,
      { name: patch.name, folderId: patch.folderId, data: patch.data },
      this.context
    )
    this.memory.upsertEntities([saved])
    return saved
  }

  archiveEntity(id: string): Promise<Entity> {
    return this.writeEntity(id, { archivedAt: new Date().toISOString() })
  }

  deleteEntity(id: string): Promise<Entity> {
    return this.writeEntity(id, { deletedAt: new Date().toISOString() })
  }

  async restoreEntity(id: string): Promise<Entity> {
    const current = await this.memory.getEntity(id)
    if (!current) throw new Error(`No entity with id ${id}`)
    return this.writeEntity(id, {
      ...(current.archivedAt !== null ? { archivedAt: null } : {}),
      ...(current.deletedAt !== null ? { deletedAt: null } : {}),
    })
  }

  async setManualLocation(
    entityId: string,
    point: [longitude: number, latitude: number] | null
  ): Promise<Entity> {
    const entity = await this.memory.getEntity(entityId)
    if (!entity) throw new Error(`No entity with id ${entityId}`)
    const data = { ...entity.data }
    if (point === null) delete data.location
    else data.location = point
    return this.updateEntity(entityId, { data })
  }

  /** The trigger fills in who checked it; the time is this moment. */
  setReviewed(entityId: string, reviewed: boolean): Promise<Entity> {
    return this.writeEntity(entityId, { reviewedAt: reviewed ? new Date().toISOString() : null })
  }

  /* ------------------------------------------------------------- relations -- */

  async createRelation(input: RelationInput): Promise<Relation> {
    await this.ensureStored([input.fromEntityId, input.toEntityId], [])
    const now = new Date().toISOString()
    const saved = await this.remote.insertRelation(
      {
        id: crypto.randomUUID(),
        orgId: this.orgId,
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
      },
      this.context
    )
    this.storedRelations.add(saved.id)
    this.memory.upsertRelations([saved])
    return saved
  }

  async updateRelation(id: string, patch: RelationPatch): Promise<Relation> {
    const ends = [patch.fromEntityId, patch.toEntityId].filter(
      (value): value is string => value !== undefined
    )
    await this.ensureStored(ends, [id])
    const saved = await this.remote.updateRelation(id, patch, this.context)
    this.memory.upsertRelations([saved])
    return saved
  }

  async deleteRelation(id: string): Promise<Relation> {
    await this.ensureStored([], [id])
    const saved = await this.remote.updateRelation(
      id,
      { deletedAt: new Date().toISOString() },
      this.context
    )
    this.memory.upsertRelations([saved])
    return saved
  }

  /* ------------------------------------------------------- org and lists -- */

  async updateOrg(patch: OrgPatch): Promise<Org> {
    const saved = await this.remote.updateOrg(patch)
    this.memory.setOrg(saved)
    return saved
  }

  async createReferenceItem(input: ReferenceItemInput): Promise<ReferenceItem> {
    const siblings = await this.memory.listReferenceItems(input.list)
    const saved = await this.remote.insertReferenceItem({
      id: crypto.randomUUID(),
      orgId: this.orgId,
      list: input.list,
      // The stored value is a slug, so renaming the label never rewrites data.
      value:
        input.value ??
        input.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, ''),
      label: input.label,
      sortOrder: input.sortOrder ?? siblings.length,
      active: input.active ?? true,
    })
    const all = await this.memory.listReferenceItems()
    this.memory.setReferenceItems([...all, saved])
    return saved
  }

  async updateReferenceItem(id: string, patch: ReferenceItemPatch): Promise<ReferenceItem> {
    const saved = await this.remote.updateReferenceItem(id, patch)
    const all = await this.memory.listReferenceItems()
    this.memory.setReferenceItems(all.map((item) => (item.id === id ? saved : item)))
    return saved
  }

  /* ----------------------------------------------------------------- batch -- */

  async runBatch<T>(
    work: () => Promise<T>,
    source: AuditSource = 'hand'
  ): Promise<{ batchId: string; result: T }> {
    const batchId = crypto.randomUUID()
    const previous = this.context
    this.context = { batchId, source }
    try {
      const result = await work()
      return { batchId, result }
    } finally {
      this.context = previous
    }
  }

  /* ------------------------------------------------------------- sharing -- */

  async refresh(): Promise<boolean> {
    const changes = await this.remote.loadChangedSince(overlapFrom(this.watermark))

    // The overlap re-reads the last few seconds on purpose; only what moved counts.
    const entities: Entity[] = []
    for (const entity of changes.entities) {
      this.storedEntities.add(entity.id)
      if ((await this.memory.getEntity(entity.id))?.updatedAt !== entity.updatedAt) {
        entities.push(entity)
      }
    }
    const relations = changes.relations.filter((relation) => {
      this.storedRelations.add(relation.id)
      return this.memory.getRelation(relation.id)?.updatedAt !== relation.updatedAt
    })

    this.memory.upsertEntities(entities)
    this.memory.upsertRelations(relations)
    const newImports = this.memory.mergeAuditEntries(changes.importAudit)

    this.watermark = latest(
      [
        ...changes.entities.map((entity) => entity.updatedAt),
        ...changes.relations.map((relation) => relation.updatedAt),
      ],
      this.watermark
    )
    return entities.length > 0 || relations.length > 0 || newImports > 0
  }

  async adoptEntity(entity: Entity): Promise<void> {
    const current = await this.memory.getEntity(entity.id)

    if (!current) {
      const now = new Date().toISOString()
      const saved = await this.remote.insertEntity(
        { ...entity, orgId: this.orgId, createdAt: now, updatedAt: now },
        this.context
      )
      this.storedEntities.add(saved.id)
      this.memory.upsertEntities([saved])
      if (entity.archivedAt !== null || entity.deletedAt !== null) {
        await this.writeEntity(saved.id, {
          archivedAt: entity.archivedAt,
          deletedAt: entity.deletedAt,
        })
      }
      return
    }

    const changes = {
      ...(entity.name !== current.name ? { name: entity.name } : {}),
      ...(entity.folderId !== current.folderId ? { folderId: entity.folderId } : {}),
      ...(JSON.stringify(entity.data) !== JSON.stringify(current.data) ? { data: entity.data } : {}),
      ...(entity.archivedAt !== current.archivedAt ? { archivedAt: entity.archivedAt } : {}),
      ...(entity.deletedAt !== current.deletedAt ? { deletedAt: entity.deletedAt } : {}),
    }
    if (Object.keys(changes).length === 0) return
    await this.writeEntity(entity.id, changes)
  }

  async adoptRelation(relation: Relation): Promise<void> {
    const existing = this.memory.getRelation(relation.id)

    if (!existing) {
      await this.ensureStored([relation.fromEntityId, relation.toEntityId], [])
      const now = new Date().toISOString()
      const saved = await this.remote.insertRelation(
        { ...relation, orgId: this.orgId, createdAt: now, updatedAt: now },
        this.context
      )
      this.storedRelations.add(saved.id)
      this.memory.upsertRelations([saved])
      if (relation.deletedAt !== null) await this.deleteRelation(saved.id)
      return
    }

    const patch: RelationPatch & { deletedAt?: string | null } = {
      ...(relation.relationTypeId !== existing.relationTypeId
        ? { relationTypeId: relation.relationTypeId }
        : {}),
      ...(relation.fromEntityId !== existing.fromEntityId
        ? { fromEntityId: relation.fromEntityId }
        : {}),
      ...(relation.toEntityId !== existing.toEntityId ? { toEntityId: relation.toEntityId } : {}),
      ...(relation.startDate !== existing.startDate ? { startDate: relation.startDate } : {}),
      ...(relation.endDate !== existing.endDate ? { endDate: relation.endDate } : {}),
      ...(relation.deletedAt !== existing.deletedAt ? { deletedAt: relation.deletedAt } : {}),
    }
    if (Object.keys(patch).length === 0) return

    const ends = [patch.fromEntityId, patch.toEntityId].filter(
      (value): value is string => value !== undefined
    )
    await this.ensureStored(ends, [relation.id])
    const saved = await this.remote.updateRelation(relation.id, patch, this.context)
    this.memory.upsertRelations([saved])
  }

  /* -------------------------------------------------------------- internal -- */

  private async writeEntity(
    id: string,
    changes: Parameters<RemoteStore['updateEntity']>[1]
  ): Promise<Entity> {
    await this.ensureStored([id], [])
    const saved = await this.remote.updateEntity(id, changes, this.context)
    this.memory.upsertEntities([saved])
    return saved
  }

  /**
   * Copies in any of these that are still only in the county layer, so the
   * write that follows has a row to land on and real keys to point at.
   */
  private async ensureStored(entityIds: readonly string[], relationIds: readonly string[]) {
    const relations: Relation[] = []
    const wantedEntities = new Set(entityIds)
    for (const id of relationIds) {
      if (this.storedRelations.has(id)) continue
      const relation = this.memory.getRelation(id)
      if (!relation) continue
      relations.push(relation)
      // A connection's ends have to exist before it can.
      wantedEntities.add(relation.fromEntityId)
      wantedEntities.add(relation.toEntityId)
    }

    const entities: Entity[] = []
    for (const id of wantedEntities) {
      if (this.storedEntities.has(id)) continue
      const entity = await this.memory.getEntity(id)
      if (entity) entities.push(entity)
    }

    if (entities.length === 0 && relations.length === 0) return
    await this.remote.materialize(entities, relations)
    for (const entity of entities) this.storedEntities.add(entity.id)
    for (const relation of relations) this.storedRelations.add(relation.id)
  }
}

export function createSyncedProvider(options: SyncedProviderOptions): SyncedProvider {
  return new Synced(options)
}

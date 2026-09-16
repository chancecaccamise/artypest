import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'

import { data } from '@/lib/data'
import { useAuth } from '@/lib/auth'
import type {
  Entity,
  EntityInput,
  EntityPatch,
  ListActivityOptions,
  ListEntitiesOptions,
  OrgPatch,
  ReferenceItemInput,
  ReferenceItemPatch,
  ReferenceList,
  RelationInput,
} from '@/lib/data/types'
import type { Point } from '@/lib/geocoding/types'
import { resolveGraph, type ResolvedGraph } from '@/lib/insights'

/*
  Every read in the app goes through these hooks, and every write invalidates
  by key here rather than in a component. When the provider becomes Supabase
  none of this changes: the hooks call the same DataProvider methods.
*/

export const queryKeys = {
  org: ['org'] as const,
  counts: ['counts'] as const,
  entities: (options: ListEntitiesOptions) => ['entities', options] as const,
  allEntities: ['entities', 'all'] as const,
  entity: (id: string) => ['entity', id] as const,
  relations: (entityId?: string) => ['relations', entityId ?? 'all'] as const,
  relationTypes: ['relation-types'] as const,
  audit: (recordId: string) => ['audit', recordId] as const,
  activity: (options: ListActivityOptions) => ['activity', options] as const,
  actors: ['actors'] as const,
  reference: (list?: ReferenceList) => ['reference', list ?? 'all'] as const,
  users: ['users'] as const,
  locations: ['locations'] as const,
  location: (entityId: string) => ['location', entityId] as const,
  reviewIndex: ['review-index'] as const,
  actor: ['actor'] as const,
}

/** Anything a write can invalidate. Broad on purpose: correctness over churn. */
function invalidateAll(client: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['entities'] }),
    client.invalidateQueries({ queryKey: ['entity'] }),
    client.invalidateQueries({ queryKey: ['relations'] }),
    client.invalidateQueries({ queryKey: ['counts'] }),
    client.invalidateQueries({ queryKey: ['activity'] }),
    client.invalidateQueries({ queryKey: ['audit'] }),
    client.invalidateQueries({ queryKey: ['actors'] }),
    // A moved pin, a new ownership, or an archived lot all change where
    // things resolve to, so the map is invalidated with everything else.
    client.invalidateQueries({ queryKey: ['locations'] }),
    client.invalidateQueries({ queryKey: ['location'] }),
    // Every hand edit stamps the mark, so the marks move whenever anything does.
    client.invalidateQueries({ queryKey: ['review-index'] }),
  ])
}

export function useOrg() {
  return useQuery({ queryKey: queryKeys.org, queryFn: () => data.getOrg() })
}

export function useUpdateOrg() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: OrgPatch) => data.updateOrg(patch),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.org })
      await client.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

export function useCounts() {
  return useQuery({ queryKey: queryKeys.counts, queryFn: () => data.countsByType() })
}

export function useEntities(options: ListEntitiesOptions) {
  return useQuery({
    queryKey: queryKeys.entities(options),
    queryFn: () => data.listEntities(options),
    placeholderData: (previous) => previous,
  })
}

export function useEntity(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.entity(id ?? ''),
    queryFn: () => data.getEntity(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useAllEntities() {
  return useQuery({ queryKey: queryKeys.allEntities, queryFn: () => data.listAllEntities() })
}

export function useRelations(entityId?: string) {
  return useQuery({
    queryKey: queryKeys.relations(entityId),
    queryFn: () => data.listRelations(entityId),
  })
}

export function useRelationTypes() {
  return useQuery({ queryKey: queryKeys.relationTypes, queryFn: () => data.listRelationTypes() })
}

export function useAuditEntries(recordId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.audit(recordId ?? ''),
    queryFn: () => data.listAuditEntries(recordId ?? ''),
    enabled: Boolean(recordId),
  })
}

export function useActivity(options: ListActivityOptions) {
  return useQuery({
    queryKey: queryKeys.activity(options),
    queryFn: () => data.listActivity(options),
    placeholderData: (previous) => previous,
  })
}

export function useActors() {
  return useQuery({ queryKey: queryKeys.actors, queryFn: () => data.listActors() })
}

/** The signed-in person, as the audit log records them. */
export function useActor() {
  const auth = useAuth()
  const accountActor = auth.status === 'signed-in' ? auth.account.email : null

  return useQuery({
    queryKey: [...queryKeys.actor, accountActor ?? 'provider'],
    queryFn: () => accountActor ?? data.getActor(),
  })
}

/*
  Who has read what.

  One query for the whole index rather than one per row: a fifty-row page of
  properties would otherwise be fifty lookups, and the answer for row three
  depends on the same single pass over the audit log as the answer for row
  forty-one.
*/
export function useReviewIndex() {
  return useQuery({ queryKey: queryKeys.reviewIndex, queryFn: () => data.listReviewIndex() })
}

export function useSetReviewed() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ entityId, reviewed }: { entityId: string; reviewed: boolean }) =>
      data.setReviewed(entityId, reviewed),
    onSuccess: () => invalidateAll(client),
  })
}

export function useReferenceItems(list?: ReferenceList) {
  return useQuery({
    queryKey: queryKeys.reference(list),
    queryFn: () => data.listReferenceItems(list),
  })
}

export function useUsers() {
  return useQuery({ queryKey: queryKeys.users, queryFn: () => data.listUsers() })
}

/** Every record resolved to a location at once. See docs/MAP-SPEC.md section 1. */
export function useLocations() {
  return useQuery({ queryKey: queryKeys.locations, queryFn: () => data.listLocations() })
}

/** Where one record is, and where that answer came from. */
export function useLocation(entityId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.location(entityId ?? ''),
    queryFn: () => data.resolveLocation(entityId ?? ''),
    enabled: Boolean(entityId),
  })
}

export function useSetManualLocation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ entityId, point }: { entityId: string; point: Point | null }) =>
      data.setManualLocation(entityId, point),
    onSuccess: () => invalidateAll(client),
  })
}

/* ------------------------------------------------------------- mutations -- */

export function useCreateEntity() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: EntityInput) => data.createEntity(input),
    onSuccess: () => invalidateAll(client),
  })
}

/** Creates a record and its initial connections before refreshing dependent views once. */
export function useCreateEntityWithRelations() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      entity,
      relations,
    }: {
      entity: EntityInput
      relations: Array<Omit<RelationInput, 'fromEntityId'>>
    }) => {
      const created = await data.createEntity(entity)
      for (const relation of relations) {
        await data.createRelation({ ...relation, fromEntityId: created.id })
      }
      return created
    },
    onSuccess: () => {
      // The record is already durable at this point. Let the form close while
      // the directory and map refresh in the background, especially when a
      // person was linked to several properties at once.
      void invalidateAll(client)
    },
  })
}

export function useUpdateEntity() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: EntityPatch }) => data.updateEntity(id, patch),
    onSuccess: () => invalidateAll(client),
  })
}

export function useArchiveEntity() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => data.archiveEntity(id),
    onSuccess: () => invalidateAll(client),
  })
}

export function useRestoreEntity() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => data.restoreEntity(id),
    onSuccess: () => invalidateAll(client),
  })
}

export function useDeleteEntity() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => data.deleteEntity(id),
    onSuccess: () => invalidateAll(client),
  })
}

export function useCreateRelation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: RelationInput) => data.createRelation(input),
    onSuccess: () => invalidateAll(client),
  })
}

export function useDeleteRelation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => data.deleteRelation(id),
    onSuccess: () => invalidateAll(client),
  })
}

export function useCreateReferenceItem() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ReferenceItemInput) => data.createReferenceItem(input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['reference'] }),
  })
}

export function useUpdateReferenceItem() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ReferenceItemPatch }) =>
      data.updateReferenceItem(id, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: ['reference'] }),
  })
}

/* ----------------------------------------------------------------- graph -- */

export interface GraphQuery {
  graph: ResolvedGraph | null
  isLoading: boolean
  isError: boolean
}

/**
 * Entities, relations, and relation types resolved into one indexed graph.
 * The dashboard and the Connection Map both need the whole picture, and
 * building the indexes once beats each widget walking the arrays.
 */
export function useGraph(): GraphQuery {
  const entities = useAllEntities()
  const relations = useRelations()
  const relationTypes = useRelationTypes()

  const graph = useMemo(() => {
    if (!entities.data || !relations.data || !relationTypes.data) return null
    return resolveGraph({
      entities: entities.data,
      relations: relations.data,
      relationTypes: relationTypes.data,
    })
  }, [entities.data, relations.data, relationTypes.data])

  return {
    graph,
    isLoading: entities.isLoading || relations.isLoading || relationTypes.isLoading,
    isError: entities.isError || relations.isError || relationTypes.isError,
  }
}

/** Narrowing helper so a component can render one loading branch. */
export function isPending(...queries: UseQueryResult<unknown>[]): boolean {
  return queries.some((query) => query.isLoading)
}

/** Entities of one type, listed in full. Used by pickers and the map. */
export function useEntitiesOfType(type: Entity['type']) {
  return useQuery({
    queryKey: queryKeys.entities({ type, pageSize: 1000 }),
    queryFn: () => data.listEntities({ type, pageSize: 1000 }),
  })
}

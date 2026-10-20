import { beforeEach, describe, expect, it } from 'vitest'

import { createFakeRemote } from '@/test/fake-remote'
import { buildDemoData } from '@/lib/data/fixtures'
import { createMemoryProvider } from '@/lib/data/memory-provider'
import { applyOverlay, buildOverlay } from '@/lib/data/persistence'
import { withStableIds } from '@/lib/data/stable-ids'
import { createSyncedProvider } from '@/lib/data/synced-provider'
import type { DataProvider, DataSnapshot, RelationType } from '@/lib/data/types'

import { normalizeLabel, planRelationType, relationTypeKey } from './editing'

/*
  The board's own connection types. The same rules hold in the demo and in the
  shared records, so every case below runs against both providers.
*/

const REFERENCE = new Date('2026-10-20T00:00:00.000Z')
const ORG = {
  id: 'a1b2c3d4-0000-4000-a000-000000000001',
  name: 'Thomas Square Neighborhood Association',
  sagisUrlTemplate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('naming a connection type', () => {
  it('stores the label lower case first and single spaced, unless it opens with an acronym', () => {
    expect(normalizeLabel('  Mentors   at ')).toBe('mentors at')
    expect(normalizeLabel('HOA liaison for')).toBe('HOA liaison for')
  })

  it('derives the key from the label', () => {
    expect(relationTypeKey('is a tenant of')).toBe('is_a_tenant_of')
    expect(relationTypeKey('Co-owns!')).toBe('co_owns')
  })

  it('reads the same both ways when the reverse is left blank', () => {
    expect(planRelationType({ label: 'is neighbors with', reverseLabel: ' ' }, [])).toMatchObject({
      kind: 'create',
      label: 'is neighbors with',
      reverseLabel: 'is neighbors with',
    })
  })

  it('refuses a name with nothing in it', () => {
    expect(() => planRelationType({ label: ' !! ', reverseLabel: '' }, [])).toThrow(/letters/)
  })
})

function memory(): DataProvider {
  return createMemoryProvider(buildDemoData(REFERENCE, [], { includeTemporaryData: false }))
}

async function synced(): Promise<DataProvider> {
  const baseline: DataSnapshot = withStableIds(
    buildDemoData(REFERENCE, [], { includeTemporaryData: false })
  ).data
  const types: RelationType[] = baseline.relationTypes.map((type) => ({
    ...type,
    id: `db-${type.key}`,
    orgId: ORG.id,
  }))
  const remote = createFakeRemote({ org: ORG, relationTypes: types })
  return createSyncedProvider({ remote, baseline, snapshot: await remote.loadAll() })
}

describe.each([
  ['in the demo', () => Promise.resolve(memory())],
  ['in the shared records', synced],
])('connection types %s', (_, open) => {
  let data: DataProvider

  beforeEach(async () => {
    data = await open()
  })

  async function twoPeople() {
    const a = await data.createEntity({ type: 'person', name: 'Ann Mentor' })
    const b = await data.createEntity({ type: 'person', name: 'Bo Mentee' })
    return { a, b }
  }

  it('adds a type the board can connect records with', async () => {
    const type = await data.createRelationType({ label: 'Mentors', reverseLabel: 'is mentored by' })
    expect(type).toMatchObject({ key: 'mentors', label: 'mentors', builtIn: false })
    expect((await data.listRelationTypes()).map((candidate) => candidate.key)).toContain('mentors')
  })

  it('refuses a second type with the same name', async () => {
    await expect(data.createRelationType({ label: 'Owns', reverseLabel: '' })).rejects.toThrow(
      'There is already a connection type called "owns".'
    )
  })

  it('rewords a built in type without touching its key', async () => {
    const owns = (await data.listRelationTypes()).find((type) => type.key === 'owns')
    const saved = await data.updateRelationType(owns?.id ?? '', { label: 'Holds title to' })
    expect(saved).toMatchObject({ key: 'owns', label: 'holds title to' })
  })

  it('never removes a built in type', async () => {
    const owns = (await data.listRelationTypes()).find((type) => type.key === 'owns')
    await expect(data.deleteRelationType(owns?.id ?? '')).rejects.toThrow(/built in/)
  })

  it('refuses to remove a type a current connection uses, then removes it once that is gone', async () => {
    const mentors = await data.createRelationType({ label: 'mentors', reverseLabel: '' })
    const { a, b } = await twoPeople()
    const relation = await data.createRelation({
      relationTypeId: mentors.id,
      fromEntityId: a.id,
      toEntityId: b.id,
    })

    await expect(data.deleteRelationType(mentors.id)).rejects.toThrow(
      '1 connection uses "mentors". Change or remove it first.'
    )

    await data.deleteRelation(relation.id)
    await data.deleteRelationType(mentors.id)
    expect((await data.listRelationTypes()).some((type) => type.id === mentors.id)).toBe(false)
  })

  it('brings a removed type back when the same name is added again', async () => {
    const first = await data.createRelationType({ label: 'mentors', reverseLabel: '' })
    await data.deleteRelationType(first.id)
    const again = await data.createRelationType({
      label: 'Mentors',
      reverseLabel: 'is mentored by',
    })
    expect(again).toMatchObject({ id: first.id, reverseLabel: 'is mentored by', deletedAt: null })
  })
})

describe('connection types kept between visits to the demo', () => {
  it('survive a reload, removals included', async () => {
    const baseline = buildDemoData(REFERENCE, [], { includeTemporaryData: false })
    const data = createMemoryProvider(baseline)
    const kept = await data.createRelationType({ label: 'mentors', reverseLabel: '' })
    const gone = await data.createRelationType({ label: 'coaches', reverseLabel: '' })
    await data.deleteRelationType(gone.id)

    const overlay = buildOverlay(data.snapshot(), baseline, REFERENCE.toISOString())
    const reloaded = createMemoryProvider(
      applyOverlay(buildDemoData(REFERENCE, [], { includeTemporaryData: false }), overlay)
    )
    const keys = (await reloaded.listRelationTypes()).map((type) => type.key)
    expect(keys).toContain(kept.key)
    expect(keys).not.toContain(gone.key)
  })

  it('reads an overlay saved before types could be edited', () => {
    const baseline = buildDemoData(REFERENCE, [], { includeTemporaryData: false })
    const overlay = buildOverlay(baseline, baseline, REFERENCE.toISOString())
    delete overlay.relationTypes
    expect(applyOverlay(baseline, overlay).relationTypes).toHaveLength(13)
  })
})

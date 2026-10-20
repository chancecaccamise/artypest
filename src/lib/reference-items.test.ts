import { describe, expect, it } from 'vitest'

import { createFakeRemote } from '@/test/fake-remote'
import { buildDemoData } from '@/lib/data/fixtures'
import { createMemoryProvider } from '@/lib/data/memory-provider'
import { applyOverlay, buildOverlay } from '@/lib/data/persistence'
import { withStableIds } from '@/lib/data/stable-ids'
import { createSyncedProvider } from '@/lib/data/synced-provider'
import type { DataProvider } from '@/lib/data/types'

/*
  Removing a record type, or any item on the association's own lists. Every
  case runs against both providers, because the board sees the same rule in
  the demo and in the shared records.
*/

const REFERENCE = new Date('2026-10-20T00:00:00.000Z')
const ORG = {
  id: 'a1b2c3d4-0000-4000-a000-000000000001',
  name: 'Thomas Square Neighborhood Association',
  sagisUrlTemplate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const demoData = () => buildDemoData(REFERENCE, [], { includeTemporaryData: false })

async function synced(): Promise<DataProvider> {
  const baseline = withStableIds(demoData()).data
  const remote = createFakeRemote({
    org: ORG,
    relationTypes: baseline.relationTypes.map((type) => ({ ...type, id: `db-${type.key}` })),
    referenceItems: baseline.referenceItems,
  })
  return createSyncedProvider({ remote, baseline, snapshot: await remote.loadAll() })
}

describe.each([
  ['in the demo', () => Promise.resolve(createMemoryProvider(demoData()))],
  ['in the shared records', synced],
])('removing a record type %s', (_, open) => {
  it('removes one no record uses', async () => {
    const data = await open()
    const added = await data.createReferenceItem({
      list: 'record_type',
      label: 'Parking violation',
    })
    await data.deleteReferenceItem(added.id)
    const values = (await data.listReferenceItems('record_type')).map((item) => item.value)
    expect(values).not.toContain('parking_violation')
  })

  it('refuses one a record uses, and says how to retire it instead', async () => {
    const data = await open()
    const added = await data.createReferenceItem({
      list: 'record_type',
      label: 'Parking violation',
    })
    await data.createEntity({
      type: 'record',
      name: 'Boat in driveway',
      data: { recordType: 'parking_violation' },
    })
    await expect(data.deleteReferenceItem(added.id)).rejects.toThrow(
      '1 record uses "Parking violation". Change it first, or turn off "Offered" to stop it being chosen for new ones.'
    )
  })
})

describe('record types kept between visits to the demo', () => {
  it('stay removed after a reload, including ones the demo started with', async () => {
    const baseline = demoData()
    const data = createMemoryProvider(baseline)
    const [first] = await data.listReferenceItems('record_type')
    if (!first) throw new Error('The demo has no record types')
    await data.deleteReferenceItem(first.id)

    const overlay = buildOverlay(data.snapshot(), baseline, REFERENCE.toISOString())
    const reloaded = createMemoryProvider(applyOverlay(demoData(), overlay))
    const ids = (await reloaded.listReferenceItems('record_type')).map((item) => item.id)
    expect(ids).not.toContain(first.id)
  })
})

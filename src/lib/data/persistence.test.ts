import { describe, expect, it } from 'vitest'

import type { DataSnapshot, Entity } from './types'

import {
  applyOverlay,
  buildOverlay,
  createLocalOverlayStore,
  isEmptyOverlay,
} from './persistence'

/*
  Only the difference from the freshly built baseline is saved. The store holds
  10,527 records, almost all harvested county parcels, which would not fit in
  localStorage and would be the wrong thing to keep anyway: parcels are rebuilt
  from the county, what a board member types is not.
*/

const NOW = '2026-08-17T00:00:00.000Z'

function entity(id: string, name: string, data: Record<string, unknown> = {}): Entity {
  return {
    id,
    orgId: 'org',
    type: 'person',
    name,
    data,
    folderId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    archivedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }
}

function snapshot(entities: Entity[]): DataSnapshot {
  return {
    org: { id: 'org', name: 'Ardsley Park', sagisUrlTemplate: null, createdAt: NOW },
    relationTypes: [],
    entities,
    relations: [],
    auditEntries: [],
    referenceItems: [],
    users: [],
  }
}

const BASELINE = snapshot([entity('a', 'Alice'), entity('b', 'Bob'), entity('c', 'Carol')])

describe('buildOverlay', () => {
  it('saves nothing when nothing was touched', () => {
    const overlay = buildOverlay(BASELINE, BASELINE, NOW)
    expect(isEmptyOverlay(overlay)).toBe(true)
    expect(overlay.entities).toEqual([])
  })

  it('saves a created record', () => {
    const current = snapshot([...BASELINE.entities, entity('d', 'Dave')])
    const overlay = buildOverlay(current, BASELINE, NOW)

    expect(overlay.entities.map((row) => row.id)).toEqual(['d'])
  })

  it('saves a changed record and leaves the untouched ones out', () => {
    const current = snapshot([
      entity('a', 'Alice Renamed'),
      entity('b', 'Bob'),
      entity('c', 'Carol'),
    ])
    const overlay = buildOverlay(current, BASELINE, NOW)

    // The point of the whole design: two of three records cost nothing.
    expect(overlay.entities.map((row) => row.id)).toEqual(['a'])
  })

  it('records a removal, which is not the same as an absence', () => {
    const current = snapshot([entity('a', 'Alice'), entity('c', 'Carol')])
    const overlay = buildOverlay(current, BASELINE, NOW)

    expect(overlay.removedEntityIds).toEqual(['b'])
  })

  it('keeps a photo, which is the thing most worth not losing', () => {
    const withPhoto = entity('a', 'Alice', { photo: 'data:image/jpeg;base64,abc' })
    const overlay = buildOverlay(
      snapshot([withPhoto, entity('b', 'Bob'), entity('c', 'Carol')]),
      BASELINE,
      NOW
    )

    expect(overlay.entities[0]?.data.photo).toBe('data:image/jpeg;base64,abc')
  })
})

describe('applyOverlay', () => {
  it('puts the reader back where they were', () => {
    const current = snapshot([
      entity('a', 'Alice Renamed'),
      entity('c', 'Carol'),
      entity('d', 'Dave'),
    ])
    const restored = applyOverlay(BASELINE, buildOverlay(current, BASELINE, NOW))

    expect(restored.entities.map((row) => row.name).sort()).toEqual([
      'Alice Renamed',
      'Carol',
      'Dave',
    ])
  })

  it('lets a refreshed baseline through where the reader changed nothing', () => {
    /*
      The county republishes and a parcel gains a new assessed value. The reader
      never touched that record, so the new value has to win rather than being
      pinned to whatever was on screen when they last saved.
    */
    const overlay = buildOverlay(snapshot([...BASELINE.entities, entity('d', 'Dave')]), BASELINE, NOW)

    const refreshed = snapshot([
      entity('a', 'Alice', { assessedValue: 999 }),
      entity('b', 'Bob'),
      entity('c', 'Carol'),
    ])
    const restored = applyOverlay(refreshed, overlay)

    expect(restored.entities.find((row) => row.id === 'a')?.data.assessedValue).toBe(999)
    expect(restored.entities.find((row) => row.id === 'd')?.name).toBe('Dave')
  })

  it('separates a person and a later to do that were saved under the same id', () => {
    /*
      Ids used to be a counter that restarted on every page load, so a to do
      made after a reload could take the id of an owner made before it. Both
      rows were saved; restoring kept only the to do, and the property's owner
      connection opened it.
    */
    const owner = { ...entity('ent-0001', 'Greg Goeken'), createdAt: '2026-10-01T10:00:00.000Z' }
    const todo: Entity = {
      ...entity('ent-0001', 'Call about the fence'),
      type: 'record',
      data: { recordType: 'todo', subjectId: 'b' },
      createdAt: '2026-10-02T10:00:00.000Z',
    }
    const owns = {
      id: 'rel-0001',
      orgId: 'org',
      relationTypeId: 'rt-owns',
      fromEntityId: 'ent-0001',
      toEntityId: 'c',
      startDate: null,
      endDate: null,
      attributes: {},
      createdAt: '2026-10-01T10:05:00.000Z',
      updatedAt: '2026-10-01T10:05:00.000Z',
      deletedAt: null,
      archivedAt: null,
    }
    const current = { ...snapshot([...BASELINE.entities, owner, todo]), relations: [owns] }

    const restored = applyOverlay(BASELINE, buildOverlay(current, BASELINE, NOW))

    const byName = new Map(restored.entities.map((row) => [row.name, row]))
    const person = byName.get('Greg Goeken')
    const reminder = byName.get('Call about the fence')
    expect(person).toBeDefined()
    expect(reminder).toBeDefined()
    expect(person?.id).not.toBe(reminder?.id)
    // The connection was made before the to do existed, so it meant the person.
    expect(restored.relations[0]?.fromEntityId).toBe(person?.id)
  })
})

describe('createLocalOverlayStore', () => {
  /** A Storage that lives in a Map, so these run without a browser. */
  function memoryStorage(): Storage {
    const map = new Map<string, string>()

    const storage: Storage = {
      get length() {
        return map.size
      },
      clear: () => {
        map.clear()
      },
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => [...map.keys()][index] ?? null,
      removeItem: (key: string) => {
        map.delete(key)
      },
      setItem: (key: string, value: string) => {
        map.set(key, value)
      },
    }

    return storage
  }

  it('writes and reads back', () => {
    const store = createLocalOverlayStore(memoryStorage())
    const overlay = buildOverlay(snapshot([...BASELINE.entities, entity('d', 'Dave')]), BASELINE, NOW)

    expect(store.write(overlay)).toEqual({ ok: true })
    expect(store.read()?.entities.map((row) => row.id)).toEqual(['d'])
  })

  it('reports a full quota in words a person can act on', () => {
    const storage = memoryStorage()
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    const store = createLocalOverlayStore(storage)

    const result = store.write(buildOverlay(BASELINE, BASELINE, NOW))
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toMatch(/photo/)
  })

  it('survives the whole trip: save, reload, restore', () => {
    /*
      Through real storage rather than a JSON round-trip, because serialisation
      is the part that would quietly drop something.
    */
    const store = createLocalOverlayStore(memoryStorage())
    const current = snapshot([
      entity('a', 'Alice Renamed', { photo: 'data:image/jpeg;base64,abc' }),
      entity('c', 'Carol'),
      entity('d', 'Dave'),
    ])

    store.write(buildOverlay(current, BASELINE, NOW))

    const saved = store.read()
    expect(saved).not.toBeNull()
    const restored = applyOverlay(BASELINE, saved as NonNullable<typeof saved>)

    expect(restored.entities.map((row) => row.name).sort()).toEqual([
      'Alice Renamed',
      'Carol',
      'Dave',
    ])
    expect(restored.entities.find((row) => row.id === 'a')?.data.photo).toBe(
      'data:image/jpeg;base64,abc'
    )
  })

  it('treats unreadable saved data as no saved data rather than crashing', () => {
    const storage = memoryStorage()
    storage.setItem('artypest.overlay.v1', 'not json at all')
    expect(createLocalOverlayStore(storage).read()).toBeNull()
  })

  it('discards an overlay from a version it does not understand', () => {
    const storage = memoryStorage()
    storage.setItem('artypest.overlay.v1', JSON.stringify({ version: 99, entities: [] }))
    expect(createLocalOverlayStore(storage).read()).toBeNull()
  })

  it('works when the browser has no storage at all', () => {
    const store = createLocalOverlayStore(null)
    expect(store.read()).toBeNull()
    expect(store.write(buildOverlay(BASELINE, BASELINE, NOW)).ok).toBe(false)
    expect(() => store.clear()).not.toThrow()
  })
})

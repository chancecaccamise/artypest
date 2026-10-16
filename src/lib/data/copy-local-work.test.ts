import { describe, expect, it } from 'vitest'

import { planLocalWork } from './copy-local-work'
import { buildDemoData } from './fixtures'
import { buildOverlay } from './persistence'
import { isUuid, withStableIds } from './stable-ids'
import type { Entity, Relation } from './types'

const legacy = () =>
  buildDemoData(new Date('2026-10-16T00:00:00.000Z'), [], { includeTemporaryData: false })

const sharedTypes = () =>
  legacy().relationTypes.map((type) => ({ ...type, id: `db-${type.key}` }))

function entity(id: string, type: Entity['type'], name: string, data: Entity['data'] = {}): Entity {
  return {
    id,
    orgId: 'org',
    type,
    name,
    data,
    folderId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }
}

describe('copying a browser\'s work into the shared records', () => {
  it('moves every id onto the shared ones, and every reference with it', () => {
    const baseline = legacy()
    const tsnaPerson = baseline.entities.find((row) => row.type === 'person')
    const tsnaBusiness = baseline.entities.find((row) => row.type === 'business')
    if (!tsnaPerson || !tsnaBusiness) throw new Error('No supplied contacts')

    // An admin's afternoon: a phone number, a new owner from before ids were uuids, a to do for them.
    const greg = entity('ent-0003', 'person', 'Greg Goeken')
    const todo = entity('ent-0004', 'record', 'Call Greg', { recordType: 'todo', subjectId: 'ent-0003' })
    const owns: Relation = {
      id: 'rel-0001',
      orgId: 'org',
      relationTypeId: 'rt-owns',
      fromEntityId: greg.id,
      toEntityId: tsnaBusiness.id,
      startDate: null,
      endDate: null,
      attributes: {},
      createdAt: greg.createdAt,
      updatedAt: greg.createdAt,
      deletedAt: null,
      archivedAt: null,
    }
    const current = {
      ...baseline,
      entities: [
        ...baseline.entities.map((row) =>
          row.id === tsnaPerson.id ? { ...row, data: { ...row.data, phone: '912-555-0199' } } : row
        ),
        greg,
        todo,
      ],
      relations: [...baseline.relations, owns],
    }
    const overlay = buildOverlay(current, baseline, '2026-10-16T00:00:00.000Z')

    const work = planLocalWork(overlay, legacy(), sharedTypes())
    const { idMap } = withStableIds(legacy())

    expect(work.entities.every((row) => isUuid(row.id))).toBe(true)
    // The supplied contact lands on the id every browser builds for it.
    const edited = work.entities.find((row) => row.name === tsnaPerson.name)
    expect(edited?.id).toBe(idMap.get(tsnaPerson.id))
    expect(edited?.data.phone).toBe('912-555-0199')

    const newGreg = work.entities.find((row) => row.name === 'Greg Goeken')
    const newTodo = work.entities.find((row) => row.name === 'Call Greg')
    expect(newTodo?.data.subjectId).toBe(newGreg?.id)

    expect(work.relations).toHaveLength(1)
    expect(work.relations[0]).toMatchObject({
      relationTypeId: 'db-owns',
      fromEntityId: newGreg?.id,
      toEntityId: idMap.get(tsnaBusiness.id),
    })
  })

  it('has nothing to copy when nothing was changed', () => {
    const overlay = buildOverlay(legacy(), legacy(), '2026-10-16T00:00:00.000Z')
    expect(planLocalWork(overlay, legacy(), sharedTypes())).toEqual({ entities: [], relations: [] })
  })
})

import { describe, expect, it } from 'vitest'

import { buildDemoData } from './fixtures'
import { isUuid, stableUuid, withStableIds } from './stable-ids'

const client = () =>
  buildDemoData(new Date('2026-10-16T00:00:00.000Z'), [], { includeTemporaryData: false })

describe('stable ids', () => {
  it('gives the same key the same uuid, and different keys different ones', () => {
    expect(stableUuid('parcel:20065 38013')).toBe(stableUuid('parcel:20065 38013'))
    expect(stableUuid('parcel:20065 38013')).not.toBe(stableUuid('parcel:20065 38014'))
    expect(isUuid(stableUuid('anything'))).toBe(true)
  })

  it('puts every record and connection on a uuid Postgres will take', () => {
    const { data } = withStableIds(client())
    expect(data.entities.every((entity) => isUuid(entity.id))).toBe(true)
    expect(data.relations.every((relation) => isUuid(relation.id))).toBe(true)
    expect(new Set(data.entities.map((entity) => entity.id)).size).toBe(data.entities.length)
    expect(new Set(data.relations.map((relation) => relation.id)).size).toBe(data.relations.length)
  })

  it('builds the same ids in every browser', () => {
    expect(withStableIds(client()).data.entities.map((entity) => entity.id)).toEqual(
      withStableIds(client()).data.entities.map((entity) => entity.id)
    )
  })

  it('keeps connections pointing at the records they joined', () => {
    const before = client()
    const { data, idMap } = withStableIds(before)
    const first = before.relations[0]
    const after = data.relations[0]
    expect(after?.fromEntityId).toBe(idMap.get(first?.fromEntityId ?? ''))
    expect(after?.toEntityId).toBe(idMap.get(first?.toEntityId ?? ''))
  })
})

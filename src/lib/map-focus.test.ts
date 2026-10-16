import { describe, expect, it } from 'vitest'

import { buildDemoData } from '@/lib/data/fixtures'
import { resolveGraph } from '@/lib/insights'
import { startingRecord } from './map-focus'

describe('where the Connection Map opens', () => {
  it('opens on Thomas Square, which is not an HOA, rather than the first record loaded', () => {
    const client = buildDemoData(new Date('2026-10-16T00:00:00.000Z'), [], {
      includeTemporaryData: false,
    })
    const graph = resolveGraph(client)

    const start = startingRecord(graph, client.org.name)
    expect(start?.name).toBe('Thomas Square Neighborhood Association')
    expect(graph.relationsFor.get(start?.id ?? '')?.length ?? 0).toBeGreaterThan(0)
  })

  it('falls back to the most connected record when there is no association', () => {
    const client = buildDemoData(new Date('2026-10-16T00:00:00.000Z'), [], {
      includeTemporaryData: false,
    })
    const graph = resolveGraph({
      ...client,
      entities: client.entities.filter((entity) => entity.type !== 'association'),
    })

    const start = startingRecord(graph, client.org.name)
    expect(graph.relationsFor.get(start?.id ?? '')?.length ?? 0).toBeGreaterThan(0)
  })
})

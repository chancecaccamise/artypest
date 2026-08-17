import { describe, expect, it, vi } from 'vitest'

import { bestCandidate, createSagisGeocodingService } from './SagisGeocodingService'

/*
  No network. The candidate below is the real response for 7 E 46th St, copied
  from the live locator: score 98.89 at -81.102716603612, 32.050046587953.
*/

const REAL_CANDIDATE = {
  address: '7 E 46TH ST, SAVANNAH, 31405',
  score: 98.89,
  location: { x: -81.102716603612, y: 32.050046587953 },
}

/** fetch accepts three input shapes. Only a string is safe to read directly. */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function respond(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
}

function stubFetch(candidates: unknown[]) {
  const calls: string[] = []
  const impl = vi.fn((input: string | URL | Request) => {
    calls.push(urlOf(input))
    return respond({ candidates })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

describe('SagisGeocodingService', () => {
  it('returns the county locator match, longitude first', async () => {
    const { impl } = stubFetch([REAL_CANDIDATE])
    const service = createSagisGeocodingService({ fetchImpl: impl })

    const result = await service.lookup('7 E 46TH ST, SAVANNAH, GA')

    expect(result?.point).toEqual([-81.102716603612, 32.050046587953])
    expect(result?.matchedAddress).toBe('7 E 46TH ST, SAVANNAH, 31405')
  })

  it('asks for WGS84, because the locator is natively 2239', async () => {
    const { impl, calls } = stubFetch([REAL_CANDIDATE])
    const service = createSagisGeocodingService({ fetchImpl: impl })

    await service.lookup('7 E 46TH ST')

    expect(calls[0]).toContain('outSR=4326')
    expect(calls[0]).toContain('findAddressCandidates')
  })

  it('returns null for a weak match instead of placing a record on a guess', async () => {
    // A board posts notices to what the map says, so a low score has to be
    // treated as "not found" rather than as a location.
    const { impl } = stubFetch([{ ...REAL_CANDIDATE, score: 41 }])
    const service = createSagisGeocodingService({ fetchImpl: impl })

    expect(await service.lookup('7 E 46TH ST')).toBeNull()
  })

  it('treats an address the locator does not know as a normal answer', async () => {
    const { impl } = stubFetch([])
    const service = createSagisGeocodingService({ fetchImpl: impl })

    // Out-of-county owner addresses do this, and the record stays unplaced.
    expect(await service.lookup('4 Nowhere Plaza, Atlanta, GA')).toBeNull()
  })

  it('does not call out for a blank address', async () => {
    const { impl, calls } = stubFetch([REAL_CANDIDATE])
    const service = createSagisGeocodingService({ fetchImpl: impl })

    expect(await service.lookup('   ')).toBeNull()
    expect(await service.lookup(null)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('caches, because a plat render asks for the same address repeatedly', async () => {
    const { impl, calls } = stubFetch([REAL_CANDIDATE])
    const service = createSagisGeocodingService({ fetchImpl: impl })

    await service.lookup('7 E 46TH ST')
    await service.lookup('7 E 46TH ST')

    expect(calls).toHaveLength(1)
  })

  it('preserves one result per input in lookupMany, including the nulls', async () => {
    let call = 0
    const impl = vi.fn(() => {
      call += 1
      return respond({ candidates: call === 2 ? [] : [REAL_CANDIDATE] })
    }) as unknown as typeof fetch
    const service = createSagisGeocodingService({ fetchImpl: impl })

    const results = await service.lookupMany(['7 E 46TH ST', 'Nowhere', '9 E 46TH ST'])

    expect(results).toHaveLength(3)
    expect(results[1]).toBeNull()
    expect(results[0]).not.toBeNull()
  })

  it('picks the strongest candidate, not the first one', () => {
    const result = bestCandidate([
      { address: 'Weaker', score: 82, location: { x: -81.1, y: 32.05 } },
      { address: 'Stronger', score: 99, location: { x: -81.2, y: 32.06 } },
    ])

    expect(result?.matchedAddress).toBe('Stronger')
  })

  it('ignores a candidate with no usable coordinate', () => {
    expect(bestCandidate([{ address: 'Broken', score: 99, location: null }])).toBeNull()
  })

  it('reports itself as the SAGIS locator', () => {
    const { impl } = stubFetch([])
    expect(createSagisGeocodingService({ fetchImpl: impl }).kind).toBe('sagis')
  })
})

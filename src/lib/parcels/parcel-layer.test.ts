import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadParcelGeometry, loadParcelLayer, resetParcelGeometryCache } from './parcel-layer'

/*
  The harvested slice is not committed, so every fresh clone runs without it
  until `pnpm sagis:harvest`. Falling back has to be an ordinary state.
*/

function respond(body: unknown, contentType = 'application/json', status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: () => Promise.resolve(body),
  } as unknown as Response)
}

const RECORD = { pin: '20084 07008', situsAddress: '1402 E 49TH ST' }

beforeEach(() => {
  resetParcelGeometryCache()
})

describe('loadParcelLayer', () => {
  it('reads the slice when it is there', async () => {
    const fetchImpl = vi.fn(() => respond([RECORD])) as unknown as typeof fetch
    const layer = await loadParcelLayer(fetchImpl)

    expect(layer.source).toBe('harvest')
    expect(layer.records).toHaveLength(1)
  })

  it('falls back when the slice has not been generated', async () => {
    const fetchImpl = vi.fn(() => respond(null, 'application/json', 404)) as unknown as typeof fetch
    const layer = await loadParcelLayer(fetchImpl)

    expect(layer.source).toBe('fixture')
    expect(layer.records).toEqual([])
  })

  it('is not fooled by a dev server answering with index.html', async () => {
    /*
      Vite serves index.html at status 200 for any unknown path, so an ok
      response is not on its own proof the file exists. Verified against the
      real dev server: /parcels/nope.json returns 200 text/html.
    */
    const fetchImpl = vi.fn(() => respond('<!doctype html>', 'text/html')) as unknown as typeof fetch
    const layer = await loadParcelLayer(fetchImpl)

    expect(layer.source).toBe('fixture')
  })

  it('falls back rather than throwing when the network is gone', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch

    await expect(loadParcelLayer(fetchImpl)).resolves.toEqual({ records: [], source: 'fixture' })
  })

  it('treats an empty slice as no slice', async () => {
    const fetchImpl = vi.fn(() => respond([])) as unknown as typeof fetch
    expect((await loadParcelLayer(fetchImpl)).source).toBe('fixture')
  })
})

describe('loadParcelGeometry', () => {
  it('fetches once and reuses the answer', async () => {
    const fetchImpl = vi.fn(() =>
      respond({ type: 'FeatureCollection', features: [] })
    ) as unknown as typeof fetch

    await loadParcelGeometry(fetchImpl)
    await loadParcelGeometry(fetchImpl)

    // Six megabytes is not something to fetch twice.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns null when the geometry is absent, so the plat keeps the fixture', async () => {
    const fetchImpl = vi.fn(() => respond(null, 'text/html')) as unknown as typeof fetch
    expect(await loadParcelGeometry(fetchImpl)).toBeNull()
  })
})

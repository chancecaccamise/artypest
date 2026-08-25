import { describe, expect, it, vi } from 'vitest'

import { loadOverlay, loadOverlayIndex, resetOverlayCacheForTests } from './index'

/*
  Loading the district overlays.

  The absent cases matter more than the happy one. A clone that has not run
  `pnpm sagis:overlays` has no overlays, and a host that answers a missing path
  with index.html, which is what the SPA rewrite makes it do, answers 200 with
  HTML. Neither is an error, and neither may crash the plat.
*/

/*
  A fresh Response per call. A body can only be read once, so a mock that
  resolves to the same instance twice fails the second time for a reason that
  has nothing to do with the code: real fetch hands back a new one each time.
*/
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const html = () =>
  new Response('<!doctype html><div id="root"></div>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })

describe('the overlay index', () => {
  it('offers what the harvest wrote', async () => {
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(json([
        { id: 'commission', label: 'County Commission districts', note: '', areas: 8 },
        { id: 'sanitation', label: 'Sanitation collection days', note: '', areas: 20 },
      ]))
    )

    const rows = await loadOverlayIndex(fetchImpl)
    expect(rows.map((row) => row.id)).toEqual(['commission', 'sanitation'])
  })

  it('drops an overlay the county published with nothing in it', async () => {
    /*
      An entry with no areas is a boundary set that returned nothing for this
      area. Offering it means a reader picks it and the plat appears to break.
    */
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(json([
        { id: 'commission', label: 'County Commission districts', note: '', areas: 8 },
        { id: 'empty', label: 'Nothing here', note: '', areas: 0 },
      ]))
    )

    const rows = await loadOverlayIndex(fetchImpl)
    expect(rows.map((row) => row.id)).toEqual(['commission'])
  })

  it('offers nothing when the harvest has not been run', async () => {
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 404 })))

    await expect(loadOverlayIndex(fetchImpl)).resolves.toEqual([])
  })

  it('is not fooled by a host that answers a missing file with the app', async () => {
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(html()))

    await expect(loadOverlayIndex(fetchImpl)).resolves.toEqual([])
  })

  it('survives being offline', async () => {
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(loadOverlayIndex(fetchImpl)).resolves.toEqual([])
  })

  it('asks once, however many times it is read', async () => {
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(json([])))

    await loadOverlayIndex(fetchImpl)
    await loadOverlayIndex(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('loading one set of boundaries', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'District 3', detail: 'Linda Wilder-Bryan' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      },
    ],
  }

  it('fetches the file named for the id', async () => {
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(json(collection)))

    const loaded = await loadOverlay('aldermanic', fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('/overlays/aldermanic.json')
    expect(loaded?.features).toHaveLength(1)
  })

  it('caches per id, so switching back is not another round trip', async () => {
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(json(collection)))

    await loadOverlay('aldermanic', fetchImpl)
    await loadOverlay('aldermanic', fetchImpl)
    await loadOverlay('commission', fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns nothing rather than throwing when the file is absent', async () => {
    resetOverlayCacheForTests()
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 404 })))

    await expect(
      loadOverlay('commission', fetchImpl)
    ).resolves.toBeNull()
  })
})

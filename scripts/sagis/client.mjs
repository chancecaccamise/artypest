/*
  A thin SAGIS client with one job beyond fetching: never return an incomplete
  answer without saying so.

  The reason this file exists is a measured behaviour of the service. Asking for
  N features never returns N when geometry is involved:

    asked   60 -> got   53
    asked  200 -> got  191
    asked  500 -> got  487
    asked 1000 -> got  974
    asked 2000 -> got 1957

  Every one of those set exceededTransferLimit. So resultOffset paging, which is
  the obvious way to walk a layer, silently drops 2% to 12% of the rows. That is
  precisely how a harvest ends up missing parcels without anyone noticing.

  Fetching by explicit objectIds does not do this. Asking for 250 specific IDs
  returns exactly those 250. So the harvest works in two steps:

    1. returnIdsOnly, which answers with the complete ID list in one request
    2. fetch those IDs in chunks, and assert that every requested ID came back

  That turns coverage from something hoped for into something checked.
*/

export const BASE_URL = 'https://pub.sagis.org/arcgis/rest/services'

export const PARCEL_LAYER = 'OpenData/Parcels/FeatureServer/27'
export const ZONING_LAYER = 'Savannah/ZoningDevelopment_Map/MapServer/6'
export const NEIGHBORHOOD_LAYER = 'OpenData/Community/MapServer/10'
export const ROADS_LAYER = 'OpenData/Transportation/MapServer/1'

/** Explicit-ID fetches are exact, so this is a URL-length limit, not a data one. */
export const ID_CHUNK_SIZE = 250

const RETRIES = 3
const RETRY_PAUSE_MS = 1500

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/*
  POST rather than GET. Neighborhood polygons and 250-item ID lists both blow
  past what a URL will carry, and the service accepts form-encoded queries.
*/
export async function query(layer, params, options = {}) {
  const url = `${(options.baseUrl ?? BASE_URL).replace(/\/+$/, '')}/${layer}/query`
  let lastError = null

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ f: 'json', ...params }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const body = await response.json()
      if (body.error) throw new Error(`service error: ${JSON.stringify(body.error)}`)
      return body
    } catch (error) {
      lastError = error
      // A municipal server doing the county a favour deserves a pause.
      if (attempt < RETRIES) await pause(RETRY_PAUSE_MS * attempt)
    }
  }

  throw new Error(`${layer} failed after ${RETRIES} attempts: ${lastError?.message ?? 'unknown'}`)
}

/**
 * The complete list of OBJECTIDs matching a query, in one request.
 *
 * This is the manifest everything else is checked against. It is not subject to
 * the transfer limit, because IDs are small.
 */
export async function objectIdsFor(layer, params, options) {
  const body = await query(layer, { ...params, returnIdsOnly: 'true' }, options)
  const ids = body.objectIds ?? body.properties?.objectIds ?? []
  return [...new Set(ids)]
}

/**
 * Fetches features by explicit ID, and refuses to quietly return fewer than
 * were asked for.
 *
 * Anything still missing after the retries is returned rather than thrown, so
 * the caller can report exactly which parcels are unaccounted for instead of
 * losing the whole run.
 */
export async function fetchByIds(layer, ids, params, options = {}) {
  const features = []
  const seen = new Set()
  const onProgress = options.onProgress ?? (() => {})

  for (let index = 0; index < ids.length; index += ID_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + ID_CHUNK_SIZE)
    const body = await query(
      layer,
      { ...params, objectIds: chunk.join(','), outSR: '4326', f: 'geojson' },
      options
    )

    for (const feature of body.features ?? []) {
      const id = feature.id ?? feature.properties?.OBJECTID
      if (id === undefined || seen.has(id)) continue
      seen.add(id)
      features.push(feature)
    }

    onProgress(Math.min(index + ID_CHUNK_SIZE, ids.length), ids.length)
  }

  const missing = ids.filter((id) => !seen.has(id))
  return { features, missing }
}

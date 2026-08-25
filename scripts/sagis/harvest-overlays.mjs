/*
  Harvests the district overlays listed in scripts/sagis/overlays.mjs.

    pnpm sagis:overlays

  Small compared to the parcels: sixteen boundary sets, a few hundred polygons
  each at most, against 16,656 lots. It still goes through objectIdsFor and
  fetchByIds rather than a plain query, for the same reason the parcel harvest
  does: SAGIS truncates any query returning geometry and reports it only through
  a flag that is easy to miss. A silently clipped district boundary is worse
  than a missing one, because it looks like a real edge.

  Clipped to the extent of the harvested parcels, read from the coverage
  manifest. Three of these layers are statewide, and Georgia's 180 House
  districts are not something to serve to a browser looking at Ardsley Park.

  Output, committed for the same reason the parcel slice is: the deployed site
  is static files with no database behind it.

    public/overlays/<id>.json     one GeoJSON FeatureCollection each
    public/overlays/index.json    what exists, for the picker
*/

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { OVERLAYS } from './overlays.mjs'
import { fetchByIds, objectIdsFor } from './client.mjs'

const COORD_PRECISION = 5

/*
  Vertex spacing the service simplifies to, in degrees. About two metres, which
  is finer than a boundary drawn as a two pixel stroke can show and finer than
  the five decimal places these are rounded to.

  Worth doing rather than serving what the county holds. A single congressional
  district arrived as 343KB of coastline before this: statewide polygons follow
  every marsh edge in Georgia, and the plat draws about four kilometres of it.
*/
const SIMPLIFY_DEGREES = '0.00002'

const manifest = JSON.parse(
  readFileSync('src/lib/parcels/coverage-manifest.json', 'utf8')
)
const extent = manifest.extent

const envelope = {
  geometry: JSON.stringify(extent),
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
  where: '1=1',
}

/*
  Five decimal places is about a metre. A district boundary is a legal line on a
  map, not a survey, and the plat draws it as a stroke two pixels wide.
*/
function roundGeometry(geometry) {
  if (!geometry) return null
  const round = (value) => Number(value.toFixed(COORD_PRECISION))
  const walk = (node) => (typeof node[0] === 'number' ? node.map(round) : node.map(walk))
  return { type: geometry.type, coordinates: walk(geometry.coordinates) }
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

console.log(`Overlays: ${OVERLAYS.length}`)
console.log(`Clipped to ${JSON.stringify(extent)}\n`)

const index = []

for (const overlay of OVERLAYS) {
  const features = []
  let missingTotal = 0

  for (const source of overlay.sources) {
    const ids = await objectIdsFor(source.layer, envelope)
    if (ids.length === 0) continue

    const fetched = await fetchByIds(
      source.layer,
      ids,
      {
        outFields: source.fields,
        returnGeometry: 'true',
        maxAllowableOffset: SIMPLIFY_DEGREES,
      },
      {}
    )
    missingTotal += fetched.missing.length

    for (const feature of fetched.features) {
      if (!feature.geometry) continue
      const properties = feature.properties ?? {}
      const name = overlay.name(properties)
      // An area with no name cannot be labelled and cannot be looked up, so it
      // is reported rather than drawn as an anonymous shape.
      if (name === '') continue

      features.push({
        type: 'Feature',
        properties: { name, detail: overlay.detail(properties) },
        geometry: roundGeometry(feature.geometry),
      })
    }
  }

  if (missingTotal > 0) {
    console.error(
      `\nFAILED: ${overlay.id} had ${missingTotal} features that did not come back.`
    )
    process.exit(1)
  }

  // Stable order, so a re-harvest is a readable diff rather than a reshuffle.
  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name))

  const path = `public/overlays/${overlay.id}.json`
  write(path, JSON.stringify({ type: 'FeatureCollection', features }))

  const bytes = JSON.stringify({ type: 'FeatureCollection', features }).length
  console.log(
    `  ${String(features.length).padStart(4)}  ${overlay.label.padEnd(34)} ${(bytes / 1024).toFixed(0)}KB`
  )

  index.push({
    id: overlay.id,
    label: overlay.label,
    note: overlay.note ?? '',
    areas: features.length,
  })
}

write('public/overlays/index.json', JSON.stringify(index, null, 2) + '\n')

console.log(`\n  ${index.length} overlays written to public/overlays/`)
const empty = index.filter((row) => row.areas === 0)
if (empty.length > 0) {
  console.log(
    `  ${empty.length} came back empty and will not be offered: ${empty.map((row) => row.id).join(', ')}`
  )
}

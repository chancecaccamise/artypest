/*
  Harvests every parcel in the corridor defined by scripts/sagis/coverage.mjs.

    pnpm sagis:harvest

  The point of this script is not that it downloads parcels. It is that it can
  prove it downloaded all of them.

  SAGIS truncates any query that returns geometry, and says so only through an
  exceededTransferLimit flag that is easy to ignore. Asking for 2000 features
  returns 1957. Asking for 60 returns 53. So walking the layer with resultOffset,
  which is the obvious approach and the one the old fetch-sagis-fixture.mjs used,
  loses between 2% and 12% of rows silently. That is how a map ends up missing a
  neighborhood.

  This instead asks for the complete OBJECTID list in one request, which is not
  subject to the limit, then fetches those exact IDs in chunks and checks that
  every one came back. Coverage stops being something we hope for.

  Output, none of it committed except the manifest:

    data/sagis/parcels.ndjson             full records with geometry, for Postgres
    public/parcels/attributes.json        slim, no geometry, for the app
    public/parcels/geometry.json          GeoJSON, lazy loaded by the map
    src/lib/parcels/coverage-manifest.json  what was covered, and how completely

  Nothing here is random and nothing reads the clock except the harvest date, so
  two runs against an unchanged service produce the same data.
*/

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import centroid from '@turf/centroid'

import {
  CORRIDOR,
  DRIFT_TOLERANCE,
  EXCLUDED_NEIGHBORHOODS,
  EXPECTED_PARCEL_COUNT,
  NEIGHBORHOOD_TOTALS,
} from './coverage.mjs'
import {
  fetchByIds,
  NEIGHBORHOOD_LAYER,
  objectIdsFor,
  PARCEL_LAYER,
  query,
  ZONING_LAYER,
} from './client.mjs'

const PARCEL_FIELDS = [
  'OBJECTID',
  'PIN',
  'Owner',
  'Owner2',
  'Mailing_Address',
  'Mailing_City',
  'Mailing_State',
  'Mailing_Zip',
  'PropAddress_Full',
  'Municipality',
  'Property_Use',
  'Acres',
  'YearBuilt',
  'FairMarketValue',
  'Total_Assessment',
  'Legal_Description',
  'Date_Updated',
].join(',')

/** Six decimal places is about 11cm, far finer than a plat drawing can show. */
const COORD_PRECISION = 6

const envelope = {
  geometry: JSON.stringify(CORRIDOR),
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
}

/* ---------------------------------------------------------------- helpers -- */

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value) {
  const result = text(value)
  return result === '' ? null : result
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The county publishes epoch milliseconds and no assessment year. */
function isoDate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function roundGeometry(geometry) {
  if (!geometry) return geometry
  const round = (value) => Number(value.toFixed(COORD_PRECISION))
  const walk = (node) => (typeof node[0] === 'number' ? node.map(round) : node.map(walk))
  return { type: geometry.type, coordinates: walk(geometry.coordinates) }
}

function ringsOf(geometry) {
  if (!geometry) return []
  return geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : geometry.coordinates
}

function bboxOf(geometry) {
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity
  for (const ring of ringsOf(geometry)) {
    for (const [x, y] of ring) {
      if (x < xmin) xmin = x
      if (y < ymin) ymin = y
      if (x > xmax) xmax = x
      if (y > ymax) ymax = y
    }
  }
  return [xmin, ymin, xmax, ymax]
}

/**
 * Point in polygon over a set of features, with a bounding-box prefilter.
 *
 * 10,399 parcels against several hundred districts is a few million tests
 * without one, and the prefilter turns almost all of them into four number
 * comparisons.
 */
function makeLocator(features) {
  const indexed = features
    .filter((feature) => feature.geometry)
    .map((feature) => ({ feature, bbox: bboxOf(feature.geometry) }))

  return (point) => {
    const [x, y] = point.geometry.coordinates
    for (const { feature, bbox } of indexed) {
      if (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3]) continue
      try {
        if (booleanPointInPolygon(point, feature)) return feature
      } catch {
        // One malformed polygon must not stop the run.
      }
    }
    return null
  }
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function progress(label) {
  return (done, total) => {
    process.stdout.write(`\r  ${label}: ${done}/${total}`)
    if (done >= total) process.stdout.write('\n')
  }
}

/* ---------------------------------------------------------------- harvest -- */

console.log('Corridor:', JSON.stringify(CORRIDOR))

console.log('\nAsking for the complete parcel ID list...')
const ids = await objectIdsFor(PARCEL_LAYER, envelope)
console.log(`  ${ids.length.toLocaleString()} parcels in the corridor`)

const drift = Math.abs(ids.length - EXPECTED_PARCEL_COUNT) / EXPECTED_PARCEL_COUNT
if (drift > DRIFT_TOLERANCE) {
  console.warn(
    `  WARNING: expected about ${EXPECTED_PARCEL_COUNT.toLocaleString()}, ` +
      `which is ${(drift * 100).toFixed(1)}% away. The county may have republished.`
  )
}

console.log('\nFetching parcels by ID...')
let { features, missing } = await fetchByIds(
  PARCEL_LAYER,
  ids,
  { outFields: PARCEL_FIELDS, returnGeometry: 'true' },
  { onProgress: progress('parcels') }
)

if (missing.length > 0) {
  // One retry. Explicit-ID fetches are exact, so a gap here is a transport
  // failure rather than the service truncating.
  console.log(`  ${missing.length} did not come back. Retrying those...`)
  const retry = await fetchByIds(
    PARCEL_LAYER,
    missing,
    { outFields: PARCEL_FIELDS, returnGeometry: 'true' },
    { onProgress: progress('retry') }
  )
  features = [...features, ...retry.features]
  missing = retry.missing
}

if (features.length !== ids.length) {
  console.error(
    `\nFAILED: asked for ${ids.length.toLocaleString()} parcels and got ` +
      `${features.length.toLocaleString()}. Unaccounted for: ${missing.slice(0, 20).join(', ')}` +
      (missing.length > 20 ? ` and ${missing.length - 20} more` : '')
  )
  process.exit(1)
}
console.log(`  all ${features.length.toLocaleString()} accounted for`)

/* ---------------------------------------------------------- neighborhoods -- */

console.log('\nFetching neighborhood boundaries...')
const neighborhoods = await query(NEIGHBORHOOD_LAYER, {
  ...envelope,
  outFields: 'NAME',
  outSR: '4326',
  returnGeometry: 'true',
  f: 'geojson',
})
const neighborhoodFeatures = neighborhoods.features ?? []
console.log(`  ${neighborhoodFeatures.length} neighborhoods touch the corridor`)
const locateNeighborhood = makeLocator(neighborhoodFeatures)

console.log('\nFetching zoning districts...')
const zoning = await query(ZONING_LAYER, {
  ...envelope,
  outFields: 'ZONE,ZONING_DISTRICT',
  outSR: '4326',
  returnGeometry: 'true',
  f: 'geojson',
})
const zoningFeatures = zoning.features ?? []
console.log(`  ${zoningFeatures.length} zoning polygons`)
const locateZoning = makeLocator(zoningFeatures)

/* ----------------------------------------------------------------- build -- */

console.log('\nBuilding records...')

const excluded = new Set(EXCLUDED_NEIGHBORHOODS)
const records = []
const geometryFeatures = []
const byNeighborhood = new Map()
const seenPins = new Set()

let droppedExcluded = 0
let duplicatePins = 0
let withoutNeighborhood = 0
let withoutZoning = 0

for (const feature of features) {
  const properties = feature.properties ?? {}
  const pin = text(properties.PIN)
  if (pin === '' || !feature.geometry) continue

  const point = centroid(feature)
  const neighborhood = locateNeighborhood(point)
  const name = neighborhood ? text(neighborhood.properties.NAME) : ''

  if (excluded.has(name)) {
    droppedExcluded += 1
    continue
  }
  // The same parcel is returned once per query, but a PIN can repeat in the
  // roll, and two records for one lot would double every figure downstream.
  if (seenPins.has(pin)) {
    duplicatePins += 1
    continue
  }
  seenPins.add(pin)

  if (name === '') withoutNeighborhood += 1

  const district = locateZoning(point)
  const zoningDistrict = district ? optionalText(district.properties.ZONE) : null
  if (zoningDistrict === null) withoutZoning += 1

  records.push({
    pin,
    situsAddress: text(properties.PropAddress_Full),
    ownerName: text(properties.Owner),
    ownerName2: optionalText(properties.Owner2),
    ownerMailingAddress: {
      street: text(properties.Mailing_Address),
      city: text(properties.Mailing_City),
      state: text(properties.Mailing_State),
      zip: text(properties.Mailing_Zip),
    },
    acreage: num(properties.Acres),
    zoningDistrict,
    propertyUseCode: optionalText(properties.Property_Use),
    fairMarketValue: num(properties.FairMarketValue),
    totalAssessment: num(properties.Total_Assessment),
    yearBuilt:
      typeof properties.YearBuilt === 'number' && properties.YearBuilt > 0
        ? properties.YearBuilt
        : null,
    legalDescription: text(properties.Legal_Description),
    municipalityCode: optionalText(properties.Municipality),
    dateUpdated: isoDate(properties.Date_Updated),
    neighborhood: name === '' ? null : name,
  })

  geometryFeatures.push({
    type: 'Feature',
    properties: { pin },
    geometry: roundGeometry(feature.geometry),
  })

  byNeighborhood.set(name, (byNeighborhood.get(name) ?? 0) + 1)
}

// Stable order, so a re-harvest is a readable diff rather than a reshuffle.
records.sort((a, b) => a.pin.localeCompare(b.pin))
geometryFeatures.sort((a, b) => a.properties.pin.localeCompare(b.properties.pin))

/* ---------------------------------------------------------------- outputs -- */

const harvestedAt = new Date().toISOString().slice(0, 10)

write(
  'data/sagis/parcels.ndjson',
  records
    .map((record, index) =>
      JSON.stringify({ ...record, geometry: geometryFeatures[index]?.geometry ?? null })
    )
    .join('\n') + '\n'
)

write('public/parcels/attributes.json', JSON.stringify(records))
write(
  'public/parcels/geometry.json',
  JSON.stringify({ type: 'FeatureCollection', features: geometryFeatures })
)

const coverage = [...byNeighborhood.entries()]
  .map(([name, harvested]) => ({
    neighborhood: name === '' ? '(outside every neighborhood boundary)' : name,
    harvested,
    inNeighborhood: NEIGHBORHOOD_TOTALS[name] ?? null,
    // A neighborhood the corridor only clips. Expected, and recorded so it is
    // never mistaken later for a gap.
    partial: NEIGHBORHOOD_TOTALS[name] === undefined ? null : harvested < NEIGHBORHOOD_TOTALS[name],
  }))
  .sort((a, b) => b.harvested - a.harvested)

write(
  'src/lib/parcels/coverage-manifest.json',
  JSON.stringify(
    {
      harvestedAt,
      corridor: CORRIDOR,
      bounds: {
        west: 'MLK Jr Blvd',
        east: 'E Broad St',
        north: 'Savannah River',
        south: 'DeRenne Ave',
      },
      excludedNeighborhoods: EXCLUDED_NEIGHBORHOODS,
      parcels: records.length,
      neighborhoods: coverage.length,
      coverage,
    },
    null,
    2
  ) + '\n'
)

/* ---------------------------------------------------------------- summary -- */

console.log(`\n  ${records.length.toLocaleString()} parcels written`)
console.log(`  ${coverage.length} neighborhoods`)
if (droppedExcluded > 0) console.log(`  ${droppedExcluded} dropped as excluded (across the river)`)
if (duplicatePins > 0) console.log(`  ${duplicatePins} dropped as duplicate PINs`)
if (withoutNeighborhood > 0)
  console.log(`  ${withoutNeighborhood} outside every neighborhood boundary`)
if (withoutZoning > 0) console.log(`  ${withoutZoning} with no zoning district`)

console.log('\n  Coverage by neighborhood:')
for (const row of coverage) {
  const of = row.inNeighborhood === null ? '' : ` of ${row.inNeighborhood}`
  const flag = row.partial === true ? '  (clipped by the corridor)' : ''
  console.log(`    ${String(row.harvested).padStart(5)}${of.padEnd(9)}  ${row.neighborhood}${flag}`)
}

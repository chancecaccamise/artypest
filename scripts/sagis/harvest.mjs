/*
  Harvests every parcel in the neighborhoods listed in scripts/sagis/coverage.mjs.

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

  Selection is by neighborhood boundary, not by a rectangle. The ID list is
  asked for once per neighborhood, so the manifest can report what the service
  says the neighborhood holds beside what was written, from the same run. See
  coverage.mjs for why the rectangle had to go.

  Output, none of it committed except the manifest:

    data/sagis/parcels.ndjson             full records with geometry, for Postgres
    public/parcels/attributes.json        slim, no geometry, for the app
    public/parcels/geometry.json          GeoJSON, lazy loaded by the map
    public/parcels/streets.json           street centrelines, lazy loaded
    src/lib/parcels/coverage-manifest.json  what was covered, and how completely

  Nothing here is random and nothing reads the clock except the harvest date, so
  two runs against an unchanged service produce the same data.
*/

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import centroid from '@turf/centroid'

import { DRIFT_TOLERANCE, EXPECTED_PARCEL_COUNT, NEIGHBORHOODS } from './coverage.mjs'
import {
  fetchByIds,
  NEIGHBORHOOD_LAYER,
  objectIdsFor,
  PARCEL_LAYER,
  query,
  ROADS_LAYER,
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
  'Sale_Price',
  'Sale_YY',
  'Sale_MM',
  'Sale_DD',
  'Sale_Quality',
].join(',')

/** Six decimal places is about 11cm, far finer than a plat drawing can show. */
const COORD_PRECISION = 6

/** Neighborhood polygons are large, so they are asked for a few at a time. */
const BOUNDARY_CHUNK_SIZE = 20

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

/*
  The last recorded transfer, as an ISO date.

  The county publishes the parts separately, and a four digit year, so there is
  no century to guess at. Measured across the harvested extent: 94% of parcels
  carry a year and every one of those carries a month and a day, so a partial
  date is not a case that needs handling. A year of 0 or absent means no
  transfer has been recorded, which is a fact rather than a gap.
*/
function saleDate(year, month, day) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isFinite(y) || y <= 0) return null
  if (!Number.isFinite(m) || m < 1 || m > 12) return null
  if (!Number.isFinite(d) || d < 1 || d > 31) return null

  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  // The county has real dates back to 1910 and the odd impossible one, such as
  // a 31st of February, which Date normalises into the next month rather than
  // rejecting. Round tripping catches those.
  const parsed = new Date(`${iso}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso
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
 * 16,698 parcels against several hundred districts is a few million tests
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

/**
 * A neighborhood boundary as query geometry.
 *
 * The rings come back from the service in Esri's own JSON, so their winding is
 * already what the service expects: clockwise for an outer ring, the other way
 * for a hole. Converting GeoJSON back into rings would invert that and turn a
 * neighborhood into its own hole.
 */
function polygonQuery(rings) {
  return {
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
  }
}

/* ----------------------------------------------------------- boundaries -- */

console.log(`Coverage: ${NEIGHBORHOODS.length} neighborhoods, complete to their own boundaries`)

console.log('\nFetching neighborhood boundaries...')
const quoted = NEIGHBORHOODS.map((name) => `'${name.replace(/'/g, "''")}'`).join(',')
const boundaryIds = await objectIdsFor(NEIGHBORHOOD_LAYER, { where: `NAME IN (${quoted})` })

/*
  Twice, in two formats, because they are needed for two different things and
  converting between them is where the winding-order bugs live. Esri rings go
  to the service as query geometry; GeoJSON goes to turf to decide which
  neighborhood a lot's centroid falls in.
*/
const ringsByName = new Map()
const boundaryFeatures = []

for (let index = 0; index < boundaryIds.length; index += BOUNDARY_CHUNK_SIZE) {
  const chunk = boundaryIds.slice(index, index + BOUNDARY_CHUNK_SIZE).join(',')
  const params = { objectIds: chunk, outFields: 'NAME', returnGeometry: 'true', outSR: '4326' }

  const esri = await query(NEIGHBORHOOD_LAYER, params)
  for (const feature of esri.features ?? []) {
    const name = text(feature.attributes?.NAME)
    // A neighborhood can be published as several rows. Its boundary is all of them.
    const rings = ringsByName.get(name) ?? []
    rings.push(...(feature.geometry?.rings ?? []))
    ringsByName.set(name, rings)
  }

  const geo = await query(NEIGHBORHOOD_LAYER, { ...params, f: 'geojson' })
  boundaryFeatures.push(...(geo.features ?? []))
}

const missingNames = NEIGHBORHOODS.filter((name) => (ringsByName.get(name) ?? []).length === 0)
if (missingNames.length > 0) {
  console.error(
    `\nFAILED: the service published no boundary for ${missingNames.join(', ')}. ` +
      'Check the spelling in coverage.mjs against the NAME field.'
  )
  process.exit(1)
}
console.log(`  ${ringsByName.size} boundaries, ${boundaryFeatures.length} polygons`)

const locateNeighborhood = makeLocator(boundaryFeatures)

/*
  Every ring from every selected neighborhood, as one query geometry. Used for
  the streets, which have to cover the same ground the lots do and no more.
*/
const coverageRings = [...ringsByName.values()].flat()

/* -------------------------------------------------------------- parcel IDs -- */

/*
  One ID list per neighborhood rather than one for the union. It costs 27
  requests instead of one and buys the number this whole file exists to report:
  what the neighborhood holds, straight from the service, next to what we wrote.
*/
console.log('\nAsking for the parcel ID list, one neighborhood at a time...')

const totalByNeighborhood = new Map()
const parcelIds = new Set()

for (const name of NEIGHBORHOODS) {
  const ids = await objectIdsFor(PARCEL_LAYER, polygonQuery(ringsByName.get(name)))
  totalByNeighborhood.set(name, ids.length)
  for (const id of ids) parcelIds.add(id)
  console.log(`  ${String(ids.length).padStart(5)}  ${name}`)
}

// A lot on a shared boundary is returned by both of its neighbors.
const ids = [...parcelIds]
console.log(`  ${ids.length.toLocaleString()} distinct parcels across all of them`)

const drift = Math.abs(ids.length - EXPECTED_PARCEL_COUNT) / EXPECTED_PARCEL_COUNT
if (drift > DRIFT_TOLERANCE) {
  console.warn(
    `  WARNING: expected about ${EXPECTED_PARCEL_COUNT.toLocaleString()}, ` +
      `which is ${(drift * 100).toFixed(1)}% away. The county may have republished.`
  )
}

/* ---------------------------------------------------------------- parcels -- */

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

/* ---------------------------------------------------------------- zoning -- */

/*
  An envelope is right here where it was wrong for the parcels. Zoning is only
  ever read by asking which district a point falls in, so a few polygons beyond
  the edge cost one bounding-box comparison each and nothing else.
*/
let xmin = Infinity
let ymin = Infinity
let xmax = -Infinity
let ymax = -Infinity
for (const ring of coverageRings) {
  for (const [x, y] of ring) {
    if (x < xmin) xmin = x
    if (y < ymin) ymin = y
    if (x > xmax) xmax = x
    if (y > ymax) ymax = y
  }
}
const extent = { xmin, ymin, xmax, ymax }

console.log('\nFetching zoning districts...')
const zoning = await query(ZONING_LAYER, {
  geometry: JSON.stringify(extent),
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
  outFields: 'ZONE,ZONING_DISTRICT',
  outSR: '4326',
  returnGeometry: 'true',
  f: 'geojson',
})
const zoningFeatures = zoning.features ?? []
console.log(`  ${zoningFeatures.length} zoning polygons`)
const locateZoning = makeLocator(zoningFeatures)

/* --------------------------------------------------------------- streets -- */

/*
  The street centrelines are what make the plat readable at anything wider than
  a block. Zoomed out to the whole map a lot is about three square pixels, so
  the parcels read as a tint and the streets carry the structure.

  Fetched by ID for the same reason the parcels are: six thousand segments is
  well past the point where the transfer limit starts quietly dropping rows.
*/
console.log('\nFetching street centrelines...')
const roadIds = await objectIdsFor(ROADS_LAYER, polygonQuery(coverageRings))
console.log(`  ${roadIds.length.toLocaleString()} segments across the neighborhoods`)

const roads = await fetchByIds(
  ROADS_LAYER,
  roadIds,
  { outFields: 'OBJECTID,FULLNAME,RD_CLASS', returnGeometry: 'true' },
  { onProgress: progress('streets') }
)

if (roads.missing.length > 0) {
  console.error(`\nFAILED: ${roads.missing.length} street segments did not come back.`)
  process.exit(1)
}

/*
  Census feature class codes. A2 and A3 are arterials, which the plat draws
  heavier than the residential streets around the lots.
*/
function classify(code) {
  const value = text(code)
  return value.startsWith('A2') || value.startsWith('A3') ? 'through' : 'local'
}

const streetFeatures = []
const seenStreets = new Set()
for (const feature of roads.features) {
  const name = text(feature.properties?.FULLNAME)
  if (name === '' || !feature.geometry) continue

  const key = `${name}|${JSON.stringify(feature.geometry.coordinates)}`
  if (seenStreets.has(key)) continue
  seenStreets.add(key)

  streetFeatures.push({
    type: 'Feature',
    properties: { name, classification: classify(feature.properties?.RD_CLASS) },
    geometry: roundGeometry(feature.geometry),
  })
}
streetFeatures.sort((a, b) => a.properties.name.localeCompare(b.properties.name))

/* ----------------------------------------------------------------- build -- */

console.log('\nBuilding records...')

const selected = new Set(NEIGHBORHOODS)
const records = []
const geometryFeatures = []
const byNeighborhood = new Map()
const seenPins = new Set()

let outsideSelection = 0
let duplicatePins = 0
let withoutZoning = 0
let multiPolygons = 0

for (const feature of features) {
  const properties = feature.properties ?? {}
  const pin = text(properties.PIN)
  if (pin === '' || !feature.geometry) continue

  const point = centroid(feature)
  const neighborhood = locateNeighborhood(point)
  const name = neighborhood ? text(neighborhood.properties.NAME) : ''

  /*
    A lot belongs to whichever neighborhood its centroid sits in, so that one
    lot is one record in one place. A lot that merely touches the edge of a
    selected neighborhood can be centred in one we did not ask for, and taking
    it would quietly extend coverage past the list in coverage.mjs. It is
    dropped and counted instead.
  */
  if (!selected.has(name)) {
    outsideSelection += 1
    continue
  }
  // The same parcel is returned once per query, but a PIN can repeat in the
  // roll, and two records for one lot would double every figure downstream.
  if (seenPins.has(pin)) {
    duplicatePins += 1
    continue
  }
  seenPins.add(pin)

  if (feature.geometry.type === 'MultiPolygon') multiPolygons += 1

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
    lastSaleDate: saleDate(properties.Sale_YY, properties.Sale_MM, properties.Sale_DD),
    /*
      Null rather than zero when nothing was recorded. A third of the parcels
      that carry a transfer date carry no price with it, which is a real kind of
      transfer, not a missing number: a gift, a family transfer, a foreclosure.
      Zero would be read as "sold for nothing".
    */
    lastSalePrice: num(properties.Sale_Price) > 0 ? num(properties.Sale_Price) : null,
    saleQualityCode: optionalText(properties.Sale_Quality),
    neighborhood: name,
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
write(
  'public/parcels/streets.json',
  JSON.stringify({ type: 'FeatureCollection', features: streetFeatures })
)

/*
  Two numbers per neighborhood, and they answer two different questions.

  `touching` is what the service reports: every parcel whose geometry meets the
  boundary, which includes lots on a shared edge that belong to the neighbor.
  `harvested` is how many are centred inside it, which is how a lot is assigned
  to exactly one neighborhood. So `touching` is always the larger of the two,
  and the difference is not a gap. Reporting the first as though it were the
  target is what made an earlier run claim 15 neighborhoods were short when
  every parcel was accounted for.

  The completeness claim lives in `accounting` below, where it can be checked
  by addition.
*/
const coverage = NEIGHBORHOODS.map((name) => {
  const harvested = byNeighborhood.get(name) ?? 0
  const touching = totalByNeighborhood.get(name) ?? 0
  return { neighborhood: name, harvested, touching, sharedWithNeighbor: touching - harvested }
}).sort((a, b) => b.harvested - a.harvested)

/*
  Every parcel the service offered, and where each one went. These must add up,
  and the harvest fails if they do not: that is the whole coverage claim in four
  numbers.
*/
const accounting = {
  idsReturnedByService: ids.length,
  fetched: features.length,
  written: records.length,
  centredOutsideSelection: outsideSelection,
  duplicatePins,
}

const unaccounted =
  accounting.fetched - accounting.written - accounting.centredOutsideSelection - duplicatePins
if (unaccounted !== 0) {
  console.error(
    `\nFAILED: ${accounting.fetched} parcels fetched but ${accounting.written} written, ` +
      `${accounting.centredOutsideSelection} centred elsewhere and ${duplicatePins} duplicate ` +
      `PINs. ${unaccounted} unaccounted for.`
  )
  process.exit(1)
}

write(
  'src/lib/parcels/coverage-manifest.json',
  JSON.stringify(
    {
      harvestedAt,
      selection: 'neighborhood',
      neighborhoods: [...NEIGHBORHOODS].sort((a, b) => a.localeCompare(b)),
      extent,
      parcels: records.length,
      accounting,
      coverage,
    },
    null,
    2
  ) + '\n'
)

/* ---------------------------------------------------------------- summary -- */

console.log(`\n  ${records.length.toLocaleString()} parcels written`)
console.log(`  ${streetFeatures.length.toLocaleString()} street segments written`)
console.log(`  ${coverage.length} neighborhoods`)
console.log(`  ${multiPolygons.toLocaleString()} of them MultiPolygons`)
if (outsideSelection > 0)
  console.log(`  ${outsideSelection} dropped: touched a boundary, centred outside the selection`)
if (duplicatePins > 0) console.log(`  ${duplicatePins} dropped as duplicate PINs`)
if (withoutZoning > 0) console.log(`  ${withoutZoning} with no zoning district`)

console.log('\n  Coverage by neighborhood. Centred in it, and touching it:')
for (const row of coverage) {
  const shared = row.sharedWithNeighbor === 0 ? '' : `  (+${row.sharedWithNeighbor} on the edge)`
  console.log(
    `    ${String(row.harvested).padStart(5)} of ${String(row.touching).padEnd(5)}  ` +
      `${row.neighborhood}${shared}`
  )
}

console.log(
  `\n  Accounted for: ${accounting.fetched.toLocaleString()} fetched = ` +
    `${accounting.written.toLocaleString()} written + ` +
    `${accounting.centredOutsideSelection} centred outside + ${duplicatePins} duplicate PINs.`
)

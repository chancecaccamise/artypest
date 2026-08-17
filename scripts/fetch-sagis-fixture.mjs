/*
  Builds every parcel and geographic fixture in this repo from the live SAGIS
  service, so the demo data has the same shape as the real thing.

  Run it deliberately, not on every build:

    node scripts/fetch-sagis-fixture.mjs

  The output is committed. That is on purpose: a fixture that reshuffles on
  every run is not reviewable in a diff, and the whole point of this data is
  that the parcel import's Match step faces real owner-name grammar rather than
  an invented one. See docs/SAGIS-API.md.

  This writes four files:

    src/lib/parcels/fixtures/chatham-sample.json    parcel attributes
    src/lib/geo/fixtures/ardsley-parcels.json       parcel polygons
    src/lib/geo/fixtures/ardsley-streets.json       street centrelines
    src/lib/geocoding/fixtures/savannah-addresses.json  geocoded addresses

  Nothing here is random and nothing reads the clock, so running it twice
  against an unchanged service produces an identical diff.
*/

import { writeFileSync } from 'node:fs'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import centroid from '@turf/centroid'

const BASE = 'https://pub.sagis.org/arcgis/rest/services'

const PARCELS = `${BASE}/OpenData/Parcels/FeatureServer/27/query`
const ZONING = `${BASE}/Savannah/ZoningDevelopment_Map/MapServer/6/query`
const ROADS = `${BASE}/OpenData/Transportation/MapServer/1/query`
const GEOCODER = `${BASE}/Locators/MAD_PointAddress_Centerlines/GeocodeServer/findAddressCandidates`

/*
  A real street in Ardsley Park, Savannah. Selected by address rather than by
  bounding box: sorting a box by PIN returns the lowest PINs along its edge,
  which lands in a different neighborhood.

  E 49th St is Pierpont Ward and Parkside Subdivision on the county's own legal
  descriptions. It is inside city limits, so the zoning join returns something,
  and it is a 1920s plat, which is exactly the case the digital plat service
  does not cover.
*/
const PARCEL_WHERE = "PropAddress_PreDir='E' AND PropAddress_StreetName='49TH'"

/** 40 become properties in the demo, 20 stay unimported for the import to find. */
const PARCEL_COUNT = 60

function query(url, params) {
  const search = new URLSearchParams(params)
  return fetch(`${url}?${search.toString()}`).then(async (response) => {
    if (!response.ok) throw new Error(`${url} returned ${response.status}`)
    const body = await response.json()
    if (body.error) throw new Error(`${url}: ${JSON.stringify(body.error)}`)
    return body
  })
}

/** An envelope query, for the layers that are joined to the parcels spatially. */
function envelopeFor(box) {
  return {
    geometry: `${box.xmin},${box.ymin},${box.xmax},${box.ymax}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outSR: '4326',
  }
}

/** The bounding box of a set of GeoJSON polygon features, with padding. */
function extentOf(features, padFraction) {
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity

  for (const feature of features) {
    const rings =
      feature.geometry?.type === 'MultiPolygon'
        ? feature.geometry.coordinates.flat()
        : (feature.geometry?.coordinates ?? [])
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < xmin) xmin = x
        if (y < ymin) ymin = y
        if (x > xmax) xmax = x
        if (y > ymax) ymax = y
      }
    }
  }

  const padX = (xmax - xmin) * padFraction
  const padY = (ymax - ymin) * padFraction
  return { xmin: xmin - padX, ymin: ymin - padY, xmax: xmax + padX, ymax: ymax + padY }
}

/* --------------------------------------------------------------- parcels -- */

/*
  The server caps a response by payload size as well as by record count, so a
  request for 60 parcels with geometry comes back with 53 and
  `exceededTransferLimit: true`. Page until the target is met rather than
  trusting resultRecordCount.
*/
async function queryPagedByPin(url, params, target) {
  const byPin = new Map()
  let offset = 0

  while (byPin.size < target) {
    const page = await query(url, {
      ...params,
      resultOffset: String(offset),
      resultRecordCount: '50',
    })
    const features = page.features ?? []
    if (features.length === 0) break

    for (const feature of features) {
      const pin = (feature.properties?.PIN ?? '').trim()
      // Pages can overlap, so the same parcel arrives twice. Keep one.
      if (pin !== '' && !byPin.has(pin)) byPin.set(pin, feature)
    }

    offset += features.length
  }

  return [...byPin.values()].slice(0, target)
}

console.log('Fetching parcels...')
const parcelFields = {
  outFields: [
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
  ].join(','),
  orderByFields: 'PIN ASC',
  returnGeometry: 'true',
  f: 'geojson',
}

const parcelFeatures = await queryPagedByPin(
  PARCELS,
  { where: PARCEL_WHERE, ...parcelFields },
  PARCEL_COUNT
)
console.log(`  ${parcelFeatures.length} parcels`)
if (parcelFeatures.length < PARCEL_COUNT) {
  throw new Error(
    `Wanted ${PARCEL_COUNT} parcels, got ${parcelFeatures.length}. Widen PARCEL_WHERE.`
  )
}

/* ---------------------------------------------------------------- zoning -- */

console.log('Fetching zoning districts...')
const zoningGeo = await query(ZONING, {
  ...envelopeFor(extentOf(parcelFeatures, 0.05)),
  outFields: 'ZONE,CODE,ZONING_DISTRICT',
  returnGeometry: 'true',
  f: 'geojson',
})
console.log(`  ${zoningGeo.features.length} zoning polygons`)

/**
 * Zoning is not published on the parcel, so it comes from a spatial join. Null
 * is a real answer: the layer is City of Savannah only.
 */
function zoningFor(parcelFeature) {
  const point = centroid(parcelFeature)
  for (const district of zoningGeo.features) {
    if (!district.geometry) continue
    try {
      if (booleanPointInPolygon(point, district)) return district.properties.ZONE ?? null
    } catch {
      // A malformed district polygon should not stop the whole run.
    }
  }
  return null
}

/* --------------------------------------------------------------- records -- */

/*
  Six decimal places is about 11cm, which is far finer than a plat drawing can
  show. The service returns 13, and the difference is most of the size of the
  street fixture.
*/
const COORD_PRECISION = 6

function roundGeometry(geometry) {
  if (!geometry) return geometry
  const round = (value) => Number(value.toFixed(COORD_PRECISION))
  const walk = (node) =>
    typeof node[0] === 'number' ? node.map(round) : node.map(walk)
  return { ...geometry, coordinates: walk(geometry.coordinates) }
}

/** The county publishes epoch milliseconds. Store an ISO date. */
function isoDate(millis) {
  if (typeof millis !== 'number' || !Number.isFinite(millis)) return null
  return new Date(millis).toISOString().slice(0, 10)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

const records = parcelFeatures.map((feature) => {
  const p = feature.properties
  return {
    pin: text(p.PIN),
    situsAddress: text(p.PropAddress_Full),
    ownerName: text(p.Owner),
    ownerName2: text(p.Owner2) === '' ? null : text(p.Owner2),
    ownerMailingAddress: {
      street: text(p.Mailing_Address),
      city: text(p.Mailing_City),
      state: text(p.Mailing_State),
      zip: text(p.Mailing_Zip),
    },
    acreage: typeof p.Acres === 'number' ? p.Acres : 0,
    zoningDistrict: zoningFor(feature),
    propertyUseCode: text(p.Property_Use) === '' ? null : text(p.Property_Use),
    fairMarketValue: typeof p.FairMarketValue === 'number' ? p.FairMarketValue : 0,
    totalAssessment: typeof p.Total_Assessment === 'number' ? p.Total_Assessment : 0,
    yearBuilt: typeof p.YearBuilt === 'number' && p.YearBuilt > 0 ? p.YearBuilt : null,
    legalDescription: text(p.Legal_Description),
    municipalityCode: text(p.Municipality) === '' ? null : text(p.Municipality),
    dateUpdated: isoDate(p.Date_Updated),
  }
})

writeFileSync(
  'src/lib/parcels/fixtures/chatham-sample.json',
  `${JSON.stringify(records, null, 2)}\n`
)
console.log(`  wrote chatham-sample.json`)

/* ------------------------------------------------------------- polygons -- */

/*
  The plat draws the parcels the association has records for, which is the first
  40. SAGIS returns RFC 7946 winding, checked across 35 parcels, so nothing is
  reversed here. src/features/map/projection.ts still reverses for d3-geo.
*/
const MATCHED_PARCEL_COUNT = 40

const platFeatures = parcelFeatures.slice(0, MATCHED_PARCEL_COUNT).map((feature) => ({
  type: 'Feature',
  properties: { pin: text(feature.properties.PIN) },
  geometry: roundGeometry(feature.geometry),
}))

writeFileSync(
  'src/lib/geo/fixtures/ardsley-parcels.json',
  `${JSON.stringify({ type: 'FeatureCollection', features: platFeatures }, null, 2)}\n`
)
console.log(`  wrote ardsley-parcels.json (${platFeatures.length} lots)`)

/* -------------------------------------------------------------- streets -- */

console.log('Fetching street centrelines...')

/*
  Against the extent of the lots the plat actually draws, padded slightly. The
  wider parcel search area pulls in several hundred segments from surrounding
  districts, which is clutter on a plat and weight in the bundle.
*/
const roadsGeo = await query(ROADS, {
  ...envelopeFor(extentOf(platFeatures, 0.02)),
  outFields: 'FULLNAME,RD_CLASS',
  returnGeometry: 'true',
  f: 'geojson',
})

/*
  Census feature class codes. A31 and below are arterials, which the plat draws
  heavier than the residential streets around the lots.
*/
function classify(code) {
  const value = text(code)
  if (value.startsWith('A2') || value.startsWith('A3')) return 'through'
  return 'local'
}

const seenStreets = new Set()
const streetFeatures = []
for (const feature of roadsGeo.features) {
  const name = text(feature.properties.FULLNAME)
  if (name === '' || !feature.geometry) continue
  const key = `${name}|${JSON.stringify(feature.geometry.coordinates)}`
  if (seenStreets.has(key)) continue
  seenStreets.add(key)
  streetFeatures.push({
    type: 'Feature',
    properties: { name, classification: classify(feature.properties.RD_CLASS) },
    geometry: roundGeometry(feature.geometry),
  })
}

writeFileSync(
  'src/lib/geo/fixtures/ardsley-streets.json',
  `${JSON.stringify({ type: 'FeatureCollection', features: streetFeatures }, null, 2)}\n`
)
console.log(`  wrote ardsley-streets.json (${streetFeatures.length} segments)`)

/* ------------------------------------------------------------ geocoding -- */

/*
  Geocode the situs addresses and the owner mailing addresses through the
  county's own locator. Out-of-county mailing addresses will not resolve, and
  that is wanted: it is what exercises the unplaced tray and manual placement.
*/
console.log('Geocoding addresses...')

function normalizeKey(value) {
  return value
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const addressTargets = new Set()
for (const record of records) {
  if (record.situsAddress !== '') {
    addressTargets.add(`${record.situsAddress}, SAVANNAH, GA ${record.ownerMailingAddress.zip}`)
    addressTargets.add(record.situsAddress)
  }
  const mailing = record.ownerMailingAddress
  if (mailing.street !== '') {
    addressTargets.add(
      `${mailing.street}, ${mailing.city}, ${mailing.state} ${mailing.zip}`.replace(/\s+/g, ' ')
    )
  }
}

const geocoded = {}
let resolved = 0
let unresolved = 0

for (const target of [...addressTargets].sort()) {
  const body = await query(GEOCODER, { SingleLine: target, outSR: '4326', f: 'pjson' }).catch(
    () => null
  )
  const best = body?.candidates?.[0]
  // A low score is a wrong answer wearing a right answer's clothes.
  if (!best || typeof best.score !== 'number' || best.score < 80) {
    unresolved += 1
    continue
  }
  geocoded[normalizeKey(target)] = [
    Number(best.location.x.toFixed(7)),
    Number(best.location.y.toFixed(7)),
  ]
  resolved += 1
}

writeFileSync(
  'src/lib/geocoding/fixtures/savannah-addresses.json',
  `${JSON.stringify(Object.fromEntries(Object.entries(geocoded).sort()), null, 2)}\n`
)
console.log(`  wrote savannah-addresses.json (${resolved} resolved, ${unresolved} not found)`)

/* --------------------------------------------------------------- summary -- */

const withZoning = records.filter((record) => record.zoningDistrict !== null).length
const jointOwners = records.filter((record) => record.ownerName.includes('&')).length
const withOwner2 = records.filter((record) => record.ownerName2 !== null).length
const noStreetNumber = records.filter((record) => !/^\d/.test(record.situsAddress)).length

console.log('')
console.log(`Parcels:            ${records.length}`)
console.log(`  with zoning:      ${withZoning}`)
console.log(`  ampersand owners: ${jointOwners}`)
console.log(`  with Owner2:      ${withOwner2}`)
console.log(`  no street number: ${noStreetNumber}`)
console.log(`Distinct PIN shapes: ${[...new Set(records.map((r) => (r.pin.includes(' ') ? 'spaced' : 'lettered')))].join(', ')}`)

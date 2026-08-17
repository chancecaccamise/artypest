/*
  Generates src/lib/geocoding/fixtures/savannah-addresses.json.

  A flat map of normalised address string to [lng, lat]. This stands in for a
  geocoding API. Run `node scripts/generate-geocoding-fixture.mjs` to rebuild.

  What is deliberately absent matters as much as what is present. Out-of-town
  owner mailing addresses get no entry, so they resolve to null, which is what
  exercises the unplaced path and the manual placement fallback. A geocoder
  that answers everything teaches you nothing about what happens when it does
  not.
*/

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/lib/geocoding/fixtures/savannah-addresses.json')

const parcels = JSON.parse(
  readFileSync(resolve(HERE, '../src/lib/parcels/fixtures/chatham-sample.json'), 'utf8')
)
const plat = JSON.parse(
  readFileSync(resolve(HERE, '../src/lib/geo/fixtures/ardsley-parcels.json'), 'utf8')
)

/** Same normalisation the service applies before a lookup. Keep them in step. */
function normalizeAddress(input) {
  return input
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ring centroid. Good enough for an address point inside a lot. */
function centroid(ring) {
  // Drop the closing coordinate so it is not double counted.
  const points = ring.slice(0, -1)
  let lng = 0
  let lat = 0
  for (const [x, y] of points) {
    lng += x
    lat += y
  }
  return [
    Number((lng / points.length).toFixed(7)),
    Number((lat / points.length).toFixed(7)),
  ]
}

const table = {}

/*
  Every situs address in the platted subdivision, at its lot centroid. These
  mostly resolve through the parcel geometry first, so the geocoder is the
  fallback rather than the primary route, but it has to agree with the parcel
  when it is used.
*/
const parcelByPin = new Map(parcels.map((parcel) => [parcel.pin, parcel]))

for (const feature of plat.features) {
  const parcel = parcelByPin.get(feature.properties.pin)
  if (!parcel) continue
  const point = centroid(feature.geometry.coordinates[0])
  table[normalizeAddress(`${parcel.situsAddress}, Savannah, GA 31405`)] = point
  // Board members paste addresses without the city half as often as with it.
  table[normalizeAddress(parcel.situsAddress)] = point
}

/*
  Vendor offices. Two sit inside the platted area, the rest are elsewhere in
  Savannah, which is what makes "resolved, but off the plat" a real state the
  map has to handle rather than a hypothetical one.
*/
const VENDOR_OFFICES = [
  ['2412 Waters Ave, Savannah, GA 31404', [-81.0794, 32.0341]],
  ['118 Skidaway Rd, Savannah, GA 31404', [-81.0611, 32.0459]],
  ['1810 Bull St, Savannah, GA 31401', [-81.0955, 32.0592]],
  // Inside the plat extent, on the through street.
  ['3305 Habersham St, Savannah, GA 31405', [-81.0959, 32.0431]],
  ['715 W Bay St, Savannah, GA 31401', [-81.1015, 32.0821]],
  // Also inside the plat extent, at the east end.
  ['240 E Victory Dr, Savannah, GA 31405', [-81.0925, 32.0413]],
  ['6605 Abercorn St, Savannah, GA 31405', [-81.0968, 32.0009]],
]

for (const [address, point] of VENDOR_OFFICES) {
  table[normalizeAddress(address)] = point
}

/*
  In-town owner mailing addresses that are not situs addresses. Out-of-town
  ones are left out on purpose: an owner in Atlanta has no place on this plat,
  and the correct answer is that the geocoder does not know.
*/
let inTown = 0
let outOfTown = 0

for (const parcel of parcels) {
  const key = normalizeAddress(parcel.ownerMailingAddress)
  if (table[key]) continue

  if (/SAVANNAH GA/.test(key)) {
    // Scatter these deterministically around the neighbourhood rather than
    // stacking them on one point.
    const seed = [...key].reduce((total, char) => total + char.charCodeAt(0), 0)
    table[key] = [
      Number((-81.098 + ((seed % 97) / 97) * 0.014).toFixed(7)),
      Number((32.036 + ((seed % 71) / 71) * 0.012).toFixed(7)),
    ]
    inTown += 1
  } else {
    outOfTown += 1
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(table, null, 1)}\n`, 'utf8')

console.log(`Wrote ${Object.keys(table).length} geocodable addresses`)
console.log(`  situs addresses in the plat: ${plat.features.length} (two spellings each)`)
console.log(`  vendor offices:              ${VENDOR_OFFICES.length}`)
console.log(`  in-town owner mailing:       ${inTown}`)
console.log(`  deliberately absent:         ${outOfTown} out-of-town mailing addresses`)

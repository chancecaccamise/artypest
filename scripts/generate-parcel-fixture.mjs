/*
  Generates src/lib/parcels/fixtures/chatham-sample.json.

  The fixture stands in for the SAGIS API. It is committed, not generated at
  runtime, so the import flow is reproducible and reviewable in a diff. Run
  `node scripts/generate-parcel-fixture.mjs` to regenerate it.

  Shape of the data, which the rest of the app depends on:

    - Records 0 to 39 have a matching property in the seeded system, so the
      import has real matches to resolve.
    - Records 40 to 59 are new, so the import has creates to perform.
    - Owner names are in county format (all caps, last-comma-first) for people
      and in filing format for businesses, which is what exercises both the
      name-normalised dedupe check and the person/business heuristic.
*/

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/lib/parcels/fixtures/chatham-sample.json')

/** mulberry32. Deterministic so regenerating produces an identical file. */
function makeRandom(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = makeRandom(20032630)

const pick = (list) => list[Math.floor(random() * list.length)]
const between = (min, max) => min + random() * (max - min)
const intBetween = (min, max) => Math.floor(between(min, max + 1))

// Ardsley Park and the blocks around it.
const STREETS = [
  'E 46th St',
  'E 47th St',
  'E 48th St',
  'E 49th St',
  'E 50th St',
  'E 51st St',
  'E 52nd St',
  'E Washington Ave',
  'Abercorn St',
  'Bull St',
  'Habersham St',
  'Atlantic Ave',
  'Kinzie Ave',
  'Chatham Cres',
  'Dixon Park',
  'E Victory Dr',
]

const FIRST_NAMES = [
  'John',
  'Margaret',
  'Daniel',
  'Teresa',
  'Wallace',
  'Alice',
  'Marcus',
  'Priya',
  'Gerald',
  'Lorraine',
  'Nathaniel',
  'Constance',
  'Elias',
  'Roberta',
  'Vincent',
  'Yolanda',
  'Curtis',
  'Bernadette',
  'Andre',
  'Frances',
  'Malcolm',
  'Delia',
  'Otis',
  'Junie',
  'Harold',
  'Simone',
  'Ruben',
  'Estelle',
  'Clyde',
  'Naomi',
]

const MIDDLE_INITIALS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'P', 'R', 'T']

const LAST_NAMES = [
  'Smith',
  'Hollis',
  'Okonkwo',
  'Vaughn',
  'Fenn',
  'Delacroix',
  'Brantley',
  'Whitfield',
  'Mercer',
  'Kowalski',
  'Ashby',
  'Ferrell',
  'Guthrie',
  'Ravenel',
  'Lindqvist',
  'Barrow',
  'Nesmith',
  'Cordray',
  'Pinckney',
  'Threadgill',
  'Bostwick',
  'Aldridge',
  'Cavanaugh',
  'Hedgepeth',
  'Marchetti',
  'Rutledge',
  'Sallis',
  'Tandy',
  'Ulmer',
  'Waverly',
]

const BUSINESS_OWNERS = [
  'ABERCORN HOLDINGS LLC',
  'TIDEWATER PROPERTY GROUP LLC',
  'LOW COUNTRY RENTALS INC',
  'MERCER FAMILY TRUST',
  'VICTORY DRIVE PARTNERS LP',
  'SAVANNAH COASTAL CAPITAL LLC',
  'BULL STREET INVESTMENTS CORP',
  'CHATHAM CRESCENT HOLDINGS LLC',
  'ARDSLEY HERITAGE TRUST',
  'PINCKNEY REAL ESTATE LP',
]

const ZONING = ['R-6', 'R-6', 'R-6', 'R-B', 'RIP-A', 'TC-1', 'RSF-6', 'RM-25', 'B-C', 'TN-1']

const OUT_OF_TOWN_CITIES = [
  ['Atlanta', 'GA', '30309'],
  ['Charleston', 'SC', '29403'],
  ['Charlotte', 'NC', '28202'],
  ['Jacksonville', 'FL', '32204'],
  ['New York', 'NY', '10011'],
]

const PIN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'G', 'H']

const usedPins = new Set()

/**
 * A SAGIS PIN is 5 characters, then either a space or a letter, then 5 more.
 * A leading 2 is City of Savannah, a leading 1 is unincorporated Chatham.
 * Ardsley Park is inside the city, so most of these lead with 2.
 */
function makePin() {
  for (;;) {
    const inCity = random() < 0.85
    const lead = inCity ? '2' : '1'
    const head = lead + String(intBetween(0, 9999)).padStart(4, '0')
    const tail = String(intBetween(0, 99999)).padStart(5, '0')
    const separator = random() < 0.75 ? ' ' : pick(PIN_LETTERS)
    const pin = `${head}${separator}${tail}`
    if (!usedPins.has(pin)) {
      usedPins.add(pin)
      return pin
    }
  }
}

const usedAddresses = new Set()

function makeAddress() {
  for (;;) {
    const number = intBetween(101, 2399)
    const address = `${number} ${pick(STREETS)}`
    if (!usedAddresses.has(address)) {
      usedAddresses.add(address)
      return address
    }
  }
}

/** County records write people last-comma-first in caps. That is the point. */
function makePersonOwner() {
  const first = pick(FIRST_NAMES)
  const last = pick(LAST_NAMES)
  const initial = random() < 0.6 ? ` ${pick(MIDDLE_INITIALS)}` : ''
  return {
    ownerName: `${last.toUpperCase()}, ${first.toUpperCase()}${initial}`,
    // The same human, written the way a person would type it into this app.
    readableName: `${first}${initial ? ` ${initial.trim()}.` : ''} ${last}`,
    kind: 'person',
  }
}

function makeBusinessOwner(index) {
  const name = BUSINESS_OWNERS[index % BUSINESS_OWNERS.length]
  return { ownerName: name, readableName: name, kind: 'business' }
}

const records = []

for (let index = 0; index < 60; index += 1) {
  const owner = random() < 0.78 ? makePersonOwner() : makeBusinessOwner(index)
  const situsAddress = makeAddress()

  // Most owners are owner-occupied, so the mailing address is the situs.
  let ownerMailingAddress = `${situsAddress}, Savannah, GA 31405`
  if (random() < 0.28) {
    const [city, state, zip] = pick(OUT_OF_TOWN_CITIES)
    ownerMailingAddress = `${intBetween(100, 4999)} ${pick(STREETS)}, ${city}, ${state} ${zip}`
  }

  records.push({
    pin: makePin(),
    situsAddress,
    ownerName: owner.ownerName,
    ownerMailingAddress,
    acreage: Number(between(0.08, 0.44).toFixed(3)),
    zoningDistrict: pick(ZONING),
    assessedValue: Math.round(between(178000, 862000) / 500) * 500,
    assessedYear: random() < 0.7 ? 2026 : 2025,
    /*
      Underscore-prefixed keys are generation metadata, not parcel data. SAGIS
      publishes only the owner name string. These exist so the seeded people
      and businesses can be built from the same source, which is what gives
      the import real matches to find. ParcelRecord does not include them and
      the import logic never reads them.
    */
    _seedReadableName: owner.readableName,
    _seedOwnerKind: owner.kind,
  })
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(records, null, 2)}\n`, 'utf8')

console.log(`Wrote ${records.length} parcel records to ${OUT}`)
console.log(`  City of Savannah: ${records.filter((r) => r.pin.startsWith('2')).length}`)
console.log(`  Unincorporated:   ${records.filter((r) => r.pin.startsWith('1')).length}`)
console.log(`  Business owners:  ${records.filter((r) => r._seedOwnerKind === 'business').length}`)

/*
  Generates the plat geometry:

    src/lib/geo/fixtures/ardsley-parcels.json   FeatureCollection<Polygon>
    src/lib/geo/fixtures/ardsley-streets.json   FeatureCollection<LineString>

  Run `node scripts/generate-subdivision-fixture.mjs` to regenerate. Both files
  are committed so the plat is reproducible and reviewable in a diff.

  The point is a believable subdivision rather than a grid of rectangles: a
  through street with a cul-de-sac branch, facing rows of lots, wedge lots
  around the bulb, a few irregular corners, and two common area parcels.

  Parcels are keyed by PIN, which is the same key the parcel import matches on,
  so the geometry joins to the seeded property entities without a second
  identifier. PINs are read from the parcel fixture rather than invented here.
*/

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PARCEL_FIXTURE = resolve(HERE, '../src/lib/parcels/fixtures/chatham-sample.json')
const OUT_DIR = resolve(HERE, '../src/lib/geo/fixtures')

/** mulberry32, so regenerating produces an identical file. */
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

const random = makeRandom(31405_2)
const between = (min, max) => min + random() * (max - min)

/*
  Ardsley Park, Savannah. Everything is laid out in feet from this origin and
  converted to degrees at the end, because reasoning about lot frontage in
  decimal degrees is a good way to produce a subdivision nobody believes.
*/
const ORIGIN = { lng: -81.0966, lat: 32.0421 }

const FEET_PER_DEG_LAT = 364000
const FEET_PER_DEG_LNG = FEET_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180)

/** Feet east and north of the origin, to [lng, lat], rounded to ~0.1 ft. */
function toLngLat([east, north]) {
  return [
    Number((ORIGIN.lng + east / FEET_PER_DEG_LNG).toFixed(7)),
    Number((ORIGIN.lat + north / FEET_PER_DEG_LAT).toFixed(7)),
  ]
}

/** Shoelace. Positive is counterclockwise with longitude east, latitude north. */
function signedArea(coords) {
  let total = 0
  for (let index = 0; index < coords.length - 1; index += 1) {
    const [x0, y0] = coords[index]
    const [x1, y1] = coords[index + 1]
    total += x0 * y1 - x1 * y0
  }
  return total / 2
}

/*
  Exterior rings must wind counterclockwise.

  RFC 7946 requires it, and d3-geo enforces it: it treats geometry as spherical,
  so a clockwise exterior ring is read as the complement, and the lot renders as
  the entire rest of the world. That failure is silent in the data and
  catastrophic on screen, which is why the winding is corrected here rather
  than left to whoever listed the corners.
*/
function ring(points) {
  const coords = points.map(toLngLat)
  coords.push(coords[0])
  if (signedArea(coords) < 0) coords.reverse()
  return [coords]
}

/* ------------------------------------------------------------------ PINs -- */

const parcels = JSON.parse(readFileSync(PARCEL_FIXTURE, 'utf8'))

/*
  The first 40 parcels are the ones seeded as properties, so those get the
  geometry. The order is the fixture's order, which is also the order the
  property entities are built in, so lot L-001 is parcel 0 is the first lot on
  the north row.
*/
const PINS = parcels.slice(0, 40).map((parcel) => parcel.pin)

let pinCursor = 0
function nextPin() {
  const pin = PINS[pinCursor]
  pinCursor += 1
  if (!pin) {
    throw new Error(
      `The subdivision draws more parcels than there are seeded PINs (${PINS.length}). ` +
        'Reduce a row count, or seed more properties from the parcel fixture.'
    )
  }
  return pin
}

const features = []

function pushParcel(points, extra = {}) {
  features.push({
    type: 'Feature',
    properties: { pin: nextPin(), ...extra },
    geometry: { type: 'Polygon', coordinates: ring(points) },
  })
}

/* --------------------------------------------------------------- streets -- */

const ROAD_HALF_WIDTH = 25

/** The through street runs east along y = 0, then the branch heads north. */
const THROUGH_LENGTH = 1500
const BRANCH_X = 1080

/*
  The branch carries five lots a side at 62 to 92 feet of frontage, starting
  215 feet up, so its rows reach roughly y = 600. The bulb has to clear that
  or its wedge lots overlap the rows, which is not a thing a recorded plat
  can contain.
*/
const BRANCH_LENGTH = 780
const BULB = { x: BRANCH_X, y: BRANCH_LENGTH, radius: 95 }

/* ----------------------------------------------------------- facing rows -- */

/*
  Lots face the street from both sides. Frontage varies 60 to 100 feet and
  depth 120 to 200, so the rows read as surveyed rather than stamped.
*/
function facingRow({ count, startX, side, depthMin, depthMax, curve = 0 }) {
  let x = startX

  for (let index = 0; index < count; index += 1) {
    const frontage = between(60, 100)
    const depth = between(depthMin, depthMax)

    // A gentle curve on the far row: the frontage line bows north as x grows.
    const bowAt = (atX) => curve * Math.sin(((atX - startX) / 900) * Math.PI)

    const nearY = side === 'north' ? ROAD_HALF_WIDTH : -ROAD_HALF_WIDTH
    const farY = side === 'north' ? ROAD_HALF_WIDTH + depth : -ROAD_HALF_WIDTH - depth

    const y0 = nearY + bowAt(x)
    const y1 = nearY + bowAt(x + frontage)

    pushParcel([
      [x, y0],
      [x + frontage, y1],
      [x + frontage, side === 'north' ? farY + bowAt(x + frontage) : farY + bowAt(x + frontage)],
      [x, side === 'north' ? farY + bowAt(x) : farY + bowAt(x)],
    ])

    x += frontage
  }

  return x
}

/* North side of the through street, west of the branch. */
facingRow({ count: 7, startX: 40, side: 'north', depthMin: 130, depthMax: 175 })

/* South side of the through street, the full length, with a slight bow. */
facingRow({ count: 8, startX: 40, side: 'south', depthMin: 140, depthMax: 200, curve: -18 })

/* North side, east of the branch. */
facingRow({ count: 5, startX: BRANCH_X + ROAD_HALF_WIDTH + 15, side: 'north', depthMin: 125, depthMax: 170 })

/* ------------------------------------------------------- the branch legs -- */

/** Lots down both sides of the branch, facing east or west onto it. */
function branchRow({ count, side, startY, depthMin, depthMax }) {
  let y = startY

  for (let index = 0; index < count; index += 1) {
    const frontage = between(62, 92)
    const depth = between(depthMin, depthMax)

    const nearX = side === 'east' ? BRANCH_X + ROAD_HALF_WIDTH : BRANCH_X - ROAD_HALF_WIDTH
    const farX = side === 'east' ? nearX + depth : nearX - depth

    pushParcel([
      [nearX, y],
      [nearX, y + frontage],
      [farX, y + frontage],
      [farX, y],
    ])

    y += frontage
  }

  return y
}

const branchTop = branchRow({
  count: 5,
  side: 'west',
  startY: ROAD_HALF_WIDTH + 190,
  depthMin: 120,
  depthMax: 165,
})

branchRow({ count: 5, side: 'east', startY: ROAD_HALF_WIDTH + 190, depthMin: 125, depthMax: 170 })

/* ------------------------------------------------------- cul-de-sac bulb -- */

/*
  Wedge lots around the bulb. Each is a quadrilateral between two rays from the
  bulb centre: a short edge on the pavement, a long edge at the rear line.
*/
const WEDGE_COUNT = 6
/*
  A sweep wider than this dips the outer wedges south past the bulb and into
  the branch rows. Kept to a little over a half turn, which is what a real
  cul-de-sac head looks like anyway.
*/
const WEDGE_START = -0.12 * Math.PI
const WEDGE_END = 1.12 * Math.PI

for (let index = 0; index < WEDGE_COUNT; index += 1) {
  const a0 = WEDGE_START + ((WEDGE_END - WEDGE_START) * index) / WEDGE_COUNT
  const a1 = WEDGE_START + ((WEDGE_END - WEDGE_START) * (index + 1)) / WEDGE_COUNT
  const rear = BULB.radius + between(120, 165)

  const at = (angle, radius) => [
    BULB.x + Math.cos(angle) * radius,
    BULB.y + Math.sin(angle) * radius,
  ]

  /*
    Corners walk the perimeter in order: along the pavement, out to the rear
    line, across it through a midpoint bulge, and back. Listing the rear
    corners out of order makes a bowtie, and d3-geo clips a self-intersecting
    ring against the sphere, which drew one lot as the entire rest of the
    world sitting on top of the plat.
  */
  pushParcel([
    at(a0, BULB.radius),
    at(a1, BULB.radius),
    at(a1, rear),
    // A midpoint on the rear line keeps the wedge from reading as a triangle.
    at((a0 + a1) / 2, rear + 12),
    at(a0, rear),
  ])
}

/* ---------------------------------------------------- irregular corners -- */

/*
  Real plats have leftovers: the odd lot where two streets meet, and a flag lot
  reached down a narrow strip. Two of them, which is enough to stop the drawing
  reading as a grid without spending PINs that seeded lots need.
*/

// A corner lot at the branch, cut back on the diagonal.
pushParcel([
  [BRANCH_X - ROAD_HALF_WIDTH - 150, ROAD_HALF_WIDTH],
  [BRANCH_X - ROAD_HALF_WIDTH, ROAD_HALF_WIDTH],
  [BRANCH_X - ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + 120],
  [BRANCH_X - ROAD_HALF_WIDTH - 70, ROAD_HALF_WIDTH + 165],
  [BRANCH_X - ROAD_HALF_WIDTH - 150, ROAD_HALF_WIDTH + 150],
])

// A flag lot behind the north row, reached by a 20 foot strip.
pushParcel([
  [430, ROAD_HALF_WIDTH + 175],
  [450, ROAD_HALF_WIDTH + 175],
  [450, ROAD_HALF_WIDTH + 265],
  [640, ROAD_HALF_WIDTH + 265],
  [640, ROAD_HALF_WIDTH + 390],
  [430, ROAD_HALF_WIDTH + 390],
])

/* --------------------------------------------------------- common areas -- */

/*
  Two common area parcels. They are parcels like any other: they carry a PIN and
  join to a property entity. Nothing in the renderer treats them specially, so
  the `commonArea` flag below is only there for the fixture's own readability.
*/

/*
  The pool lot, on the inside of the branch corner. Its east edge stops short
  of 890, which is as far west as the deepest branch lot reaches.
*/
pushParcel(
  [
    [660, ROAD_HALF_WIDTH + 200],
    [860, ROAD_HALF_WIDTH + 200],
    [860, ROAD_HALF_WIDTH + 380],
    [660, ROAD_HALF_WIDTH + 380],
  ],
  { commonArea: 'pool' }
)

// The retention pond, an irregular basin at the south east.
pushParcel(
  [
    [1180, -ROAD_HALF_WIDTH - 210],
    [1330, -ROAD_HALF_WIDTH - 185],
    [1395, -ROAD_HALF_WIDTH - 260],
    [1350, -ROAD_HALF_WIDTH - 370],
    [1210, -ROAD_HALF_WIDTH - 385],
    [1130, -ROAD_HALF_WIDTH - 300],
  ],
  { commonArea: 'retention pond' }
)

/* --------------------------------------------------------------- streets -- */

/** The bulb pavement, as a closed-ish arc on the centreline layer. */
const bulbCoords = []
for (let index = 0; index <= 28; index += 1) {
  const angle = WEDGE_START + ((WEDGE_END - WEDGE_START) * index) / 28
  bulbCoords.push([BULB.x + Math.cos(angle) * 55, BULB.y + Math.sin(angle) * 55])
}

const streets = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'E Washington Ave', classification: 'through' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [420, 0],
          [900, 0],
          [THROUGH_LENGTH, 0],
        ].map(toLngLat),
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Ardsley Ct', classification: 'branch' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [BRANCH_X, 0],
          [BRANCH_X, BRANCH_LENGTH - 55],
        ].map(toLngLat),
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Ardsley Ct', classification: 'cul_de_sac' },
      geometry: { type: 'LineString', coordinates: bulbCoords.map(toLngLat) },
    },
    {
      type: 'Feature',
      properties: { name: 'Habersham St', classification: 'boundary' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, -420],
          [0, 480],
        ].map(toLngLat),
      },
    },
  ],
}

/* ----------------------------------------------------------------- write -- */

const parcelCollection = { type: 'FeatureCollection', features }

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
  resolve(OUT_DIR, 'ardsley-parcels.json'),
  `${JSON.stringify(parcelCollection, null, 1)}\n`,
  'utf8'
)
writeFileSync(resolve(OUT_DIR, 'ardsley-streets.json'), `${JSON.stringify(streets, null, 1)}\n`, 'utf8')

const commonAreas = features.filter((feature) => feature.properties.commonArea).length

const wrongWinding = features.filter(
  (feature) => signedArea(feature.geometry.coordinates[0]) < 0
).length

console.log(`Wrote ${features.length} parcels (${commonAreas} common area) and ${streets.features.length} street segments`)
console.log(`  rings wound counterclockwise: ${features.length - wrongWinding} of ${features.length}`)
console.log(`  PINs used: ${pinCursor} of ${PINS.length} seeded`)

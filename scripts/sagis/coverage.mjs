/*
  The coverage contract. This file is the answer to "how do we know we are not
  missing a whole neighborhood".

  Coverage is one corridor through central Savannah, bounded by real streets.
  The numbers below were taken from street centreline geometry on
  OpenData/Transportation/MapServer/1 rather than drawn by eye:

    MLK Jr Blvd   lon -81.1089 .. -81.0961   (the main line sits at -81.0990)
    E Broad St    lon -81.0945 .. -81.0837
    DeRenne Ave   lat  32.0171 ..  32.0315
    the river     lat  32.0820 at River Street

  A useful check on the east and west edges: North Historic District's own
  extent is lon -81.0990 to -81.0835, so MLK and E Broad are precisely the
  historic district's edges.

  To change the area, edit this file and re-run the harvest.
*/

/** Measured 2026-08-17: 10,399 parcels inside these bounds. */
export const CORRIDOR = {
  xmin: -81.099, // MLK Jr Blvd
  ymin: 32.023, // DeRenne Ave
  xmax: -81.0837, // E Broad St
  ymax: 32.082, // the Savannah River at River Street
}

export const EXPECTED_PARCEL_COUNT = 10399

/** A count this far from the expectation is reported rather than passed over. */
export const DRIFT_TOLERANCE = 0.15

/*
  Across the river, so not part of the corridor, but its extent
  (lat 32.0802 to 32.0977) overlaps the top of North Historic District
  (32.0841). No horizontal cut separates the two, so it goes by name.
*/
export const EXCLUDED_NEIGHBORHOODS = ['Hutchinson Island']

/*
  The corridor clips 31 neighborhoods and most of them only partly. That is
  deliberate, and the manifest records harvested against total for each one, so
  a partial clip reads as a decision rather than as a bug found later.

  Full sizes, measured 2026-08-17, for the neighborhoods the corridor touches
  most. Used to report partial coverage, not to gate the run.
*/
export const NEIGHBORHOOD_TOTALS = {
  'North Historic District': 1740,
  Midtown: 1495,
  'South Historic District': 1378,
  'Live Oak': 1224,
  'Ardmore/Gould Estates/Olin Heights': 1151,
  'Ardsley Park/Chatham Crescent': 1087,
  'LaRoche Park/Springhill/Daffin Heights/Wilemere/Shirley Park': 1024,
  Oakdale: 941,
  Metropolitan: 811,
  'Thomas Square': 783,
  Eastside: 767,
  'Abercorn Heights/Lamara Heights/Ridgewood/Poplar Heights': 715,
  'Groveland/Kensington Park': 463,
  'Beach Institute': 440,
  'Magnolia Park/Blueberry Hill': 433,
  'West Victorian District': 432,
  Parkside: 427,
  'Baldwin Park': 411,
  Sackville: 335,
  'Forest Park': 326,
  'East Victorian District': 321,
  'Bacon Park Area/Sandfly': 304,
  'South Garden': 291,
  Edgemere: 282,
  'Dixon Park': 268,
  'Hitch Village/Fred Wessels Homes': 221,
  'Fairway Oaks': 177,
  'Medical Arts': 145,
  'Yamacraw Village': 83,
  'Memorial Hospital/Fairfield': 76,
}

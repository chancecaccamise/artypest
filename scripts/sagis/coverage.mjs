/*
  The coverage contract. This file is the answer to "how do we know we are not
  missing a whole neighborhood".

  Coverage is a list of neighborhoods, each one harvested complete to its own
  boundary. It used to be a rectangle in latitude and longitude, and that is
  what this file exists to stop happening again.

  A rectangle cannot describe a neighborhood. Savannah's grid is rotated
  relative to north, so an envelope drawn on the streets that bound the area
  (MLK Jr Blvd, E Broad St, the river, DeRenne Ave) followed those streets only
  in the Historic District and cut diagonally through everywhere else. Every one
  of the 27 neighborhoods it touched came back clipped: North Historic District
  1,708 of 1,740, Eastside 564 of 767, Ardmore 734 of 1,151, and the whole of
  River Street missing.

  Widening the rectangle does not fix that, it moves it. The bounding box of the
  27 neighborhoods below holds 22,674 parcels, which drags in Carver Heights,
  Cuyler/Brownville, and Hutchinson Island while still clipping whatever sits on
  its own new edges.

  So selection is by name. The neighborhood layer publishes the boundary, the
  parcel layer is queried with that boundary as the geometry, and every parcel
  that comes back is harvested. Coverage stops being a percentage of an area
  nobody can point at and becomes a list of neighborhoods, each one whole.

  To change the area, add or remove a name below and re-run the harvest.
*/

/*
  Spelled exactly as OpenData/Community/MapServer/10 spells them in NAME. A
  typo here is a neighborhood silently absent, so the harvest fails on any name
  it cannot find rather than carrying on with 26.
*/
export const NEIGHBORHOODS = [
  'Abercorn Heights/Lamara Heights/Ridgewood/Poplar Heights',
  'Ardmore/Gould Estates/Olin Heights',
  'Ardsley Park/Chatham Crescent',
  'Avondale',
  'Baldwin Park',
  'Bay Street Viaduct Area',
  'Beach High School Area',
  'Beach Institute',
  'Benjamin Van Clark Park',
  'Bingville',
  'Blackshear',
  'Cann Park',
  'Carver Heights',
  'Cloverdale',
  'Cuyler/Brownville',
  'Dale Terrace/Olympus/Victory Square',
  'Dixon Park',
  'East Savannah',
  'East Victorian District',
  'Eastside',
  'Edgemere',
  'Fairway Oaks',
  'Feiler Park/Hussars Terrace/Dittmerville',
  'Fernwood/Parkwood',
  'Forest Park',
  'Gordonston',
  'Groveland/Kensington Park',
  'Habersham Woods',
  'Hillcrest Area',
  'Hitch Village/Fred Wessels Homes',
  'Hudson Hill/Bayview',
  'Hutchinson Island',
  'Jackson Park',
  'Kayton/Frazier Area',
  'LaRoche Park/Springhill/Daffin Heights/Wilemere/Shirley Park',
  'Laurel Grove/Railroad Area',
  'Liberty City/Summerside/Southover/Richfield',
  'Live Oak',
  'Medical Arts',
  'Memorial Hospital/Fairfield',
  'Metropolitan',
  'Midtown',
  'North Historic District',
  'Oakland Park/Northgate/Eastgate/Pinehurst',
  'Ogeecheeton/Dawes Avenue',
  'Parkside',
  'Poplar Place/University Place',
  'Sackville',
  'Savannah Gardens',
  'South Garden',
  'South Historic District',
  'Sunset Park',
  'Sylvan Terrace',
  'Tatemville',
  'Thomas Square',
  'Tremont Park',
  'Twickenham',
  'Victory Heights',
  'Victory Manor/East Hill/Donwood',
  'West Savannah',
  'West Victorian District',
  'Winter Gardens/Brightwood',
  'Yamacraw Village',
]

/**
 * Measured 2026-10-16 against the live service: the union of the boundaries
 * above holds 34,861 parcels. It was 16,698 for the first 27 neighborhoods; the
 * other 36 are every neighborhood within about 2.7 miles of Thomas Square, the
 * ring the app was measured to carry without a board member noticing.
 *
 * This gates the run rather than describing it. The per-neighborhood totals are
 * not written down anywhere, because the harvest asks the service for them.
 */
export const EXPECTED_PARCEL_COUNT = 34861

/** A count this far from the expectation is reported rather than passed over. */
export const DRIFT_TOLERANCE = 0.15

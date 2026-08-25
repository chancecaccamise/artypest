/*
  The district overlays: which boundaries the plat can draw underneath the lots.

  One is shown at a time. A lot sits inside a commission district and a voting
  precinct and a sanitation route all at once, and drawing three sets of
  boundaries over a plat produces a drawing nobody can read.

  Every entry names a real published layer. The list was assembled by walking
  all 1,334 layers SAGIS publishes across 165 services, so `layer` is the only
  place a service path appears and adding a boundary is adding an entry here.

  Not in this list, because they are not published anywhere in SAGIS: District
  Attorney, Recorder's Court, and Grand Jury districts (searched for jury,
  magistrate, superior, recorder, prosecutor: nothing). Code Enforcement
  districts. The MPC Monuments board, which has no jurisdiction boundary; its
  review area is the Local Historic Districts entry below. The Tourism
  Leadership Council and Tourism Advisory Council are advisory bodies rather
  than areas, so there is nothing to draw.

  `name` is what the plat labels the area with. `detail` is the second line,
  shown when a reader is looking at one area rather than at the whole set.
  Both are resolved at harvest time, so the served file is plain GeoJSON with no
  field names from the county left in it.
*/

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const number = (value) => (typeof value === 'number' ? String(value) : text(value))

export const OVERLAYS = [
  {
    id: 'commission',
    label: 'County Commission districts',
    note: 'Chatham County Commission, eight districts and who represents each.',
    sources: [{ layer: 'ChathamCounty/CCElections/MapServer/9', fields: 'OBJECTID,UNIT,COMISSIONER' }],
    // The county spells the field COMISSIONER. Copied exactly rather than fixed,
    // because a corrected name is a field that does not exist.
    name: (p) => `District ${number(p.UNIT)}`,
    detail: (p) => text(p.COMISSIONER),
  },
  {
    id: 'aldermanic',
    label: 'Aldermanic districts',
    note: 'City of Savannah council districts.',
    sources: [{ layer: 'ChathamCounty/CCElections/MapServer/10', fields: 'OBJECTID,UNIT,ALDERMAN' }],
    name: (p) => `District ${number(p.UNIT)}`,
    detail: (p) => text(p.ALDERMAN),
  },
  {
    id: 'state-house',
    label: 'State House districts',
    note: 'Georgia House of Representatives. Statewide layer, clipped to the area on the plat.',
    sources: [{ layer: 'ChathamCounty/CCElections/MapServer/5', fields: 'OBJECTID,DISTRICT' }],
    name: (p) => `House ${text(p.DISTRICT).replace(/^0+/, '')}`,
    detail: () => '',
  },
  {
    id: 'state-senate',
    label: 'State Senate districts',
    note: 'Georgia Senate. Statewide layer, clipped to the area on the plat.',
    sources: [{ layer: 'ChathamCounty/CCElections/MapServer/4', fields: 'OBJECTID,DISTRICT' }],
    name: (p) => `Senate ${text(p.DISTRICT).replace(/^0+/, '')}`,
    detail: () => '',
  },
  {
    id: 'congressional',
    label: 'US Congressional districts',
    note: 'Statewide layer, clipped to the area on the plat.',
    sources: [{ layer: 'ChathamCounty/CCElections/MapServer/11', fields: 'OBJECTID,DISTRICT' }],
    name: (p) => `Congressional ${text(p.DISTRICT).replace(/^0+/, '')}`,
    detail: () => '',
  },
  {
    id: 'voting-precincts',
    label: 'Voting precincts',
    note: 'Chatham County precincts, with the polling place for each.',
    sources: [
      {
        layer: 'OpenData/Community/MapServer/17',
        fields: 'OBJECTID,PRECODE,CTYSOSID,PollingPlace,Address',
      },
    ],
    name: (p) => text(p.PRECODE) || text(p.CTYSOSID),
    // Where a resident of this precinct actually votes, which is the question
    // anybody asks about a precinct.
    detail: (p) =>
      [text(p.PollingPlace), text(p.Address)].filter((part) => part !== '').join(', '),
  },
  {
    id: 'police-precincts',
    label: 'Police precincts',
    sources: [{ layer: 'ChathamCounty/CCPolicePrecincts/MapServer/0', fields: 'OBJECTID,PCT_Name,GROUP_' }],
    name: (p) => text(p.PCT_Name),
    detail: (p) => text(p.GROUP_),
  },
  {
    id: 'fire-districts',
    label: 'Fire service districts',
    note: 'Which station covers an address, and which department runs it.',
    sources: [
      { layer: 'SAVFIRE/FireCommunityAsset/MapServer/2', fields: 'OBJECTID,District,Provider,Station' },
    ],
    name: (p) => text(p.District),
    detail: (p) => [text(p.Provider), text(p.Station)].filter((part) => part !== '').join(', '),
  },
  {
    id: 'sanitation',
    label: 'Sanitation collection days',
    note: 'City of Savannah residential refuse routes, one area per collection day.',
    /*
      Published as one layer per weekday rather than one layer with a day
      column, so they are fetched separately and folded into a single overlay.
      A reader wants "which day is this street collected", not four overlays
      they have to switch between to find out.
    */
    sources: [
      { layer: 'Savannah/ResidentialRefuseCollections_MapService/MapServer/1', fields: 'OBJECTID,Day,Recyling' },
      { layer: 'Savannah/ResidentialRefuseCollections_MapService/MapServer/2', fields: 'OBJECTID,Day,Recyling' },
      { layer: 'Savannah/ResidentialRefuseCollections_MapService/MapServer/3', fields: 'OBJECTID,Day,Recyling' },
      { layer: 'Savannah/ResidentialRefuseCollections_MapService/MapServer/4', fields: 'OBJECTID,Day,Recyling' },
    ],
    name: (p) => text(p.Day),
    // The county spells it Recyling. Left as published, for the same reason.
    detail: (p) => text(p.Recyling),
  },
  {
    id: 'school-board',
    label: 'School board districts',
    note: 'Savannah-Chatham County Public Schools board districts.',
    sources: [{ layer: 'OpenData/Boundaries/MapServer/9', fields: 'OBJECTID,UNIT,NAME' }],
    name: (p) => `District ${number(p.UNIT)}`,
    detail: (p) => text(p.NAME),
  },
  {
    id: 'school-elementary',
    label: 'Elementary attendance zones',
    sources: [{ layer: 'OpenData/Community/MapServer/16', fields: 'OBJECTID,NAME,GRADES' }],
    name: (p) => text(p.NAME),
    detail: (p) => text(p.GRADES),
  },
  {
    id: 'school-middle',
    label: 'Middle school attendance zones',
    sources: [{ layer: 'OpenData/Community/MapServer/19', fields: 'OBJECTID,NAME,GRADES' }],
    name: (p) => text(p.NAME),
    detail: (p) => text(p.GRADES),
  },
  {
    id: 'school-high',
    label: 'High school attendance zones',
    sources: [{ layer: 'OpenData/Community/MapServer/15', fields: 'OBJECTID,NAME,GRADES' }],
    name: (p) => text(p.NAME),
    detail: (p) => text(p.GRADES),
  },
  {
    id: 'historic-local',
    label: 'Local historic districts',
    note: 'The areas the Historic Review Board has jurisdiction over.',
    sources: [{ layer: 'OpenData/Historic/MapServer/7', fields: 'OBJECTID,DISTRICT' }],
    name: (p) => text(p.DISTRICT),
    detail: () => '',
  },
  {
    id: 'historic-national',
    label: 'National Register districts',
    sources: [{ layer: 'OpenData/Historic/MapServer/8', fields: 'OBJECTID,DISTRICT,LISTED,MUNICIPALITY' }],
    name: (p) => text(p.DISTRICT),
    detail: (p) => (text(p.LISTED) === '' ? '' : `Listed ${text(p.LISTED)}`),
  },
  {
    id: 'neighborhood-associations',
    label: 'Neighborhood associations',
    note: 'A different layer from the neighborhoods the parcel harvest uses: 137 areas rather than 106, and it carries the association and its contact.',
    sources: [
      {
        layer: 'OpenData/Community/MapServer/9',
        fields: 'OBJECTID,NAME,NEIGHBORHOOD_ORG_NAME,CONTACT_NAME',
      },
    ],
    name: (p) => text(p.NAME),
    /*
      The county records "No Active Neighborhood Association" for areas with
      none, which is worth showing rather than hiding: an area with no
      association is exactly the kind of thing a board wants to know.
    */
    detail: (p) =>
      [text(p.NEIGHBORHOOD_ORG_NAME), text(p.CONTACT_NAME)]
        .filter((part) => part !== '')
        .join(', '),
  },
]

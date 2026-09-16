/*
  Real member contacts supplied in TSNA_BIZcontacts - Sheet1.csv.

  The source mixes business, billing, work, and home addresses. Property links
  below are therefore explicit rather than inferred by column position:
  - business locations are `related_to` the business;
  - HOME addresses are residences;
  - ownership is only recorded where the county owner name corroborates it.
*/

export type TsnaPropertyRelation = 'owns' | 'resides_at' | 'related_to'

export interface TsnaPropertyLink {
  subject: 'person' | 'business'
  address: string
  relation: TsnaPropertyRelation
}

export interface TsnaContactSeed {
  id: string
  createdAt: string
  person: {
    name: string
    email: string
    phone: string
    mailingAddress?: string
  }
  business?: {
    name: string
    website: string
    address?: string
  }
  propertyLinks: TsnaPropertyLink[]
}

export const TSNA_CONTACTS: TsnaContactSeed[] = [
  {
    id: 'big-bon',
    createdAt: '2024-04-08T00:17:00Z',
    person: { name: 'Kay Heritage', email: 'kay@bigbonfamily.com', phone: '+1 912-349-4847' },
    business: { name: 'Big Bon', website: 'https://bigbonfamily.com', address: '2011 Bull St' },
    propertyLinks: [{ subject: 'business', address: '2011 Bull St', relation: 'related_to' }],
  },
  {
    id: 'baldwin-entertainment',
    createdAt: '2026-05-20T23:58:00Z',
    person: {
      name: 'Jordan Angelastro',
      email: 'j.angelastro@starlandbaldwinentertainment.com',
      phone: '+1 912-659-1549',
    },
    business: {
      name: 'Baldwin Entertainment',
      website: 'https://baldwinentertainment.com',
      address: '27 E Victory Dr, Savannah, GA 31405-2144',
    },
    propertyLinks: [{ subject: 'business', address: '27 E Victory Dr', relation: 'related_to' }],
  },
  {
    id: 'vantosh-realty',
    createdAt: '2024-06-15T17:36:00Z',
    person: { name: 'Beth Vantosh', email: 'bvantosh@vantoshco.com', phone: '+1 912-663-3392' },
    business: { name: 'Vantosh Realty', website: 'https://vantoshco.com', address: '1702 Bull St' },
    propertyLinks: [{ subject: 'business', address: '1702 Bull St', relation: 'related_to' }],
  },
  {
    id: 'starland-yard',
    createdAt: '2024-11-19T02:21:00Z',
    person: { name: 'Stacey Phillips', email: 'stacey@starlandyard.com', phone: '+1 912-417-3001' },
    business: {
      name: 'Starland Yard',
      website: 'https://starlandyard.com',
      address: '2411 De Soto Ave, Savannah, GA 31401',
    },
    propertyLinks: [{ subject: 'business', address: '2411 De Soto Ave', relation: 'related_to' }],
  },
  {
    id: 'slow-fire-bbq',
    createdAt: '2026-05-13T16:23:00Z',
    person: { name: 'Terren Williams', email: 'terren@slowfirebbq.com', phone: '+1 912-401-1469' },
    business: {
      name: 'Slow Fire BBQ',
      website: 'https://slowfirebbq.com',
      address: '410 E 37th St',
    },
    propertyLinks: [{ subject: 'business', address: '410 E 37th St', relation: 'related_to' }],
  },
  {
    id: 'shrink-savannah',
    createdAt: '2024-11-17T21:04:00Z',
    person: {
      name: 'Amy Brock',
      email: 'abrock@shrinksavannah.com',
      phone: '+1 912-712-2550',
      mailingAddress: '1601 Abercorn St, Savannah, GA 31401',
    },
    business: { name: 'Shrink Savannah', website: 'https://shrinksavannah.com' },
    propertyLinks: [{ subject: 'person', address: '1601 Abercorn St', relation: 'resides_at' }],
  },
  {
    id: 'cabretta-capital',
    createdAt: '2026-03-09T21:13:00Z',
    person: { name: 'Brent Watts', email: 'bwatts@cabrettacapital.com', phone: '+1 404-307-2868' },
    business: {
      name: 'Cabretta Capital',
      website: 'https://cabrettacapital.com',
      address: '2108 Drayton St, Savannah, GA 31401',
    },
    propertyLinks: [{ subject: 'business', address: '2108 Drayton St', relation: 'related_to' }],
  },
  {
    id: 'collins-quarter',
    createdAt: '2025-07-18T19:50:00Z',
    person: {
      name: 'Anthony Debreceny',
      email: 'ad@thecollinsquarter.com',
      phone: '+1 912-224-1245',
    },
    business: {
      name: 'The Collins Quarter',
      website: 'https://thecollinsquarter.com',
      address: '143 Bull St',
    },
    propertyLinks: [{ subject: 'business', address: '143 Bull St', relation: 'related_to' }],
  },
  {
    id: 'the-sexton',
    createdAt: '2025-05-26T18:00:00Z',
    person: { name: 'Joshua Sexton', email: 'revel808@gmail.com', phone: '+1 404-991-0446' },
    business: { name: 'The Sexton', website: 'https://thesextonpub.com', address: '9 W 43rd St' },
    propertyLinks: [{ subject: 'business', address: '9 W 43rd St', relation: 'related_to' }],
  },
  {
    id: 'garry-genser',
    createdAt: '2024-12-21T14:48:00Z',
    person: {
      name: 'Garry Genser',
      email: 'garrygenser@me.com',
      phone: '+1 571-294-4863',
      mailingAddress: '301 E 31st St, Savannah, GA 31401',
    },
    propertyLinks: [{ subject: 'person', address: '301 E 31st St', relation: 'resides_at' }],
  },
  {
    id: 'first-city-brewing',
    createdAt: '2026-03-03T15:38:00Z',
    person: {
      name: 'Lindsay McLean',
      email: 'lindsay@1stcitybrewing.com',
      phone: '+1 912-655-7550',
      mailingAddress: '332 E 56th St, Savannah, GA 31405',
    },
    business: {
      name: '1st City Brewing',
      website: 'https://1stcitybrewing.com',
      address: '1722 Habersham St',
    },
    propertyLinks: [{ subject: 'person', address: '332 E 56th St', relation: 'owns' }],
  },
  {
    id: 'soar-bungee-fitness',
    createdAt: '2026-01-11T20:12:00Z',
    person: {
      name: "Nicki O'Connell",
      email: 'contact@soarbungeefitness.com',
      phone: '+1 912-675-8165',
    },
    business: {
      name: 'Soar Bungee Fitness',
      website: 'https://soarbungeefitness.com',
      address: '1930 Montgomery St',
    },
    propertyLinks: [{ subject: 'business', address: '1930 Montgomery St', relation: 'related_to' }],
  },
  {
    id: 'live-oak-public-library',
    createdAt: '2025-03-26T15:42:00Z',
    person: {
      name: 'Elizabeth McCullar',
      email: 'mccullare@liveoakpl.org',
      phone: '+1 912-652-3665',
    },
    business: {
      name: 'Live Oak Public Library',
      website: 'https://liveoakpl.com',
      address: '2002 Bull St',
    },
    propertyLinks: [{ subject: 'business', address: '2002 Bull St', relation: 'related_to' }],
  },
  {
    id: 'green-truck-pub',
    createdAt: '2025-11-17T22:47:00Z',
    person: {
      name: 'Whitney Shephard',
      email: 'whitneyshephard@gmail.com',
      phone: '+1 912-234-5885',
      mailingAddress: '644 E 44th St, Savannah, GA 31405',
    },
    business: {
      name: 'Green Truck Pub',
      website: 'https://greentruckpub.com',
      address: '2430 Habersham St',
    },
    propertyLinks: [
      { subject: 'person', address: '644 E 44th St', relation: 'owns' },
      { subject: 'business', address: '2430 Habersham St', relation: 'related_to' },
    ],
  },
  {
    id: 'galloway-house',
    createdAt: '2023-08-27T20:37:00Z',
    person: {
      name: 'Keith Galloway',
      email: 'keith@thegallowayhouse.com',
      phone: '+1 912-704-6296',
      mailingAddress: '107 E 35th St, Savannah, GA 31401',
    },
    business: {
      name: 'The Galloway House',
      website: 'https://thegallowayhouse.com',
      address: '107 E 35th St, Savannah, GA 31401',
    },
    propertyLinks: [
      { subject: 'person', address: '107 E 35th St', relation: 'owns' },
      { subject: 'business', address: '107 E 35th St', relation: 'related_to' },
    ],
  },
]

/** Matches the CSV's spelling variants to the county's uppercase situs addresses. */
export function normalizeTsnaAddress(value: string): string {
  return value
    .toUpperCase()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bWEST\b/g, 'W')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/[^A-Z0-9]/g, '')
}

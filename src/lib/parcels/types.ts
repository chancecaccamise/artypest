/*
  The parcel service seam.

  SAGIS turned out to be a public ArcGIS Server with no authentication and open
  CORS, so this interface now has a real implementation behind it as well as the
  fixture. See docs/SAGIS-API.md for the field inventory this shape is drawn
  from, and for the three things the earlier version of this file got wrong.
*/

/** The four components the county publishes an owner's mailing address in. */
export interface MailingAddress {
  street: string
  city: string
  state: string
  zip: string
}

/** One parcel record as Chatham County publishes it. */
export interface ParcelRecord {
  /** See src/lib/parcels/pin.ts for the three valid shapes. */
  pin: string
  /**
   * The address of the land itself, which is not always where the owner is,
   * and is not always numbered: a city park parcel can be just `E 46TH ST`.
   */
  situsAddress: string
  /**
   * Exactly as the county writes it, capitals and all, and truncated at 40
   * characters upstream. Do not clean this up in place: src/lib/parcels/owner.ts
   * parses it, and the raw string is what a reader compares against the county
   * viewer.
   */
  ownerName: string
  /** The county's second owner field. A whole name, not a fragment. */
  ownerName2: string | null
  ownerMailingAddress: MailingAddress
  acreage: number
  /**
   * Not published on the parcel. Resolved by intersecting the parcel against
   * the City of Savannah zoning layer, so it is null for unincorporated county
   * parcels and must render as "not available" rather than blank.
   */
  zoningDistrict: string | null
  /**
   * The Board of Assessors property class code, for example `R3` or `E1`.
   * A code, not a label: the service publishes no domain for it.
   */
  propertyUseCode: string | null
  /** What the county thinks the land and buildings are worth. */
  fairMarketValue: number
  /**
   * 40% of fair market value, which is Georgia's assessment ratio. Zero on an
   * exempt parcel that still carries a fair market value.
   */
  totalAssessment: number
  yearBuilt: number | null
  legalDescription: string
  /** Zero-padded county code, for example `020`. See checkJurisdiction. */
  municipalityCode: string | null
  /** ISO date. The county publishes epoch milliseconds and no assessment year. */
  dateUpdated: string | null
}

export interface ParcelService {
  /**
   * `fixture` while parcel data comes from the local sample file, `sagis`
   * once the live connection is configured. The user interface reads this to
   * decide what to say about the source, so it never claims to be live.
   */
  readonly kind: 'fixture' | 'sagis'

  /** Whether a live connection is configured. */
  readonly connected: boolean

  /** One parcel, or null when the PIN is not in the source. */
  getByPin(pin: string): Promise<ParcelRecord | null>

  /** Several parcels at once. Unknown PINs are reported back, not dropped. */
  getManyByPin(pins: string[]): Promise<{ found: ParcelRecord[]; missing: string[] }>

  /**
   * Everything the source has. Only the fixture can answer this. SAGIS holds
   * 125,326 parcels behind a 2000-record page limit, so the live implementation
   * throws and the "Load sample neighborhood" option is hidden.
   */
  listAll(): Promise<ParcelRecord[]>
}

/** Formats the county's four mailing fields as one line for display. */
export function formatMailingAddress(address: MailingAddress): string {
  const locality = [address.city, address.state].filter((part) => part.trim() !== '').join(', ')
  return [address.street, locality, address.zip]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

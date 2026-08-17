/*
  The parcel service seam.

  There is no SAGIS endpoint, no network call, and no credentials in this
  phase. All parcel user interface is built against a local fixture behind this
  interface, so the real implementation is a drop-in later.

  SagisParcelService.ts does not exist yet. Do not create it.
*/

/** One parcel record as a county GIS publishes it. */
export interface ParcelRecord {
  /** Eleven characters. See src/lib/parcels/pin.ts for the two valid shapes. */
  pin: string
  /** The address of the land itself, which is not always where the owner is. */
  situsAddress: string
  /** As the county writes it: usually all caps, people last-comma-first. */
  ownerName: string
  ownerMailingAddress: string
  acreage: number
  /** The regulatory district. Not the same thing as property use. */
  zoningDistrict: string
  assessedValue: number
  assessedYear: number
}

export interface ParcelService {
  /**
   * `fixture` while parcel data comes from the local sample file, `sagis`
   * once the live connection is configured. The user interface reads this to
   * decide what to say about the source, so it never claims to be live.
   */
  readonly kind: 'fixture' | 'sagis'

  /** Whether a live connection is configured. False for the whole of this phase. */
  readonly connected: boolean

  /** One parcel, or null when the PIN is not in the source. */
  getByPin(pin: string): Promise<ParcelRecord | null>

  /** Several parcels at once. Unknown PINs are reported back, not dropped. */
  getManyByPin(pins: string[]): Promise<{ found: ParcelRecord[]; missing: string[] }>

  /**
   * Everything the source has. Only the fixture can answer this: SAGIS has no
   * "give me the county" endpoint, so the live implementation will throw and
   * the "Load sample neighborhood" option will be hidden.
   */
  listAll(): Promise<ParcelRecord[]>
}

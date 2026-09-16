import { z } from 'zod'

import { isValidPin, normalizePin } from '@/lib/parcels/pin'
import type { EntityType } from '@/lib/data/types'

/*
  One Zod schema per entity type, shared between form validation and the
  validation the API layer will do once there is an API. The form and the
  server must not be able to disagree about what a valid property is.

  Every field is optional at the schema level except the name, because a board
  member should be able to record "there is a lot here and I do not yet know
  its PIN" without the form fighting them. Completeness is surfaced on the
  dashboard as Needs Attention rather than enforced at the point of entry.
*/

/** Empty strings from an untouched input mean "not set", not "the empty string". */
const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()

const optionalEmail = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine((value) => value === null || z.string().email().safeParse(value).success, {
    message: 'Enter an email address, for example name@example.com.',
  })

/** A number that arrives from an <input type="number"> as a string. */
const optionalNumber = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => {
    if (value === null || value === '') return null
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  })
  .nullable()

const optionalYear = optionalNumber.refine(
  (value) => value === null || (value >= 1700 && value <= 2200),
  { message: 'Enter a four-digit year.' }
)

const optionalDate = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: 'Enter a date.',
  })

/**
 * A PIN is optional, but a PIN that is present must be one of the two valid
 * shapes. It is stored normalised so a pasted `20032  63001` matches.
 */
const optionalPin = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : normalizePin(value)))
  .nullable()
  .refine((value) => value === null || isValidPin(value), {
    // Three real shapes, see docs/SAGIS-API.md. The 12-character form has both
    // a space and a trailing letter, and is a real parcel.
    message:
      'A PIN is 11 or 12 characters: 20074 45001 with a space, 10025C01001 with a letter, or 10011 02012C with both.',
  })

export const personDataSchema = z.object({
  email: optionalEmail,
  phone: optionalText,
  mailingAddress: optionalText,
  householdRole: optionalText,
  memberSince: optionalYear,
  /**
   * A short public description: who this person is to the association. Distinct
   * from `notes`, which is internal and is never rendered for a resident.
   */
  bio: optionalText,
  /**
   * A data URL today, downscaled in the browser by src/lib/photos.ts. Becomes a
   * Supabase Storage URL later, and stays a string either way.
   */
  // Managed by the photo panel rather than the add/edit field grid.
  photo: optionalText.optional(),
  notes: optionalText,
})

export const propertyDataSchema = z.object({
  pin: optionalPin,
  lotNumber: optionalText,
  situsAddress: optionalText,
  // Two different fields. Zoning is the regulatory district, property use is
  // what is actually there. Collapsing them breaks the core query.
  zoning: optionalText,
  propertyUse: optionalText,
  /** The county's Board of Assessors class code, for example R3. */
  propertyUseCode: optionalText,
  acreage: optionalNumber,
  fairMarketValue: optionalNumber,
  /** 40% of fair market value, which is Georgia's assessment ratio. */
  assessedValue: optionalNumber,
  /**
   * When the county last touched the parcel. There is no assessment-year field
   * on the parcel roll, so this is the closest thing to one.
   */
  parcelUpdatedAt: optionalText,
  yearBuilt: optionalYear,
  squareFeet: optionalNumber,
  parcelSource: optionalText,
  /** The last transfer the county recorded, `YYYY-MM-DD`. */
  lastSaleDate: optionalDate,
  /*
    These two are `.optional()` as well as nullable, which the rest of this
    schema is not.

    Everything else here has a field in the property form, so the form always
    submits the key, even when empty. These two deliberately have no field: they
    are the county's own record, shown on the Parcel record card beside the code
    that qualifies them, and offering them as editable inputs would invite
    somebody to correct the county's roll in a copy of it. A key with no field
    is simply absent from a newly created record, and `nullable` alone rejects
    absent.
  */

  /**
   * What it sold for. Absent rather than zero when no price was recorded: a
   * third of recorded transfers carry none, because a gift, a family transfer
   * and a foreclosure are transfers with no consideration.
   */
  lastSalePrice: optionalNumber.optional(),
  /**
   * The county's sale qualification code, usually `Q` or `U`. A code, not a
   * label: the Board of Assessors publishes no table for it, and the price
   * should not be read as a market value without it. See docs/SAGIS-API.md.
   */
  saleQualityCode: optionalText.optional(),
  notes: optionalText,
})

export const businessDataSchema = z.object({
  businessCategory: optionalText,
  stateFilingNumber: optionalText,
  contactName: optionalText,
  phone: optionalText,
  email: optionalEmail,
  website: optionalText,
  mailingAddress: optionalText,
  notes: optionalText,
})

export const associationDataSchema = z.object({
  associationType: optionalText,
  boardSeats: optionalNumber,
  foundedYear: optionalYear,
  jurisdiction: optionalText,
  meetingCadence: optionalText,
  /*
    How to reach it. Added when the parcel import learned to file a condominium
    owners association as an association rather than as a company: the county
    publishes a mailing address for every owner, and dropping it because the
    schema had no room for it would have thrown away the only contact detail on
    the record.
  */
  mailingAddress: optionalText,
  notes: optionalText,
})

export const assetDataSchema = z.object({
  assetTag: optionalText,
  condition: optionalText,
  lastInspected: optionalDate,
  replacementCost: optionalNumber,
  notes: optionalText,
})

export const recordDataSchema = z.object({
  recordNumber: optionalText,
  recordType: optionalText,
  status: optionalText,
  occurredOn: optionalDate,
  followUpDate: optionalDate,
  summary: optionalText,
  notes: optionalText,
  /** Present on reminder records created from a person or business page. */
  subjectId: optionalText.optional(),
  subjectType: optionalText.optional(),
  completedAt: optionalDate.optional(),
})

export const documentDataSchema = z.object({
  documentType: optionalText,
  effectiveDate: optionalDate,
  pageCount: optionalNumber,
  notes: optionalText,
})

export const ENTITY_DATA_SCHEMAS = {
  person: personDataSchema,
  property: propertyDataSchema,
  business: businessDataSchema,
  association: associationDataSchema,
  asset: assetDataSchema,
  record: recordDataSchema,
  document: documentDataSchema,
} as const satisfies Record<EntityType, z.ZodTypeAny>

const NAME_LABELS: Record<EntityType, string> = {
  person: 'Enter the person’s name.',
  property: 'Enter the street address.',
  business: 'Enter the business name.',
  association: 'Enter the association name.',
  asset: 'Enter a name for the asset.',
  record: 'Enter a title for the record.',
  document: 'Enter the document title.',
}

/** The whole form for one entity type: the name plus that type's data fields. */
export function entityFormSchema(type: EntityType) {
  return z.object({
    name: z.string().trim().min(1, NAME_LABELS[type]),
    data: ENTITY_DATA_SCHEMAS[type],
  })
}

export type EntityFormValues = {
  name: string
  data: Record<string, unknown>
}

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
    message: 'A PIN is 11 characters: 20032 63001 with a space, or 10993C01034 with a letter.',
  })

export const personDataSchema = z.object({
  email: optionalEmail,
  phone: optionalText,
  mailingAddress: optionalText,
  householdRole: optionalText,
  memberSince: optionalYear,
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
  acreage: optionalNumber,
  assessedValue: optionalNumber,
  assessedYear: optionalYear,
  yearBuilt: optionalYear,
  squareFeet: optionalNumber,
  parcelSource: optionalText,
  notes: optionalText,
})

export const businessDataSchema = z.object({
  businessCategory: optionalText,
  stateFilingNumber: optionalText,
  contactName: optionalText,
  phone: optionalText,
  email: optionalEmail,
  mailingAddress: optionalText,
  notes: optionalText,
})

export const associationDataSchema = z.object({
  associationType: optionalText,
  boardSeats: optionalNumber,
  foundedYear: optionalYear,
  jurisdiction: optionalText,
  meetingCadence: optionalText,
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

/*
  The twenty NAICS sectors, the top level of the North American Industry
  Classification System that the Census Bureau and the SBA file businesses
  under. https://www.naics.com/search-naics-codes-by-industry/

  A fixed federal list, so it lives here rather than as an editable reference
  list: an association renaming "Construction" would only make its records
  disagree with every other source that uses the code.

  The code is what is stored. Three sectors span a range of two-digit codes,
  and the range is the sector's code as NAICS publishes it.
*/

export interface NaicsSector {
  /** Stored on the business, for example "54" or "31-33". */
  value: string
  label: string
}

export const NAICS_SECTORS: readonly NaicsSector[] = [
  { value: '11', label: 'Agriculture, Forestry, Fishing and Hunting' },
  { value: '21', label: 'Mining' },
  { value: '22', label: 'Utilities' },
  { value: '23', label: 'Construction' },
  { value: '31-33', label: 'Manufacturing' },
  { value: '42', label: 'Wholesale Trade' },
  { value: '44-45', label: 'Retail Trade' },
  { value: '48-49', label: 'Transportation and Warehousing' },
  { value: '51', label: 'Information' },
  { value: '52', label: 'Finance and Insurance' },
  { value: '53', label: 'Real Estate Rental and Leasing' },
  { value: '54', label: 'Professional, Scientific, and Technical Services' },
  { value: '55', label: 'Management of Companies and Enterprises' },
  {
    value: '56',
    label: 'Administrative and Support and Waste Management and Remediation Services',
  },
  { value: '61', label: 'Educational Services' },
  { value: '62', label: 'Health Care and Social Assistance' },
  { value: '71', label: 'Arts, Entertainment, and Recreation' },
  { value: '72', label: 'Accommodation and Food Services' },
  { value: '81', label: 'Other Services (except Public Administration)' },
  { value: '92', label: 'Public Administration' },
]

const BY_CODE = new Map(NAICS_SECTORS.map((sector) => [sector.value, sector]))

/** The sector for a stored code, or undefined for anything else. */
export function naicsSector(code: string): NaicsSector | undefined {
  return BY_CODE.get(code.trim())
}

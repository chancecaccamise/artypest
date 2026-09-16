import type { ReactNode } from 'react'

import { IdChip } from '@/components/ui/id-chip'
import { StatusBadge, type StatusTone } from '@/components/ui/badge'
import type { Entity, EntityType, ReferenceList } from '@/lib/data/types'
import {
  formatAcreage,
  formatCurrency,
  formatDate,
  humanize,
  readNumber,
  readString,
} from '@/lib/format'

/*
  One page component drives all seven directory types. Everything that differs
  between them is declared here: columns, filters, the field grid on the
  Details tab, and the identifier chips.

  Adding a type is a new entry in this file, not a new page.
*/

export interface LabelLookup {
  /** Reference label for a stored value, falling back to a humanized slug. */
  (list: ReferenceList, value: unknown): string
}

export interface ColumnDef {
  key: string
  label: string
  /** Sorting is server-side on name, createdAt, and updatedAt only. */
  sortKey?: 'name' | 'createdAt' | 'updatedAt'
  className?: string
  render: (entity: Entity, labelFor: LabelLookup) => ReactNode
}

export interface FilterDef {
  /** Key inside the JSONB data column. */
  key: string
  label: string
  /** Options come from the org's reference list when one is named. */
  referenceList?: ReferenceList
  options?: { value: string; label: string }[]
}

export type FieldFormat =
  | 'text'
  | 'longtext'
  | 'date'
  | 'currency'
  | 'acreage'
  | 'number'
  | 'mono'
  | 'email'
  | 'phone'
  | 'reference'
  | 'year'

export interface FieldDef {
  key: string
  label: string
  format?: FieldFormat
  referenceList?: ReferenceList
  /** Notes are internal and never rendered for a resident. */
  internal?: boolean
  /** Rendered by a dedicated card instead of the generic grid. */
  hiddenFromGrid?: boolean
}

export interface ChipSpec {
  prefix?: string
  value: string
  title?: string
}

export interface DirectoryConfig {
  type: EntityType
  path: string
  /** Plural, for the page title and nav. */
  title: string
  singular: string
  /** One sentence under the page title. */
  blurb: string
  columns: ColumnDef[]
  filters: FilterDef[]
  fields: FieldDef[]
  /** Identifier chips, the signature element. Empty array is allowed. */
  chips: (entity: Entity) => ChipSpec[]
}

/* ------------------------------------------------------------- utilities -- */

function text(entity: Entity, key: string): string {
  return readString(entity.data[key])
}

function number(entity: Entity, key: string): number | null {
  return readNumber(entity.data[key])
}

/** A muted "Not set" rather than a blank cell, so an empty field is visible. */
export function NotSet() {
  return <span className="text-ink-faint">Not set</span>
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>
}

function orNotSet(value: string, render: (value: string) => ReactNode = (v) => v): ReactNode {
  return value === '' ? <NotSet /> : render(value)
}

const RECORD_STATUS_TONE: Record<string, StatusTone> = {
  open: 'oxblood',
  in_review: 'amber',
  closed: 'moss',
}

const CONDITION_TONE: Record<string, StatusTone> = {
  good: 'moss',
  fair: 'amber',
  poor: 'oxblood',
}

/* --------------------------------------------------------------- configs -- */

const personConfig: DirectoryConfig = {
  type: 'person',
  path: '/people',
  title: 'People',
  singular: 'Person',
  blurb: 'Residents, owners, board members, and anyone else on the association roll.',
  columns: [
    {
      key: 'name',
      label: 'Name',
      sortKey: 'name',
      className: 'font-medium',
      render: (entity) => entity.name,
    },
    {
      key: 'householdRole',
      label: 'Role',
      render: (entity) => orNotSet(text(entity, 'householdRole'), (value) => humanize(value)),
    },
    {
      key: 'email',
      label: 'Email',
      render: (entity) =>
        orNotSet(text(entity, 'email'), (value) => (
          <a href={`mailto:${value}`} className="text-survey hover:underline">
            {value}
          </a>
        )),
    },
    {
      key: 'phone',
      label: 'Phone',
      render: (entity) => orNotSet(text(entity, 'phone'), (value) => <Mono>{value}</Mono>),
    },
    {
      key: 'memberSince',
      label: 'Member since',
      className: 'w-32',
      render: (entity) => orNotSet(text(entity, 'memberSince'), (value) => <Mono>{value}</Mono>),
    },
  ],
  filters: [
    {
      key: 'householdRole',
      label: 'Household role',
      options: [
        { value: 'owner', label: 'Owner' },
        { value: 'resident', label: 'Resident' },
        { value: 'former_owner', label: 'Former owner' },
      ],
    },
  ],
  fields: [
    { key: 'email', label: 'Email', format: 'email' },
    { key: 'phone', label: 'Phone', format: 'phone' },
    { key: 'mailingAddress', label: 'Mailing address' },
    { key: 'householdRole', label: 'Household role' },
    { key: 'memberSince', label: 'Member since', format: 'year' },
    /*
      Public, and distinct from notes on purpose. This is who the person is to
      the association and it appears on their card; notes are internal and are
      never rendered for a resident.
    */
    { key: 'bio', label: 'Biography', format: 'longtext', hiddenFromGrid: true },
    { key: 'notes', label: 'Notes', format: 'longtext', internal: true, hiddenFromGrid: true },
  ],
  chips: (entity) => {
    const since = text(entity, 'memberSince')
    return since === '' ? [] : [{ value: `member since ${since}` }]
  },
}

const propertyConfig: DirectoryConfig = {
  type: 'property',
  path: '/properties',
  title: 'Properties',
  singular: 'Property',
  blurb: 'Every platted lot, with the parcel record the county publishes for it.',
  columns: [
    {
      key: 'name',
      label: 'Address',
      sortKey: 'name',
      className: 'font-medium',
      render: (entity) => entity.name,
    },
    {
      key: 'identifier',
      label: 'Identifiers',
      className: 'w-64',
      render: (entity) => {
        const lot = text(entity, 'lotNumber')
        const pin = text(entity, 'pin')
        if (lot === '' && pin === '') return <NotSet />
        return (
          <span className="flex flex-wrap items-center gap-1">
            {lot === '' ? null : <IdChip prefix="Lot">{lot}</IdChip>}
            {pin === '' ? null : <IdChip prefix="PIN">{pin}</IdChip>}
          </span>
        )
      },
    },
    {
      key: 'zoning',
      label: 'Zoning',
      className: 'w-28',
      // The district code, not its long reference label: this column is scanned.
      render: (entity) => orNotSet(text(entity, 'zoning'), (value) => <Mono>{value}</Mono>),
    },
    {
      key: 'propertyUse',
      label: 'Property use',
      className: 'w-40',
      render: (entity, labelFor) =>
        orNotSet(text(entity, 'propertyUse'), () =>
          labelFor('property_use', entity.data.propertyUse)
        ),
    },
    {
      key: 'assessedValue',
      label: 'Assessed',
      className: 'w-32 text-right',
      render: (entity) => {
        const value = number(entity, 'assessedValue')
        return value === null ? <NotSet /> : <Mono>{formatCurrency(value)}</Mono>
      },
    },
    {
      key: 'acreage',
      label: 'Acreage',
      className: 'w-28 text-right',
      render: (entity) => {
        const value = number(entity, 'acreage')
        return value === null ? <NotSet /> : <Mono>{formatAcreage(value)}</Mono>
      },
    },
  ],
  filters: [
    { key: 'zoning', label: 'Zoning district', referenceList: 'zoning' },
    { key: 'propertyUse', label: 'Property use', referenceList: 'property_use' },
    {
      key: 'parcelSource',
      label: 'Parcel source',
      options: [
        { value: 'imported', label: 'Imported from parcel data' },
        { value: 'manual', label: 'Entered manually' },
      ],
    },
  ],
  /*
    Fields the county publishes are rendered by the Parcel Record card rather
    than here, so the Details tab is what the association itself records and
    the two panels do not print the same six rows twice. Everything below is
    still editable in the form, which reads this list unfiltered.

    Zoning and property use stay two fields, never one. Zoning is the
    regulatory district, property use is what is actually there, and
    collapsing them breaks the commercial-in-residential query.
  */
  fields: [
    { key: 'lotNumber', label: 'Lot number', format: 'mono' },
    {
      key: 'propertyUse',
      label: 'Property use',
      format: 'reference',
      referenceList: 'property_use',
    },
    { key: 'yearBuilt', label: 'Year built', format: 'year' },
    { key: 'squareFeet', label: 'Square feet', format: 'number' },
    { key: 'situsAddress', label: 'Situs address', hiddenFromGrid: true },
    {
      key: 'zoning',
      label: 'Zoning district',
      format: 'reference',
      referenceList: 'zoning',
      hiddenFromGrid: true,
    },
    { key: 'acreage', label: 'Acreage', format: 'acreage', hiddenFromGrid: true },
    {
      key: 'propertyUseCode',
      label: 'County class code',
      format: 'mono',
      hiddenFromGrid: true,
    },
    {
      key: 'fairMarketValue',
      label: 'Fair market value',
      format: 'currency',
      hiddenFromGrid: true,
    },
    { key: 'assessedValue', label: 'Assessed value', format: 'currency', hiddenFromGrid: true },
    /*
      The last transfer on the county roll. Shown in the grid, unlike the
      valuation fields, because "when did this last change hands" is a question
      a board asks while scanning a list rather than while reading one record.
    */
    { key: 'lastSaleDate', label: 'Last sale', format: 'date' },
    /*
      The price and the county's qualification code are not here on purpose.
      They belong with the rest of the county's own record, on the Parcel record
      card, where the code sits beside the number it qualifies. Listing them
      here as editable fields would invite somebody to correct the county's roll
      in a copy of it.
    */
    /*
      The parcel roll has no assessment-year field. This is when the county last
      touched the record, which is the closest thing it publishes.
    */
    { key: 'parcelUpdatedAt', label: 'County last updated', hiddenFromGrid: true },
    { key: 'pin', label: 'Parcel number', format: 'mono', hiddenFromGrid: true },
    { key: 'parcelSource', label: 'Parcel source', hiddenFromGrid: true },
    { key: 'notes', label: 'Notes', format: 'longtext', internal: true, hiddenFromGrid: true },
  ],
  chips: (entity) => {
    const chips: ChipSpec[] = []
    const lot = text(entity, 'lotNumber')
    const pin = text(entity, 'pin')
    if (lot !== '') chips.push({ prefix: 'Lot', value: lot })
    if (pin !== '')
      chips.push({ prefix: 'PIN', value: pin, title: 'SAGIS parcel identification number' })
    return chips
  },
}

const businessConfig: DirectoryConfig = {
  type: 'business',
  path: '/businesses',
  title: 'Businesses',
  singular: 'Business',
  blurb: 'Vendors, management companies, and any business that owns a lot.',
  columns: [
    {
      key: 'name',
      label: 'Name',
      sortKey: 'name',
      className: 'font-medium',
      render: (entity) => entity.name,
    },
    {
      key: 'businessCategory',
      label: 'Category',
      render: (entity) => orNotSet(text(entity, 'businessCategory'), (value) => humanize(value)),
    },
    {
      key: 'contactName',
      label: 'Contact',
      render: (entity) => orNotSet(text(entity, 'contactName')),
    },
    {
      key: 'phone',
      label: 'Phone',
      render: (entity) => orNotSet(text(entity, 'phone'), (value) => <Mono>{value}</Mono>),
    },
    {
      key: 'stateFilingNumber',
      label: 'Filing no.',
      className: 'w-32',
      render: (entity) =>
        orNotSet(text(entity, 'stateFilingNumber'), (value) => <Mono>{value}</Mono>),
    },
  ],
  filters: [
    {
      key: 'businessCategory',
      label: 'Category',
      options: [
        { value: 'grounds_maintenance', label: 'Grounds maintenance' },
        { value: 'property_management', label: 'Property management' },
        { value: 'pest_control', label: 'Pest control' },
        { value: 'arborist', label: 'Arborist' },
        { value: 'general_contractor', label: 'General contractor' },
        { value: 'accounting', label: 'Accounting' },
        { value: 'insurance', label: 'Insurance' },
        { value: 'property_owner', label: 'Property owner' },
        { value: 'member_business', label: 'Member business' },
      ],
    },
  ],
  fields: [
    { key: 'businessCategory', label: 'Category' },
    { key: 'stateFilingNumber', label: 'State filing number', format: 'mono' },
    { key: 'contactName', label: 'Primary contact' },
    { key: 'phone', label: 'Phone', format: 'phone' },
    { key: 'email', label: 'Email', format: 'email' },
    { key: 'website', label: 'Website' },
    { key: 'mailingAddress', label: 'Mailing address' },
    { key: 'notes', label: 'Notes', format: 'longtext', internal: true, hiddenFromGrid: true },
  ],
  chips: (entity) => {
    const chips: ChipSpec[] = []
    const category = text(entity, 'businessCategory')
    const filing = text(entity, 'stateFilingNumber')
    if (category !== '') chips.push({ value: humanize(category) })
    if (filing !== '') chips.push({ prefix: 'Filing', value: filing })
    return chips
  },
}

const associationConfig: DirectoryConfig = {
  type: 'association',
  path: '/associations',
  title: 'Associations',
  singular: 'Association',
  blurb: 'The association itself and every standing committee under it.',
  columns: [
    {
      key: 'name',
      label: 'Name',
      sortKey: 'name',
      className: 'font-medium',
      render: (entity) => entity.name,
    },
    {
      key: 'associationType',
      label: 'Type',
      render: (entity, labelFor) =>
        orNotSet(text(entity, 'associationType'), () =>
          labelFor('association_type', entity.data.associationType)
        ),
    },
    {
      key: 'boardSeats',
      label: 'Seats',
      className: 'w-24 text-right',
      render: (entity) => {
        const seats = number(entity, 'boardSeats')
        return seats === null ? <NotSet /> : <Mono>{seats}</Mono>
      },
    },
    {
      key: 'jurisdiction',
      label: 'Jurisdiction',
      render: (entity) => orNotSet(text(entity, 'jurisdiction')),
    },
  ],
  filters: [{ key: 'associationType', label: 'Type', referenceList: 'association_type' }],
  fields: [
    {
      key: 'associationType',
      label: 'Type',
      format: 'reference',
      referenceList: 'association_type',
    },
    { key: 'boardSeats', label: 'Board seats', format: 'number' },
    { key: 'foundedYear', label: 'Founded', format: 'year' },
    { key: 'jurisdiction', label: 'Jurisdiction' },
    { key: 'meetingCadence', label: 'Meetings' },
    /*
      The parcel import files a condominium owners association as an
      association, and the county publishes a mailing address for every owner.
      Without a field for it that address would be filed onto a record that
      never shows it.
    */
    { key: 'mailingAddress', label: 'Mailing address', hiddenFromGrid: true },
    { key: 'notes', label: 'Notes', format: 'longtext', internal: true, hiddenFromGrid: true },
  ],
  chips: (entity) => {
    const seats = number(entity, 'boardSeats')
    return seats === null ? [] : [{ value: `${seats} seats` }]
  },
}

const assetConfig: DirectoryConfig = {
  type: 'asset',
  path: '/assets',
  title: 'Assets',
  singular: 'Asset',
  blurb: 'Common-area property the association is responsible for maintaining.',
  columns: [
    {
      key: 'name',
      label: 'Asset',
      sortKey: 'name',
      className: 'font-medium',
      render: (entity) => entity.name,
    },
    {
      key: 'assetTag',
      label: 'Tag',
      className: 'w-28',
      render: (entity) => orNotSet(text(entity, 'assetTag'), (value) => <Mono>{value}</Mono>),
    },
    {
      key: 'condition',
      label: 'Condition',
      className: 'w-32',
      render: (entity) => {
        const value = text(entity, 'condition')
        if (value === '') return <NotSet />
        return (
          <StatusBadge tone={CONDITION_TONE[value] ?? 'neutral'}>{humanize(value)}</StatusBadge>
        )
      },
    },
    {
      key: 'lastInspected',
      label: 'Last inspected',
      className: 'w-40',
      render: (entity) =>
        orNotSet(text(entity, 'lastInspected'), (value) => <Mono>{formatDate(value)}</Mono>),
    },
    {
      key: 'replacementCost',
      label: 'Replacement',
      className: 'w-32 text-right',
      render: (entity) => {
        const value = number(entity, 'replacementCost')
        return value === null ? <NotSet /> : <Mono>{formatCurrency(value)}</Mono>
      },
    },
  ],
  filters: [
    {
      key: 'condition',
      label: 'Condition',
      options: [
        { value: 'good', label: 'Good' },
        { value: 'fair', label: 'Fair' },
        { value: 'poor', label: 'Poor' },
      ],
    },
  ],
  fields: [
    { key: 'assetTag', label: 'Asset tag', format: 'mono' },
    { key: 'condition', label: 'Condition' },
    { key: 'lastInspected', label: 'Last inspected', format: 'date' },
    { key: 'replacementCost', label: 'Replacement cost', format: 'currency' },
    { key: 'notes', label: 'Notes', format: 'longtext', internal: true, hiddenFromGrid: true },
  ],
  chips: (entity) => {
    const tag = text(entity, 'assetTag')
    return tag === '' ? [] : [{ prefix: 'Tag', value: tag }]
  },
}

const recordConfig: DirectoryConfig = {
  type: 'record',
  path: '/records',
  title: 'Records',
  singular: 'Record',
  blurb: 'Violations, requests, complaints, minutes, and assessments.',
  columns: [
    {
      key: 'name',
      label: 'Record',
      sortKey: 'name',
      className: 'font-medium',
      render: (entity) => entity.name,
    },
    {
      key: 'recordNumber',
      label: 'Number',
      className: 'w-32',
      render: (entity) => orNotSet(text(entity, 'recordNumber'), (value) => <Mono>{value}</Mono>),
    },
    {
      key: 'recordType',
      label: 'Type',
      render: (entity, labelFor) =>
        orNotSet(text(entity, 'recordType'), () => labelFor('record_type', entity.data.recordType)),
    },
    {
      key: 'status',
      label: 'Status',
      className: 'w-28',
      render: (entity) => {
        const value = text(entity, 'status')
        if (value === '') return <NotSet />
        return (
          <StatusBadge tone={RECORD_STATUS_TONE[value] ?? 'neutral'}>{humanize(value)}</StatusBadge>
        )
      },
    },
    {
      key: 'occurredOn',
      label: 'Opened',
      sortKey: 'createdAt',
      className: 'w-36',
      render: (entity) =>
        orNotSet(text(entity, 'occurredOn'), (value) => <Mono>{formatDate(value)}</Mono>),
    },
    {
      key: 'followUpDate',
      label: 'Follow up',
      className: 'w-36',
      render: (entity) =>
        orNotSet(text(entity, 'followUpDate'), (value) => <Mono>{formatDate(value)}</Mono>),
    },
  ],
  filters: [
    { key: 'recordType', label: 'Record type', referenceList: 'record_type' },
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'in_review', label: 'In review' },
        { value: 'closed', label: 'Closed' },
      ],
    },
  ],
  fields: [
    { key: 'recordNumber', label: 'Record number', format: 'mono' },
    { key: 'recordType', label: 'Record type', format: 'reference', referenceList: 'record_type' },
    { key: 'status', label: 'Status' },
    { key: 'occurredOn', label: 'Opened', format: 'date' },
    { key: 'followUpDate', label: 'Follow up', format: 'date' },
    { key: 'summary', label: 'Summary', format: 'longtext' },
    { key: 'notes', label: 'Notes', format: 'longtext', internal: true, hiddenFromGrid: true },
  ],
  chips: (entity) => {
    const numberValue = text(entity, 'recordNumber')
    return numberValue === '' ? [] : [{ value: numberValue }]
  },
}

const documentConfig: DirectoryConfig = {
  type: 'document',
  path: '/documents',
  title: 'Documents',
  singular: 'Document',
  blurb: 'Covenants, bylaws, plats, policies, and studies.',
  columns: [
    {
      key: 'name',
      label: 'Document',
      sortKey: 'name',
      className: 'font-medium',
      render: (entity) => entity.name,
    },
    {
      key: 'documentType',
      label: 'Type',
      render: (entity) => orNotSet(text(entity, 'documentType'), (value) => humanize(value)),
    },
    {
      key: 'effectiveDate',
      label: 'Effective',
      className: 'w-40',
      render: (entity) =>
        orNotSet(text(entity, 'effectiveDate'), (value) => <Mono>{formatDate(value)}</Mono>),
    },
    {
      key: 'pageCount',
      label: 'Pages',
      className: 'w-24 text-right',
      render: (entity) => {
        const value = number(entity, 'pageCount')
        return value === null ? <NotSet /> : <Mono>{value}</Mono>
      },
    },
  ],
  filters: [
    {
      key: 'documentType',
      label: 'Document type',
      options: [
        { value: 'covenants', label: 'Covenants' },
        { value: 'bylaws', label: 'Bylaws' },
        { value: 'guidelines', label: 'Guidelines' },
        { value: 'plat', label: 'Plat' },
        { value: 'policy', label: 'Policy' },
        { value: 'study', label: 'Study' },
      ],
    },
  ],
  fields: [
    { key: 'documentType', label: 'Document type' },
    { key: 'effectiveDate', label: 'Effective date', format: 'date' },
    { key: 'pageCount', label: 'Pages', format: 'number' },
    { key: 'notes', label: 'Notes', format: 'longtext', internal: true, hiddenFromGrid: true },
  ],
  chips: (entity) => {
    const documentType = text(entity, 'documentType')
    return documentType === '' ? [] : [{ value: humanize(documentType) }]
  },
}

export const DIRECTORY_CONFIGS: Record<EntityType, DirectoryConfig> = {
  person: personConfig,
  property: propertyConfig,
  business: businessConfig,
  association: associationConfig,
  asset: assetConfig,
  record: recordConfig,
  document: documentConfig,
}

export const DIRECTORY_ROUTES = Object.values(DIRECTORY_CONFIGS).map((config) => ({
  // React Router path segments have no leading slash inside a parent route.
  path: config.path.slice(1),
  type: config.type,
}))

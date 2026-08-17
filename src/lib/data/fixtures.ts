import { RAW_PARCEL_FIXTURE } from '@/lib/parcels/FixtureParcelService'
import { parseOwner } from '@/lib/parcels/owner'
import { normalizePin } from '@/lib/parcels/pin'
import type { ParcelLayerRecord } from '@/lib/parcels/parcel-layer'
import { formatMailingAddress } from '@/lib/parcels/types'

import type {
  AuditEntry,
  Entity,
  EntityType,
  Org,
  OrgUser,
  ReferenceItem,
  Relation,
  RelationType,
} from './types'

/*
  Temporary demo data. This stands in for supabase/seed.sql until the local
  Supabase stack is set up.

  Two things about how it is built matter:

  1. The properties are seeded from the same fixture the parcel import reads,
     so the import has genuine matches to resolve and genuine creates to
     perform rather than a contrived pairing. Twelve of the matched properties
     are deliberately left stale, which is what gives the Match step a
     non-empty old-to-new diff to show.

  2. Every date is relative to a reference date rather than hardcoded, so
     "contract ending within 90 days" keeps meaning something no matter when
     the app is opened. Tests pass a fixed reference; the app passes today.
*/

export interface DemoData {
  org: Org
  relationTypes: RelationType[]
  entities: Entity[]
  relations: Relation[]
  auditEntries: AuditEntry[]
  referenceItems: ReferenceItem[]
  users: OrgUser[]
}

const ORG_ID = 'org-ardsley'

/** mulberry32, so the demo data is identical on every reload. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Indexed access under noUncheckedIndexedAccess, without a null check per use. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[((index % list.length) + list.length) % list.length]
  if (value === undefined) throw new Error(`Empty list indexed at ${index}`)
  return value
}

const PARCELS = RAW_PARCEL_FIXTURE

/** Parcels 0 to 39 get a property in the system. 40 to 59 stay unimported. */
const MATCHED_PARCEL_COUNT = 40

const PROPERTY_USES = [
  'single_family',
  'single_family',
  'single_family',
  'single_family',
  'duplex',
  'townhouse',
  'multi_family',
  'commercial',
  'vacant_lot',
] as const

export const RECORD_TYPES = [
  'covenant_violation',
  'architectural_request',
  'maintenance_request',
  'complaint',
  'meeting_minutes',
  'assessment',
] as const

export function buildDemoData(
  reference: Date = new Date(),
  /*
    The harvested parcel layer, when one has been fetched. Empty by default, so
    tests and any code path that does not want 10,000 lots keeps the small
    demo. See src/lib/parcels/parcel-layer.ts.
  */
  parcelLayer: readonly ParcelLayerRecord[] = []
): DemoData {
  const random = makeRandom(31405)
  const pick = <T>(list: readonly T[]): T => at(list, Math.floor(random() * list.length))
  const between = (min: number, max: number) => min + random() * (max - min)
  const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1))

  /** Midnight on the reference day, so day arithmetic never drifts by an hour. */
  const anchor = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate())
  )

  /** `YYYY-MM-DD`, offsetDays from the reference date. */
  function date(offsetDays: number): string {
    const value = new Date(anchor.getTime() + offsetDays * 86_400_000)
    return value.toISOString().slice(0, 10)
  }

  /** Full ISO timestamp, offsetDays from the reference date at the given hour. */
  function stamp(offsetDays: number, hour = 10, minute = 0): string {
    const value = new Date(anchor.getTime() + offsetDays * 86_400_000)
    value.setUTCHours(hour, minute, 0, 0)
    return value.toISOString()
  }

  const org: Org = {
    id: ORG_ID,
    name: 'Ardsley Park Homeowners Association',
    sagisUrlTemplate: 'https://gis.chathamcounty.org/parcelviewer?pin={pin}',
    createdAt: stamp(-1460, 14),
  }

  const relationTypes: RelationType[] = [
    { id: 'rt-owns', orgId: ORG_ID, key: 'owns', label: 'owns', reverseLabel: 'is owned by' },
    {
      id: 'rt-resides-at',
      orgId: ORG_ID,
      key: 'resides_at',
      label: 'resides at',
      reverseLabel: 'is home to',
    },
    {
      id: 'rt-member-of',
      orgId: ORG_ID,
      key: 'member_of',
      label: 'is a member of',
      reverseLabel: 'has member',
    },
    { id: 'rt-manages', orgId: ORG_ID, key: 'manages', label: 'manages', reverseLabel: 'is managed by' },
    {
      id: 'rt-employed-by',
      orgId: ORG_ID,
      key: 'employed_by',
      label: 'is employed by',
      reverseLabel: 'employs',
    },
    {
      id: 'rt-related-to',
      orgId: ORG_ID,
      key: 'related_to',
      label: 'is related to',
      reverseLabel: 'is related to',
    },
    {
      id: 'rt-vendor-for',
      orgId: ORG_ID,
      key: 'vendor_for',
      label: 'is a vendor for',
      reverseLabel: 'uses vendor',
    },
    {
      id: 'rt-adjacent-to',
      orgId: ORG_ID,
      key: 'adjacent_to',
      label: 'is adjacent to',
      reverseLabel: 'is adjacent to',
    },
    { id: 'rt-governs', orgId: ORG_ID, key: 'governs', label: 'governs', reverseLabel: 'is governed by' },
    {
      id: 'rt-references',
      orgId: ORG_ID,
      key: 'references',
      label: 'references',
      reverseLabel: 'is referenced by',
    },
  ]

  const entities: Entity[] = []
  const relations: Relation[] = []
  const auditEntries: AuditEntry[] = []
  let auditSeq = 0

  function entity(
    id: string,
    type: EntityType,
    name: string,
    data: Record<string, unknown>,
    createdDaysAgo: number,
    updatedDaysAgo = createdDaysAgo,
    lifecycle: { archivedAt?: string; deletedAt?: string } = {}
  ): Entity {
    const row: Entity = {
      id,
      orgId: ORG_ID,
      type,
      name,
      data,
      folderId: null,
      createdAt: stamp(-createdDaysAgo, intBetween(8, 18), intBetween(0, 59)),
      updatedAt: stamp(-updatedDaysAgo, intBetween(8, 18), intBetween(0, 59)),
      deletedAt: lifecycle.deletedAt ?? null,
      archivedAt: lifecycle.archivedAt ?? null,
    }
    entities.push(row)
    return row
  }

  function relation(
    id: string,
    relationTypeId: string,
    fromEntityId: string,
    toEntityId: string,
    options: {
      startDate?: string | null
      endDate?: string | null
      attributes?: Record<string, unknown>
      createdDaysAgo?: number
    } = {}
  ): Relation {
    const createdDaysAgo = options.createdDaysAgo ?? 200
    const row: Relation = {
      id,
      orgId: ORG_ID,
      relationTypeId,
      fromEntityId,
      toEntityId,
      startDate: options.startDate ?? null,
      endDate: options.endDate ?? null,
      attributes: options.attributes ?? {},
      createdAt: stamp(-createdDaysAgo, 11),
      updatedAt: stamp(-createdDaysAgo, 11),
      deletedAt: null,
      archivedAt: null,
    }
    relations.push(row)
    return row
  }

  function audit(
    tableName: AuditEntry['tableName'],
    recordId: string,
    action: AuditEntry['action'],
    fieldName: string | null,
    oldValue: string | null,
    newValue: string | null,
    changedBy: string,
    daysAgo: number,
    hour = 10
  ): void {
    auditSeq += 1
    auditEntries.push({
      id: `aud-seed-${String(auditSeq).padStart(4, '0')}`,
      orgId: ORG_ID,
      tableName,
      recordId,
      action,
      fieldName,
      oldValue,
      newValue,
      changedBy,
      changedAt: stamp(-daysAgo, hour, intBetween(0, 59)),
      batchId: null,
    })
  }

  /* ---------------------------------------------------------------- orgs -- */

  const hoa = entity(
    'ent-assoc-ardsley',
    'association',
    'Ardsley Park Homeowners Association',
    {
      associationType: 'hoa',
      boardSeats: 7,
      jurisdiction: 'City of Savannah',
      foundedYear: 1972,
      meetingCadence: 'Second Tuesday, monthly',
      notes: 'Governs the 48 platted lots between Bull Street and Waters Avenue.',
    },
    1460,
    240
  )

  const archCommittee = entity(
    'ent-assoc-architectural',
    'association',
    'Architectural Review Committee',
    {
      associationType: 'committee',
      boardSeats: 5,
      jurisdiction: 'City of Savannah',
      notes: 'Reviews exterior alterations under Article VII of the covenants.',
    },
    900,
    180
  )

  const landscapeCommittee = entity(
    'ent-assoc-landscape',
    'association',
    'Landscape and Grounds Committee',
    {
      associationType: 'committee',
      boardSeats: 4,
      jurisdiction: 'City of Savannah',
      notes: 'Oversees the median plantings and the Baldwin Park frontage.',
    },
    720,
    150
  )

  /* ---------------------------------------------------------- properties -- */

  const properties: Entity[] = []

  /*
    Twelve of the matched properties are left stale on purpose: an out-of-date
    assessed value, a missing zoning district, an acreage that never got
    updated. Those are the rows the import's Match step shows a diff for.
  */
  const staleIndexes = new Set([2, 5, 9, 13, 17, 21, 24, 28, 31, 34, 36, 39])

  for (let index = 0; index < MATCHED_PARCEL_COUNT; index += 1) {
    const parcel = at(PARCELS, index)
    const stale = staleIndexes.has(index)
    const propertyUse = pick(PROPERTY_USES)

    const data: Record<string, unknown> = {
      pin: parcel.pin,
      lotNumber: `L-${String(index + 1).padStart(3, '0')}`,
      situsAddress: parcel.situsAddress,
      // Zoning is the regulatory district. Property use is what is there.
      zoning: stale && index % 3 === 0 ? null : parcel.zoningDistrict,
      propertyUse,
      acreage: stale ? Number((parcel.acreage - 0.02).toFixed(3)) : parcel.acreage,
      propertyUseCode: parcel.propertyUseCode,
      // Georgia assesses at 40% of fair market value, so the two move together.
      fairMarketValue: stale ? Math.round(parcel.fairMarketValue * 0.91) : parcel.fairMarketValue,
      assessedValue: stale
        ? Math.round(parcel.totalAssessment * 0.91)
        : parcel.totalAssessment,
      parcelUpdatedAt: stale ? null : parcel.dateUpdated,
      parcelSource: 'imported',
      yearBuilt: intBetween(1908, 1968),
      squareFeet: intBetween(1180, 4200),
      notes: '',
    }

    properties.push(
      entity(
        `ent-prop-${String(index + 1).padStart(3, '0')}`,
        'property',
        parcel.situsAddress,
        data,
        intBetween(320, 900),
        intBetween(3, 300)
      )
    )
  }

  /*
    Eight properties that were entered by hand and never reconciled against
    parcel data. Three have no PIN at all, which is one of the Needs Attention
    sources.
  */
  const MANUAL_PROPERTIES: { address: string; pin: string | null }[] = [
    { address: '415 E 49th St', pin: '21884 40219' },
    { address: '2 Dixon Park', pin: null },
    { address: '1802 Atlantic Ave', pin: '20714B33902' },
    { address: '9 Chatham Cres', pin: null },
    { address: '634 E 51st St', pin: '23301 77140' },
    { address: '1140 E Victory Dr', pin: null },
    { address: '318 Kinzie Ave', pin: '22960 51883' },
    { address: '1055 Habersham St', pin: '10442D60117' },
  ]

  MANUAL_PROPERTIES.forEach((manual, offset) => {
    const index = MATCHED_PARCEL_COUNT + offset
    properties.push(
      entity(
        `ent-prop-${String(index + 1).padStart(3, '0')}`,
        'property',
        manual.address,
        {
          pin: manual.pin,
          lotNumber: `L-${String(index + 1).padStart(3, '0')}`,
          situsAddress: manual.address,
          zoning: manual.pin ? pick(['RSF-6', 'RSF-5', 'TN-2', 'TC-1']) : null,
          propertyUse: pick(PROPERTY_USES),
          propertyUseCode: null,
          acreage: manual.pin ? Number(between(0.09, 0.4).toFixed(3)) : null,
          fairMarketValue: manual.pin ? Math.round(between(190000, 640000) / 500) * 500 : null,
          assessedValue: manual.pin ? Math.round(between(76000, 256000) / 500) * 500 : null,
          parcelUpdatedAt: null,
          parcelSource: 'manual',
          yearBuilt: intBetween(1912, 1972),
          squareFeet: intBetween(1100, 3800),
          notes: manual.pin ? '' : 'Lot number confirmed from the 1994 plat. PIN still to be looked up.',
        },
        intBetween(200, 700),
        intBetween(5, 190)
      )
    )
  })

  /*
    Everything above is a lot the association actually tracks: the 40 reconciled
    against the parcel roll and the 8 entered by hand. That membership is what
    the dashboard reports on, so it is recorded as a member_of relation to the
    association rather than as a field, which is the same shape CLAUDE.md uses
    for board seats. Adding a lot to the association is then one relation, and
    it shows up in the Connection Map for free.
  */
  const associationProperties = [...properties]

  associationProperties.forEach((property, index) => {
    // relation() appends to `relations` itself, so this must not push again.
    relation(
      `rel-hoa-member-${String(index + 1).padStart(4, '0')}`,
      'rt-member-of',
      property.id,
      hoa.id,
      { attributes: { role: 'member' }, createdDaysAgo: 300 }
    )
  })

  /* -------------------------------------------------------------- people -- */

  const people: Entity[] = []
  const businesses: Entity[] = []

  /** Owner name from the fixture to the entity that represents them. */
  const ownerEntityByParcelIndex = new Map<number, Entity>()

  /*
    Owners for the first 28 matched parcels exist in the system already, so the
    import can link them. Owners for parcels 28 to 39 do not, so the import has
    people and businesses to create as well as link.
  */
  const SEEDED_OWNER_COUNT = 28
  const seenOwnerNames = new Map<string, Entity>()

  for (let index = 0; index < SEEDED_OWNER_COUNT; index += 1) {
    const parcel = at(PARCELS, index)
    // The demo owners are parsed from the real county strings by the same code
    // the import uses, so the seeded data and the import agree by construction.
    const parsed = parseOwner(parcel.ownerName, parcel.ownerName2)
    const kind = parsed.kind
    const displayName = parsed.display

    const existing = seenOwnerNames.get(displayName)
    if (existing) {
      ownerEntityByParcelIndex.set(index, existing)
      continue
    }

    if (kind === 'business') {
      const row = entity(
        `ent-biz-owner-${String(index + 1).padStart(3, '0')}`,
        'business',
        displayName,
        {
          businessCategory: 'property_owner',
          stateFilingNumber: `K${intBetween(100000, 999999)}`,
          mailingAddress: formatMailingAddress(parcel.ownerMailingAddress),
          phone: null,
          email: null,
          contactName: null,
          notes: 'Owner of record on the parcel roll.',
        },
        intBetween(200, 800),
        intBetween(10, 190)
      )
      businesses.push(row)
      seenOwnerNames.set(displayName, row)
      ownerEntityByParcelIndex.set(index, row)
      continue
    }

    // A handful of residents have neither an email nor a phone on file, which
    // is one of the Needs Attention sources.
    const contactable = random() > 0.14
    const slug = displayName.toLowerCase().replace(/[^a-z]+/g, '.')

    const row = entity(
      `ent-person-owner-${String(index + 1).padStart(3, '0')}`,
      'person',
      displayName,
      {
        email: contactable ? `${slug}@example.com` : null,
        phone: contactable ? `912-555-${String(intBetween(100, 999)).padStart(4, '0')}` : null,
        mailingAddress: formatMailingAddress(parcel.ownerMailingAddress),
        memberSince: intBetween(1998, 2025),
        householdRole: 'owner',
        notes: '',
      },
      intBetween(200, 900),
      intBetween(4, 190)
    )
    people.push(row)
    seenOwnerNames.set(displayName, row)
    ownerEntityByParcelIndex.set(index, row)
  }

  /*
    Renters and other household members. These have no ownership relation, so
    they are what makes owner-occupied a real percentage rather than 100.
  */
  const TENANTS = [
    'Priya Raghunathan',
    'Curtis Bellamy',
    'Simone Whitfield',
    'Andre Cordray',
    'Naomi Threadgill',
    'Elias Marchetti',
    'Roberta Sallis',
    'Vincent Aldridge',
    'Frances Hedgepeth',
    'Malcolm Ravenel',
    'Delia Bostwick',
    'Junie Tandy',
  ]

  TENANTS.forEach((name, offset) => {
    const contactable = random() > 0.2
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.')
    people.push(
      entity(
        `ent-person-tenant-${String(offset + 1).padStart(3, '0')}`,
        'person',
        name,
        {
          email: contactable ? `${slug}@example.com` : null,
          phone: contactable ? `912-555-${String(intBetween(100, 999)).padStart(4, '0')}` : null,
          mailingAddress: null,
          memberSince: intBetween(2018, 2026),
          householdRole: 'resident',
          notes: '',
        },
        intBetween(60, 620),
        intBetween(2, 60)
      )
    )
  })

  /* Board members, named so the board panel reads like a real roster. */
  const BOARD: { name: string; position: string; association: Entity; termEndsInDays: number }[] = [
    { name: 'Marguerite Hollis', position: 'president', association: hoa, termEndsInDays: 154 },
    { name: 'Daniel Okonkwo', position: 'treasurer', association: hoa, termEndsInDays: 62 },
    { name: 'Teresa Vaughn', position: 'vice president', association: hoa, termEndsInDays: 154 },
    { name: 'Gerald Pinckney', position: 'secretary', association: hoa, termEndsInDays: 41 },
    { name: 'Lorraine Kowalski', position: 'member', association: hoa, termEndsInDays: 519 },
    { name: 'Nathaniel Ashby', position: 'chair', association: archCommittee, termEndsInDays: 78 },
    { name: 'Constance Barrow', position: 'member', association: archCommittee, termEndsInDays: 443 },
    { name: 'Yolanda Ferrell', position: 'member', association: archCommittee, termEndsInDays: 443 },
    { name: 'Otis Brantley', position: 'chair', association: landscapeCommittee, termEndsInDays: 260 },
    { name: 'Estelle Nesmith', position: 'member', association: landscapeCommittee, termEndsInDays: 88 },
  ]

  const boardEntities = BOARD.map((seat, offset) => {
    const slug = seat.name.toLowerCase().replace(/[^a-z]+/g, '.')
    return entity(
      `ent-person-board-${String(offset + 1).padStart(2, '0')}`,
      'person',
      seat.name,
      {
        email: `${slug}@example.com`,
        phone: `912-555-0${String(intBetween(100, 999))}`,
        mailingAddress: null,
        memberSince: intBetween(1999, 2020),
        householdRole: 'owner',
        notes: offset === 1 ? 'Also employed by a current vendor. Flagged for recusal.' : '',
      },
      intBetween(700, 2000),
      intBetween(2, 120)
    )
  })

  people.push(...boardEntities)

  /* ---------------------------------------------------------- businesses -- */

  /*
    Vendor offices carry fixed addresses rather than generated ones, so the
    geocoding fixture can hold a real lookup table keyed on them. Two are
    inside the platted area and the rest are elsewhere in Savannah, which is
    what makes "resolved but off the plat" a state worth handling.
  */
  const VENDORS: {
    name: string
    category: string
    contractEndsInDays: number
    insuranceExpiresInDays: number
    contractValue: number
    mailingAddress: string
  }[] = [
    {
      name: 'Tidewater Landscaping LLC',
      mailingAddress: '2412 Waters Ave, Savannah, GA 31404',
      category: 'grounds_maintenance',
      contractEndsInDays: 47,
      insuranceExpiresInDays: 33,
      contractValue: 48000,
    },
    {
      name: 'Coastal Empire Pest Control Inc',
      mailingAddress: '118 Skidaway Rd, Savannah, GA 31404',
      category: 'pest_control',
      contractEndsInDays: 212,
      insuranceExpiresInDays: 198,
      contractValue: 9600,
    },
    {
      name: 'Bull Street Property Management LLC',
      mailingAddress: '1810 Bull St, Savannah, GA 31401',
      category: 'property_management',
      contractEndsInDays: 331,
      insuranceExpiresInDays: 51,
      contractValue: 62400,
    },
    {
      name: 'Habersham Tree Surgeons LLC',
      mailingAddress: '3305 Habersham St, Savannah, GA 31405',
      category: 'arborist',
      contractEndsInDays: 74,
      insuranceExpiresInDays: 289,
      contractValue: 21500,
    },
    {
      name: 'Savannah Gate and Fence Co',
      mailingAddress: '715 W Bay St, Savannah, GA 31401',
      category: 'general_contractor',
      contractEndsInDays: 605,
      insuranceExpiresInDays: 412,
      contractValue: 15750,
    },
    {
      name: 'Lowcountry Accounting Partners LP',
      mailingAddress: '240 E Victory Dr, Savannah, GA 31405',
      category: 'accounting',
      contractEndsInDays: 19,
      insuranceExpiresInDays: 640,
      contractValue: 11200,
    },
    {
      name: 'Marsh View Insurance Group Inc',
      mailingAddress: '6605 Abercorn St, Savannah, GA 31405',
      category: 'insurance',
      contractEndsInDays: 486,
      insuranceExpiresInDays: 486,
      contractValue: 38900,
    },
  ]

  const vendorEntities = VENDORS.map((vendor, offset) =>
    entity(
      `ent-biz-vendor-${String(offset + 1).padStart(2, '0')}`,
      'business',
      vendor.name,
      {
        businessCategory: vendor.category,
        stateFilingNumber: `K${intBetween(100000, 999999)}`,
        phone: `912-555-0${String(intBetween(100, 999))}`,
        email: `office@${vendor.name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`,
        contactName: pick([
          'Ray Guthrie',
          'Bernadette Ulmer',
          'Clyde Waverly',
          'Alice Rutledge',
          'Marcus Delacroix',
        ]),
        mailingAddress: vendor.mailingAddress,
        notes: '',
      },
      intBetween(400, 1400),
      intBetween(3, 200)
    )
  )

  businesses.push(...vendorEntities)

  /* -------------------------------------------------------------- assets -- */

  const ASSETS: { name: string; condition: string; inspectedDaysAgo: number }[] = [
    { name: 'Baldwin Park Playground Equipment', condition: 'fair', inspectedDaysAgo: 104 },
    { name: 'Washington Avenue Median Irrigation', condition: 'good', inspectedDaysAgo: 38 },
    { name: 'Chatham Crescent Entry Monument', condition: 'poor', inspectedDaysAgo: 402 },
    { name: 'Live Oak Canopy, Bull Street Frontage', condition: 'good', inspectedDaysAgo: 71 },
    { name: 'Community Bulletin Kiosk', condition: 'fair', inspectedDaysAgo: 220 },
    { name: 'Dixon Park Benches, Set of Six', condition: 'good', inspectedDaysAgo: 55 },
    { name: 'Storm Drain Grates, E 49th Street', condition: 'fair', inspectedDaysAgo: 143 },
    { name: 'Association Storage Shed', condition: 'poor', inspectedDaysAgo: 318 },
  ]

  const assetEntities = ASSETS.map((asset, offset) =>
    entity(
      `ent-asset-${String(offset + 1).padStart(2, '0')}`,
      'asset',
      asset.name,
      {
        assetTag: `AST-${String(offset + 1).padStart(3, '0')}`,
        condition: asset.condition,
        lastInspected: date(-asset.inspectedDaysAgo),
        replacementCost: Math.round(between(1800, 46000) / 100) * 100,
        notes: '',
      },
      intBetween(400, 1500),
      asset.inspectedDaysAgo
    )
  )

  /* ----------------------------------------------------------- documents -- */

  const DOCUMENTS: { name: string; documentType: string; effectiveYear: number }[] = [
    { name: 'Declaration of Covenants, 1994 Restatement', documentType: 'covenants', effectiveYear: 1994 },
    { name: 'Bylaws, Amended 2019', documentType: 'bylaws', effectiveYear: 2019 },
    { name: 'Architectural Guidelines, Revision 4', documentType: 'guidelines', effectiveYear: 2023 },
    { name: 'Reserve Study, 2024', documentType: 'study', effectiveYear: 2024 },
    { name: 'Ardsley Park Plat, Sheet 2 of 5', documentType: 'plat', effectiveYear: 1911 },
    { name: 'Master Insurance Policy, 2026 Term', documentType: 'policy', effectiveYear: 2026 },
  ]

  const documentEntities = DOCUMENTS.map((doc, offset) =>
    entity(
      `ent-doc-${String(offset + 1).padStart(2, '0')}`,
      'document',
      doc.name,
      {
        documentType: doc.documentType,
        effectiveDate: `${doc.effectiveYear}-06-01`,
        pageCount: intBetween(4, 88),
        notes: '',
      },
      intBetween(300, 1400),
      intBetween(20, 280)
    )
  )

  /* ------------------------------------------------------------- records -- */

  const RECORDS: {
    title: string
    recordType: (typeof RECORD_TYPES)[number]
    status: 'open' | 'in_review' | 'closed'
    openedDaysAgo: number
    followUpInDays: number | null
    propertyIndex: number | null
  }[] = [
    {
      title: 'Fence height exceeds guideline, 1147 E 46th St',
      recordType: 'covenant_violation',
      status: 'open',
      openedDaysAgo: 96,
      followUpInDays: -34,
      propertyIndex: 0,
    },
    {
      title: 'Rear addition, architectural review',
      recordType: 'architectural_request',
      status: 'in_review',
      openedDaysAgo: 41,
      followUpInDays: -6,
      propertyIndex: 3,
    },
    {
      title: 'Median irrigation line break',
      recordType: 'maintenance_request',
      status: 'open',
      openedDaysAgo: 22,
      followUpInDays: 9,
      propertyIndex: null,
    },
    {
      title: 'Short-term rental complaint, Habersham St',
      recordType: 'complaint',
      status: 'open',
      openedDaysAgo: 61,
      followUpInDays: -18,
      propertyIndex: 7,
    },
    {
      title: 'Board Meeting, minutes',
      recordType: 'meeting_minutes',
      status: 'closed',
      openedDaysAgo: 19,
      followUpInDays: null,
      propertyIndex: null,
    },
    {
      title: 'Board Meeting, minutes',
      recordType: 'meeting_minutes',
      status: 'closed',
      openedDaysAgo: 50,
      followUpInDays: null,
      propertyIndex: null,
    },
    {
      title: 'Annual assessment, 2026 cycle',
      recordType: 'assessment',
      status: 'in_review',
      openedDaysAgo: 78,
      followUpInDays: 21,
      propertyIndex: null,
    },
    {
      title: 'Paint color approval, Atlantic Ave',
      recordType: 'architectural_request',
      status: 'closed',
      openedDaysAgo: 133,
      followUpInDays: null,
      propertyIndex: 11,
    },
    {
      title: 'Tree limb over sidewalk, E 50th St',
      recordType: 'maintenance_request',
      status: 'open',
      openedDaysAgo: 14,
      followUpInDays: 4,
      propertyIndex: 15,
    },
    {
      title: 'Trash bin storage violation',
      recordType: 'covenant_violation',
      status: 'open',
      openedDaysAgo: 202,
      followUpInDays: -101,
      propertyIndex: 19,
    },
    {
      title: 'Driveway apron replacement request',
      recordType: 'architectural_request',
      status: 'closed',
      openedDaysAgo: 244,
      followUpInDays: null,
      propertyIndex: 23,
    },
    {
      title: 'Parking obstruction, Chatham Cres',
      recordType: 'complaint',
      status: 'in_review',
      openedDaysAgo: 33,
      followUpInDays: 12,
      propertyIndex: 27,
    },
    {
      title: 'Playground surface inspection follow-up',
      recordType: 'maintenance_request',
      status: 'open',
      openedDaysAgo: 88,
      followUpInDays: -12,
      propertyIndex: null,
    },
    {
      title: 'Special assessment, entry monument repair',
      recordType: 'assessment',
      status: 'open',
      openedDaysAgo: 11,
      followUpInDays: 30,
      propertyIndex: null,
    },
    {
      title: 'Board Meeting, minutes',
      recordType: 'meeting_minutes',
      status: 'closed',
      openedDaysAgo: 81,
      followUpInDays: null,
      propertyIndex: null,
    },
    {
      title: 'Unpermitted shed, rear lot',
      recordType: 'covenant_violation',
      status: 'in_review',
      openedDaysAgo: 57,
      followUpInDays: 8,
      propertyIndex: 31,
    },
  ]

  const recordEntities = RECORDS.map((rec, offset) =>
    entity(
      `ent-record-${String(offset + 1).padStart(3, '0')}`,
      'record',
      rec.title,
      {
        recordNumber: `R-2026-${String(offset + 1).padStart(3, '0')}`,
        recordType: rec.recordType,
        status: rec.status,
        occurredOn: date(-rec.openedDaysAgo),
        followUpDate: rec.followUpInDays === null ? null : date(rec.followUpInDays),
        propertyId:
          rec.propertyIndex === null ? null : at(properties, rec.propertyIndex).id,
        summary: '',
        notes: '',
      },
      rec.openedDaysAgo,
      Math.max(0, rec.openedDaysAgo - intBetween(0, 12))
    )
  )

  /* ----------------------------------------------------------- relations -- */

  let relationSeq = 0
  // Namespaced so a seeded id can never collide with one the provider mints.
  const nextRelationId = () => `rel-seed-${String((relationSeq += 1)).padStart(4, '0')}`

  // Ownership, for every property whose owner is already in the system.
  for (const [parcelIndex, owner] of ownerEntityByParcelIndex) {
    const property = at(properties, parcelIndex)
    relation(nextRelationId(), 'rt-owns', owner.id, property.id, {
      startDate: date(-intBetween(400, 5200)),
      attributes: { deedType: pick(['warranty', 'quitclaim', 'limited warranty']) },
      createdDaysAgo: intBetween(200, 800),
    })
  }

  /*
    Properties 28 to 47 have no owner on file. Twenty is a lot, and that is the
    point: "Properties with no current owner relation" needs to be a live
    Needs Attention item, not an empty one.
  */

  // A prior owner whose interest ended, so the Connections tab has history.
  const priorOwner = entity(
    'ent-person-prior-owner',
    'person',
    'Wallace Fenn',
    {
      email: null,
      phone: null,
      mailingAddress: null,
      memberSince: 2011,
      householdRole: 'former_owner',
      notes: 'Prior owner of the E 46th Street lot. Sold this spring.',
    },
    2100,
    120,
    { archivedAt: stamp(-120, 11) }
  )

  relation(nextRelationId(), 'rt-owns', priorOwner.id, at(properties, 0).id, {
    startDate: date(-4800),
    endDate: date(-120),
    attributes: { deedType: 'warranty' },
    createdDaysAgo: 4800,
  })

  // Residency. Most owners live in the lot they own, which drives owner-occupied.
  for (const [parcelIndex, owner] of ownerEntityByParcelIndex) {
    if (owner.type !== 'person') continue
    // Roughly four in five owners are owner-occupants.
    if (random() > 0.8) continue
    relation(nextRelationId(), 'rt-resides-at', owner.id, at(properties, parcelIndex).id, {
      startDate: date(-intBetween(300, 5000)),
      attributes: { occupancy: 'owner_occupied' },
      createdDaysAgo: intBetween(200, 700),
    })
  }

  // Tenants live in lots they do not own: long-term and short-term rentals.
  const tenantEntities = people.filter((person) => person.id.startsWith('ent-person-tenant-'))
  tenantEntities.forEach((tenant, offset) => {
    const property = at(properties, 4 + offset * 3)
    const shortTerm = offset % 5 === 0
    relation(nextRelationId(), 'rt-resides-at', tenant.id, property.id, {
      startDate: date(-intBetween(40, 1400)),
      attributes: { occupancy: shortTerm ? 'short_term_rental' : 'long_term_rental' },
      createdDaysAgo: intBetween(30, 500),
    })
  })

  // Board members reside in the neighbourhood too, and own their lots.
  boardEntities.forEach((member, offset) => {
    const property = at(properties, 2 + offset * 4)
    relation(nextRelationId(), 'rt-resides-at', member.id, property.id, {
      startDate: date(-intBetween(900, 6000)),
      attributes: { occupancy: 'owner_occupied' },
      createdDaysAgo: intBetween(300, 900),
    })
    relation(nextRelationId(), 'rt-owns', member.id, property.id, {
      startDate: date(-intBetween(900, 6000)),
      attributes: { deedType: 'warranty' },
      createdDaysAgo: intBetween(300, 900),
    })
  })

  // Board and committee membership: member_of with role and position, plus terms.
  BOARD.forEach((seat, offset) => {
    const member = at(boardEntities, offset)
    relation(nextRelationId(), 'rt-member-of', member.id, seat.association.id, {
      startDate: date(-intBetween(400, 900)),
      endDate: date(seat.termEndsInDays),
      attributes: { role: 'board', position: seat.position },
      createdDaysAgo: intBetween(400, 900),
    })
  })

  // An expired term, so the Connections tab shows a historical membership.
  relation(nextRelationId(), 'rt-member-of', priorOwner.id, hoa.id, {
    startDate: date(-1700),
    endDate: date(-240),
    attributes: { role: 'board', position: 'secretary' },
    createdDaysAgo: 1700,
  })

  // Vendors, with the contract and insurance dates Needs Attention reads.
  VENDORS.forEach((vendor, offset) => {
    const business = at(vendorEntities, offset)
    relation(nextRelationId(), 'rt-vendor-for', business.id, hoa.id, {
      startDate: date(-intBetween(200, 1100)),
      endDate: date(vendor.contractEndsInDays),
      attributes: {
        contractValue: vendor.contractValue,
        contractEndDate: date(vendor.contractEndsInDays),
        insuranceExpiresOn: date(vendor.insuranceExpiresInDays),
        scope: vendor.category,
      },
      createdDaysAgo: intBetween(200, 1100),
    })
  })

  // The treasurer works for the landscaping vendor. This is the shape a
  // conflict-of-interest check looks for, and it is why the map matters.
  relation(nextRelationId(), 'rt-employed-by', at(boardEntities, 1).id, at(vendorEntities, 0).id, {
    startDate: date(-1180),
    attributes: { title: 'Operations Manager' },
    createdDaysAgo: 1180,
  })

  relation(nextRelationId(), 'rt-employed-by', at(boardEntities, 4).id, at(vendorEntities, 5).id, {
    startDate: date(-700),
    attributes: { title: 'Staff Accountant' },
    createdDaysAgo: 700,
  })

  // The management company manages the association and a block of lots.
  const manager = at(vendorEntities, 2)
  relation(nextRelationId(), 'rt-manages', manager.id, hoa.id, {
    startDate: date(-980),
    attributes: { scope: 'full service' },
    createdDaysAgo: 980,
  })
  for (let offset = 0; offset < 6; offset += 1) {
    relation(nextRelationId(), 'rt-manages', manager.id, at(properties, 30 + offset).id, {
      startDate: date(-intBetween(120, 800)),
      attributes: { scope: 'rental management' },
      createdDaysAgo: intBetween(120, 800),
    })
  }

  // The association governs its lots. A sample, not all 48, so the map stays legible.
  for (let offset = 0; offset < 12; offset += 1) {
    relation(nextRelationId(), 'rt-governs', hoa.id, at(properties, offset).id, {
      startDate: date(-2200),
      createdDaysAgo: 2200,
      attributes: { instrument: 'Declaration of Covenants' },
    })
  }

  // Adjacency, walking the street in order.
  for (let offset = 0; offset < 16; offset += 2) {
    relation(nextRelationId(), 'rt-adjacent-to', at(properties, offset).id, at(properties, offset + 1).id, {
      createdDaysAgo: 900,
      attributes: { boundary: 'shared side lot line' },
    })
  }

  // Households.
  const relatedPairs: [number, number][] = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
  ]
  for (const [left, right] of relatedPairs) {
    relation(nextRelationId(), 'rt-related-to', at(tenantEntities, left).id, at(tenantEntities, right).id, {
      attributes: { relationship: 'household' },
      createdDaysAgo: intBetween(100, 600),
    })
  }

  // Records reference the documents they were decided under.
  recordEntities.forEach((rec, offset) => {
    if (offset % 3 !== 0) return
    relation(nextRelationId(), 'rt-references', rec.id, at(documentEntities, offset % 6).id, {
      createdDaysAgo: intBetween(10, 240),
      attributes: { article: `Article ${intBetween(3, 11)}` },
    })
  })

  // Assets belong to the association, and one is tied to a lot.
  assetEntities.forEach((asset, offset) => {
    relation(nextRelationId(), 'rt-owns', hoa.id, asset.id, {
      startDate: date(-intBetween(400, 3000)),
      createdDaysAgo: intBetween(400, 1400),
      attributes: {},
    })
    if (offset === 0) {
      relation(nextRelationId(), 'rt-adjacent-to', asset.id, at(properties, 12).id, {
        createdDaysAgo: 800,
        attributes: { boundary: 'park frontage' },
      })
    }
  })

  // Committees sit under the association.
  relation(nextRelationId(), 'rt-member-of', archCommittee.id, hoa.id, {
    startDate: date(-900),
    createdDaysAgo: 900,
    attributes: { role: 'standing committee' },
  })
  relation(nextRelationId(), 'rt-member-of', landscapeCommittee.id, hoa.id, {
    startDate: date(-720),
    createdDaysAgo: 720,
    attributes: { role: 'standing committee' },
  })

  /* --------------------------------------------------------------- audit -- */

  const ACTORS = [
    'Marguerite Hollis',
    'Daniel Okonkwo',
    'Teresa Vaughn',
    'Gerald Pinckney',
    'Bull Street Property Management',
  ]

  // Creation rows for a slice of the entities, spread over the past year.
  for (const row of [...properties.slice(0, 18), ...people.slice(0, 14), ...vendorEntities]) {
    const daysAgo = intBetween(20, 340)
    audit('entities', row.id, 'insert', null, null, null, pick(ACTORS), daysAgo, intBetween(8, 17))
  }

  // Field-level updates, which is what makes the History tab a diff.
  const UPDATE_SEEDS: {
    recordId: string
    field: string
    from: string | null
    to: string | null
    daysAgo: number
  }[] = [
    {
      recordId: at(properties, 7).id,
      field: 'data.propertyUse',
      from: 'single_family',
      to: 'commercial',
      daysAgo: 3,
    },
    {
      recordId: at(properties, 7).id,
      field: 'data.notes',
      from: null,
      to: 'Commercial use inside a residential district. Referred to the city.',
      daysAgo: 3,
    },
    {
      recordId: at(properties, 2).id,
      field: 'data.assessedValue',
      from: '412000',
      to: '448500',
      daysAgo: 6,
    },
    {
      recordId: at(boardEntities, 1).id,
      field: 'data.phone',
      from: '912-555-0188',
      to: '912-555-0231',
      daysAgo: 1,
    },
    {
      recordId: at(assetEntities, 2).id,
      field: 'data.condition',
      from: 'fair',
      to: 'poor',
      daysAgo: 2,
    },
    {
      recordId: at(recordEntities, 1).id,
      field: 'data.status',
      from: 'open',
      to: 'in_review',
      daysAgo: 4,
    },
    {
      recordId: at(vendorEntities, 0).id,
      field: 'data.contactName',
      from: 'Bernadette Ulmer',
      to: 'Ray Guthrie',
      daysAgo: 8,
    },
    {
      recordId: at(properties, 13).id,
      field: 'data.zoning',
      from: 'R-6',
      to: 'R-B',
      daysAgo: 11,
    },
    {
      recordId: at(properties, 21).id,
      field: 'name',
      from: '1120 Abercorn Street',
      to: at(properties, 21).name,
      daysAgo: 15,
    },
    {
      recordId: at(recordEntities, 9).id,
      field: 'data.followUpDate',
      from: date(-140),
      to: date(-101),
      daysAgo: 19,
    },
    {
      recordId: at(documentEntities, 2).id,
      field: 'data.effectiveDate',
      from: '2021-06-01',
      to: '2023-06-01',
      daysAgo: 26,
    },
    {
      recordId: at(assetEntities, 0).id,
      field: 'data.lastInspected',
      from: date(-470),
      to: date(-104),
      daysAgo: 33,
    },
  ]

  for (const seed of UPDATE_SEEDS) {
    audit(
      'entities',
      seed.recordId,
      'update',
      seed.field,
      seed.from,
      seed.to,
      pick(ACTORS),
      seed.daysAgo,
      intBetween(8, 18)
    )
  }

  // "Unit 42 changed hands" is the highest-value entry in the log, so
  // relation changes are audited too.
  audit(
    'relations',
    at(relations, 0).id,
    'update',
    'endDate',
    null,
    date(-120),
    'Marguerite Hollis',
    5,
    14
  )
  audit('relations', at(relations, 1).id, 'insert', null, null, null, 'Marguerite Hollis', 5, 14)
  audit(
    'entities',
    priorOwner.id,
    'update',
    'archivedAt',
    null,
    stamp(-120, 11),
    'Marguerite Hollis',
    5,
    14
  )

  /* ---------------------------------------------------------- reference -- */

  const referenceItems: ReferenceItem[] = []
  let referenceSeq = 0

  function referenceItem(
    list: ReferenceItem['list'],
    value: string,
    label: string,
    active = true
  ): void {
    referenceSeq += 1
    referenceItems.push({
      id: `ref-${String(referenceSeq).padStart(3, '0')}`,
      orgId: ORG_ID,
      list,
      value,
      label,
      sortOrder: referenceItems.filter((item) => item.list === list).length,
      active,
    })
  }

  /*
    Real codes from the zoning layer at
    Savannah/ZoningDevelopment_Map/MapServer/6. The invented fixture carried an
    R-6 and R-B format that appears nowhere in the real column, so a real zoning
    value matched nothing in this list.

    This is a convenience list for readable labels and the filter, not a closed
    set. The layer holds 285 distinct codes, mixing post-NewZO city codes with
    older county ones, so an unmapped code renders literally rather than being
    forced into this list. See docs/SAGIS-API.md.
  */
  referenceItem('zoning', 'RSF-5', 'RSF-5, Residential single-family, 5')
  referenceItem('zoning', 'RSF-6', 'RSF-6, Residential single-family, 6')
  referenceItem('zoning', 'RSF-A', 'RSF-A, Residential single-family, attached')
  referenceItem('zoning', 'RMF-10', 'RMF-10, Residential multi-family, 10')
  referenceItem('zoning', 'TN-1', 'TN-1, Traditional neighborhood, 1')
  referenceItem('zoning', 'TN-2', 'TN-2, Traditional neighborhood, 2')
  referenceItem('zoning', 'TR-1', 'TR-1, Traditional residential, 1')
  referenceItem('zoning', 'TC-1', 'TC-1, Traditional commercial, 1')
  referenceItem('zoning', 'B-C', 'B-C, Community business')
  // Older county codes, which is what unincorporated land carries.
  referenceItem('zoning', 'R-1', 'R-1, One family residential')
  referenceItem('zoning', 'R-A', 'R-A, Residential agricultural')
  referenceItem('zoning', 'A-1', 'A-1, Agricultural')
  referenceItem('zoning', 'PUD', 'PUD, Planned unit development')
  referenceItem('zoning', 'P-B', 'P-B, Planned business', false)

  referenceItem('property_use', 'single_family', 'Single family')
  referenceItem('property_use', 'duplex', 'Duplex')
  referenceItem('property_use', 'townhouse', 'Townhouse')
  referenceItem('property_use', 'multi_family', 'Multi family')
  referenceItem('property_use', 'commercial', 'Commercial')
  referenceItem('property_use', 'institutional', 'Institutional')
  referenceItem('property_use', 'vacant_lot', 'Vacant lot')

  referenceItem('association_type', 'hoa', 'Homeowners association')
  referenceItem('association_type', 'committee', 'Committee')
  referenceItem('association_type', 'civic_club', 'Civic club')
  referenceItem('association_type', 'poa', 'Property owners association')

  referenceItem('record_type', 'covenant_violation', 'Covenant violation')
  referenceItem('record_type', 'architectural_request', 'Architectural request')
  referenceItem('record_type', 'maintenance_request', 'Maintenance request')
  referenceItem('record_type', 'complaint', 'Complaint')
  referenceItem('record_type', 'meeting_minutes', 'Meeting minutes')
  referenceItem('record_type', 'assessment', 'Assessment')
  referenceItem('record_type', 'correspondence', 'Correspondence', false)

  /* -------------------------------------------------------------- users -- */

  const users: OrgUser[] = [
    {
      id: 'usr-1',
      orgId: ORG_ID,
      name: 'Marguerite Hollis',
      email: 'm.hollis@example.com',
      role: 'admin',
      lastActiveAt: stamp(0, 9),
    },
    {
      id: 'usr-2',
      orgId: ORG_ID,
      name: 'Bull Street Property Management',
      email: 'office@bullstreetpm.example.com',
      role: 'manager',
      lastActiveAt: stamp(-1, 16),
    },
    {
      id: 'usr-3',
      orgId: ORG_ID,
      name: 'Daniel Okonkwo',
      email: 'd.okonkwo@example.com',
      role: 'board',
      lastActiveAt: stamp(-4, 20),
    },
    {
      id: 'usr-4',
      orgId: ORG_ID,
      name: 'Teresa Vaughn',
      email: 't.vaughn@example.com',
      role: 'board',
      lastActiveAt: stamp(-12, 11),
    },
    {
      id: 'usr-5',
      orgId: ORG_ID,
      name: 'Gerald Pinckney',
      email: 'g.pinckney@example.com',
      role: 'board',
      lastActiveAt: null,
    },
    {
      id: 'usr-6',
      orgId: ORG_ID,
      name: 'Priya Raghunathan',
      email: 'p.raghunathan@example.com',
      role: 'resident',
      lastActiveAt: stamp(-30, 19),
    },
  ]

  /*
    The harvested county parcels are appended right at the end, deliberately.

    `at()` wraps with modulo, so every fixed index into `properties` above, and
    there are a dozen of them, silently addresses a different lot the moment the
    array grows from 48 to 10,447. Adding these earlier re-pointed residents and
    managers at county parcels and moved the occupancy figures, which is a good
    demonstration of why the association's own data is built first and in
    isolation.
  */
  /*
    The harvested parcel layer, which is every lot between MLK Jr Blvd and
    E Broad Street from the river down to DeRenne. These are county records, not
    association members: they carry no member_of relation, so they are listed
    and searchable and mappable without changing what the dashboard means.

    Lots already seeded above are skipped, because the association's own record
    of a lot it manages is better than the roll's.
  */
  const seededPins = new Set(
    properties
      .map((property) => (typeof property.data.pin === 'string' ? normalizePin(property.data.pin) : ''))
      .filter((pin) => pin !== '')
  )

  parcelLayer.forEach((parcel, index) => {
    const pin = normalizePin(parcel.pin)
    if (pin === '' || seededPins.has(pin)) return
    seededPins.add(pin)

    const owner = parseOwner(parcel.ownerName, parcel.ownerName2)

    properties.push(
      entity(
        `ent-parcel-${String(index + 1).padStart(6, '0')}`,
        'property',
        // A parcel with no street number is real: 363 of them are city land.
        parcel.situsAddress === '' ? pin : parcel.situsAddress,
        {
          pin,
          lotNumber: null,
          situsAddress: parcel.situsAddress,
          zoning: parcel.zoningDistrict,
          // The county's class code. The association's own reading of the use
          // is deliberately absent: nobody has looked at this lot.
          propertyUse: null,
          propertyUseCode: parcel.propertyUseCode,
          acreage: parcel.acreage,
          fairMarketValue: parcel.fairMarketValue,
          assessedValue: parcel.totalAssessment,
          parcelUpdatedAt: parcel.dateUpdated,
          parcelSource: 'imported',
          yearBuilt: parcel.yearBuilt,
          squareFeet: null,
          neighborhood: parcel.neighborhood,
          legalDescription: parcel.legalDescription,
          // Kept so the owner is searchable without creating an entity for
          // every owner in the corridor. The parcel import is what creates
          // owner records, deliberately and one screen at a time.
          countyOwnerName: owner.display,
          countyOwnerRaw: parcel.ownerName,
          notes: '',
        },
        // Fixed ages: these are reference data, not activity, and a random age
        // would put thousands of meaningless entries in the audit feed.
        720,
        720
      )
    )
  })


  return { org, relationTypes, entities, relations, auditEntries, referenceItems, users }
}

/** The default dataset, built against today. */
export const DEMO_DATA: DemoData = buildDemoData()

export const DEMO_ORG = DEMO_DATA.org
export const DEMO_ENTITIES = DEMO_DATA.entities
export const DEMO_RELATIONS = DEMO_DATA.relations
export const DEMO_RELATION_TYPES = DEMO_DATA.relationTypes
export const DEMO_AUDIT_ENTRIES = DEMO_DATA.auditEntries
export const DEMO_REFERENCE_ITEMS = DEMO_DATA.referenceItems
export const DEMO_USERS = DEMO_DATA.users

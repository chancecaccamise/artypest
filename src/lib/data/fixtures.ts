import type { AuditEntry, Entity, Org, Relation, RelationType } from './types'

/*
  Temporary demo data. This stands in for supabase/seed.sql until the local
  Supabase stack is set up. Keep it small and realistic: it exists to make the
  UI reviewable, not to be a fixture library.

  The ten relation types below are provisional. docs/BUILD-PLAN.md defines the
  real list and is not in the repo yet. See docs/BLOCKERS.md.
*/

export const DEMO_ORG: Org = {
  id: 'org-demo',
  name: 'Ardsley Park Homeowners Association',
  sagisUrlTemplate: 'https://gis.chathamcounty.org/parcel?pin={pin}',
  createdAt: '2026-01-05T14:00:00.000Z',
}

export const DEMO_RELATION_TYPES: RelationType[] = [
  { id: 'rt-owns', orgId: DEMO_ORG.id, key: 'owns', label: 'owns', reverseLabel: 'is owned by' },
  {
    id: 'rt-resides-at',
    orgId: DEMO_ORG.id,
    key: 'resides_at',
    label: 'resides at',
    reverseLabel: 'is home to',
  },
  {
    id: 'rt-member-of',
    orgId: DEMO_ORG.id,
    key: 'member_of',
    label: 'is a member of',
    reverseLabel: 'has member',
  },
  {
    id: 'rt-manages',
    orgId: DEMO_ORG.id,
    key: 'manages',
    label: 'manages',
    reverseLabel: 'is managed by',
  },
  {
    id: 'rt-employed-by',
    orgId: DEMO_ORG.id,
    key: 'employed_by',
    label: 'is employed by',
    reverseLabel: 'employs',
  },
  {
    id: 'rt-related-to',
    orgId: DEMO_ORG.id,
    key: 'related_to',
    label: 'is related to',
    reverseLabel: 'is related to',
  },
  {
    id: 'rt-vendor-for',
    orgId: DEMO_ORG.id,
    key: 'vendor_for',
    label: 'is a vendor for',
    reverseLabel: 'uses vendor',
  },
  {
    id: 'rt-adjacent-to',
    orgId: DEMO_ORG.id,
    key: 'adjacent_to',
    label: 'is adjacent to',
    reverseLabel: 'is adjacent to',
  },
  {
    id: 'rt-governs',
    orgId: DEMO_ORG.id,
    key: 'governs',
    label: 'governs',
    reverseLabel: 'is governed by',
  },
  {
    id: 'rt-references',
    orgId: DEMO_ORG.id,
    key: 'references',
    label: 'references',
    reverseLabel: 'is referenced by',
  },
]

const base = {
  orgId: DEMO_ORG.id,
  folderId: null,
  deletedAt: null,
  archivedAt: null,
}

export const DEMO_ENTITIES: Entity[] = [
  {
    ...base,
    id: 'ent-person-hollis',
    type: 'person',
    name: 'Marguerite Hollis',
    data: {
      email: 'm.hollis@example.com',
      phone: '912-555-0142',
      notes: 'Board president, second term.',
    },
    createdAt: '2026-01-06T09:12:00.000Z',
    updatedAt: '2026-03-02T11:40:00.000Z',
  },
  {
    ...base,
    id: 'ent-person-okonkwo',
    type: 'person',
    name: 'Daniel Okonkwo',
    data: {
      email: 'd.okonkwo@example.com',
      phone: '912-555-0188',
      notes: 'Treasurer.',
    },
    createdAt: '2026-01-06T09:20:00.000Z',
    updatedAt: '2026-01-06T09:20:00.000Z',
  },
  {
    ...base,
    id: 'ent-person-vaughn',
    type: 'person',
    name: 'Teresa Vaughn',
    data: { email: 't.vaughn@example.com', phone: '912-555-0107' },
    createdAt: '2026-02-11T15:05:00.000Z',
    updatedAt: '2026-02-11T15:05:00.000Z',
  },
  {
    ...base,
    id: 'ent-property-1207-washington',
    type: 'property',
    name: '1207 E Washington Ave',
    data: {
      // PIN with a space. Leading 2 means City of Savannah.
      pin: '20032 63001',
      // Zoning is the regulatory district. Property use is what is actually there.
      zoning: 'R-6',
      propertyUse: 'single_family',
      yearBuilt: 1926,
    },
    createdAt: '2026-01-07T10:00:00.000Z',
    updatedAt: '2026-03-02T11:41:00.000Z',
  },
  {
    ...base,
    id: 'ent-property-2140-abercorn',
    type: 'property',
    name: '2140 Abercorn St',
    data: {
      // PIN with a letter in place of the space. Leading 1 means unincorporated Chatham County.
      pin: '10993C01034',
      zoning: 'R-6',
      // Commercial use inside a residential district. This is the query that matters.
      propertyUse: 'commercial',
      yearBuilt: 1948,
    },
    createdAt: '2026-01-09T13:30:00.000Z',
    updatedAt: '2026-02-20T08:15:00.000Z',
  },
  {
    ...base,
    id: 'ent-business-tidewater',
    type: 'business',
    name: 'Tidewater Landscaping LLC',
    data: {
      category: 'grounds_maintenance',
      phone: '912-555-0311',
      contactName: 'Ray Guthrie',
    },
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
  },
  {
    ...base,
    id: 'ent-association-ardsley',
    type: 'association',
    name: 'Ardsley Park Homeowners Association',
    data: { associationType: 'hoa', jurisdiction: 'City of Savannah' },
    createdAt: '2026-01-05T14:05:00.000Z',
    updatedAt: '2026-01-05T14:05:00.000Z',
  },
  {
    ...base,
    id: 'ent-asset-playground',
    type: 'asset',
    name: 'Baldwin Park Playground Equipment',
    data: { condition: 'fair', lastInspected: '2026-04-18' },
    createdAt: '2026-01-22T09:00:00.000Z',
    updatedAt: '2026-04-18T16:20:00.000Z',
  },
  {
    ...base,
    id: 'ent-document-covenants',
    type: 'document',
    name: 'Declaration of Covenants, 1994 Restatement',
    data: { documentType: 'covenants', effectiveDate: '1994-06-01' },
    createdAt: '2026-01-05T14:10:00.000Z',
    updatedAt: '2026-01-05T14:10:00.000Z',
  },
  {
    ...base,
    id: 'ent-record-march-meeting',
    type: 'record',
    name: 'Board Meeting, March 2026',
    data: { recordType: 'meeting_minutes', occurredOn: '2026-03-02' },
    createdAt: '2026-03-02T20:00:00.000Z',
    updatedAt: '2026-03-02T20:00:00.000Z',
  },
  {
    ...base,
    id: 'ent-person-prior-owner',
    type: 'person',
    name: 'Wallace Fenn',
    data: { notes: 'Prior owner of 1207 E Washington Ave. Sold in 2026.' },
    createdAt: '2026-01-06T09:30:00.000Z',
    updatedAt: '2026-03-02T11:42:00.000Z',
    archivedAt: '2026-03-02T11:42:00.000Z',
  },
]

export const DEMO_RELATIONS: Relation[] = [
  {
    id: 'rel-hollis-owns-1207',
    orgId: DEMO_ORG.id,
    relationTypeId: 'rt-owns',
    fromEntityId: 'ent-person-hollis',
    toEntityId: 'ent-property-1207-washington',
    startDate: '2026-03-01',
    endDate: null,
    attributes: { deedType: 'warranty' },
    createdAt: '2026-03-02T11:40:00.000Z',
    updatedAt: '2026-03-02T11:40:00.000Z',
    deletedAt: null,
    archivedAt: null,
  },
  {
    id: 'rel-fenn-owned-1207',
    orgId: DEMO_ORG.id,
    relationTypeId: 'rt-owns',
    fromEntityId: 'ent-person-prior-owner',
    toEntityId: 'ent-property-1207-washington',
    startDate: '2011-08-15',
    endDate: '2026-03-01',
    attributes: {},
    createdAt: '2026-01-07T10:05:00.000Z',
    updatedAt: '2026-03-02T11:42:00.000Z',
    deletedAt: null,
    archivedAt: null,
  },
  {
    // Board membership is not a separate table. It is member_of with role in attributes.
    id: 'rel-hollis-board',
    orgId: DEMO_ORG.id,
    relationTypeId: 'rt-member-of',
    fromEntityId: 'ent-person-hollis',
    toEntityId: 'ent-association-ardsley',
    startDate: '2025-01-01',
    endDate: '2026-12-31',
    attributes: { role: 'board', position: 'president' },
    createdAt: '2026-01-06T09:15:00.000Z',
    updatedAt: '2026-01-06T09:15:00.000Z',
    deletedAt: null,
    archivedAt: null,
  },
  {
    id: 'rel-okonkwo-board',
    orgId: DEMO_ORG.id,
    relationTypeId: 'rt-member-of',
    fromEntityId: 'ent-person-okonkwo',
    toEntityId: 'ent-association-ardsley',
    startDate: '2025-01-01',
    endDate: '2026-12-31',
    attributes: { role: 'board', position: 'treasurer' },
    createdAt: '2026-01-06T09:22:00.000Z',
    updatedAt: '2026-01-06T09:22:00.000Z',
    deletedAt: null,
    archivedAt: null,
  },
  {
    // Okonkwo is treasurer and also employed by the association's landscaping vendor.
    // This is the shape a conflict-of-interest check will look for later.
    id: 'rel-okonkwo-tidewater',
    orgId: DEMO_ORG.id,
    relationTypeId: 'rt-employed-by',
    fromEntityId: 'ent-person-okonkwo',
    toEntityId: 'ent-business-tidewater',
    startDate: '2023-05-01',
    endDate: null,
    attributes: { title: 'Operations Manager' },
    createdAt: '2026-01-15T12:10:00.000Z',
    updatedAt: '2026-01-15T12:10:00.000Z',
    deletedAt: null,
    archivedAt: null,
  },
  {
    id: 'rel-tidewater-vendor',
    orgId: DEMO_ORG.id,
    relationTypeId: 'rt-vendor-for',
    fromEntityId: 'ent-business-tidewater',
    toEntityId: 'ent-association-ardsley',
    startDate: '2026-01-15',
    endDate: null,
    attributes: { contractValue: 48000 },
    createdAt: '2026-01-15T12:12:00.000Z',
    updatedAt: '2026-01-15T12:12:00.000Z',
    deletedAt: null,
    archivedAt: null,
  },
  {
    id: 'rel-vaughn-resides-2140',
    orgId: DEMO_ORG.id,
    relationTypeId: 'rt-resides-at',
    fromEntityId: 'ent-person-vaughn',
    toEntityId: 'ent-property-2140-abercorn',
    startDate: '2026-02-11',
    endDate: null,
    attributes: {},
    createdAt: '2026-02-11T15:10:00.000Z',
    updatedAt: '2026-02-11T15:10:00.000Z',
    deletedAt: null,
    archivedAt: null,
  },
]

/*
  Seed history. The provider appends to this as records change, so the History
  tab has something to render before the Postgres audit triggers exist.
*/
export const DEMO_AUDIT_ENTRIES: AuditEntry[] = [
  {
    id: 'aud-0001',
    orgId: DEMO_ORG.id,
    tableName: 'entities',
    recordId: 'ent-property-1207-washington',
    action: 'insert',
    fieldName: null,
    oldValue: null,
    newValue: null,
    changedBy: 'Marguerite Hollis',
    changedAt: '2026-01-07T10:00:00.000Z',
  },
  {
    id: 'aud-0002',
    orgId: DEMO_ORG.id,
    tableName: 'entities',
    recordId: 'ent-property-2140-abercorn',
    action: 'update',
    fieldName: 'propertyUse',
    oldValue: 'single_family',
    newValue: 'commercial',
    changedBy: 'Daniel Okonkwo',
    changedAt: '2026-02-20T08:15:00.000Z',
  },
  {
    id: 'aud-0003',
    orgId: DEMO_ORG.id,
    tableName: 'relations',
    recordId: 'rel-fenn-owned-1207',
    action: 'update',
    fieldName: 'endDate',
    oldValue: null,
    newValue: '2026-03-01',
    changedBy: 'Marguerite Hollis',
    changedAt: '2026-03-02T11:42:00.000Z',
  },
  {
    id: 'aud-0004',
    orgId: DEMO_ORG.id,
    tableName: 'entities',
    recordId: 'ent-asset-playground',
    action: 'update',
    fieldName: 'condition',
    oldValue: 'good',
    newValue: 'fair',
    changedBy: 'Teresa Vaughn',
    changedAt: '2026-04-18T16:20:00.000Z',
  },
]

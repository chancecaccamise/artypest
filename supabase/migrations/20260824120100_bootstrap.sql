/*
  The org, the ten relation types, and the reference lists.

  Reference data, not demo data, which is why it is a migration and not
  supabase/seed.sql. seed.sql only runs on `supabase db reset`, and the hosted
  project is never reset: it receives migrations. Anything the application needs
  in order to function at all has to arrive the same way the schema does.

  Every insert is idempotent, so re-running this against a database that already
  has it changes nothing.

  The org id is fixed rather than generated. The application carries it while
  the in-memory provider is still in use, and a stable id means the fixtures and
  the database describe the same organisation rather than two of them.
*/

insert into orgs (id, name, sagis_url_template)
values (
  '00000000-0000-4000-a000-000000000001',
  'Ardsley Park Homeowners Association',
  'https://gis.chathamcounty.org/parcelviewer?pin={pin}'
)
on conflict (id) do nothing;

/*
  The ten. Bidirectionality is a read concern: one row is stored, and the two
  labels are what let it be read from either end. `owns` the wrong way round
  says a lot owns a person, which is why reverse_label is not optional.
*/
insert into relation_types (org_id, key, label, reverse_label)
values
  ('00000000-0000-4000-a000-000000000001', 'owns',        'owns',            'is owned by'),
  ('00000000-0000-4000-a000-000000000001', 'resides_at',  'resides at',      'is home to'),
  ('00000000-0000-4000-a000-000000000001', 'member_of',   'is a member of',  'has member'),
  ('00000000-0000-4000-a000-000000000001', 'manages',     'manages',         'is managed by'),
  ('00000000-0000-4000-a000-000000000001', 'employed_by', 'is employed by',  'employs'),
  ('00000000-0000-4000-a000-000000000001', 'related_to',  'is related to',   'is related to'),
  ('00000000-0000-4000-a000-000000000001', 'vendor_for',  'is a vendor for', 'uses vendor'),
  ('00000000-0000-4000-a000-000000000001', 'adjacent_to', 'is adjacent to',  'is adjacent to'),
  ('00000000-0000-4000-a000-000000000001', 'governs',     'governs',         'is governed by'),
  ('00000000-0000-4000-a000-000000000001', 'references',  'references',      'is referenced by')
on conflict (org_id, key) do nothing;

/*
  Zoning is free text with a lookup for labels, not a closed list. Two code
  vintages share the column: post-NewZO city codes and older county codes. A
  parcel carrying something not listed here is a normal state, not an error.
  See docs/SAGIS-API.md.
*/
insert into reference_items (org_id, list, value, label, sort_order, active)
values
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'RSF-5',  'RSF-5, Residential single-family, 5',        0,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'RSF-6',  'RSF-6, Residential single-family, 6',        1,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'RSF-A',  'RSF-A, Residential single-family, attached', 2,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'RMF-10', 'RMF-10, Residential multi-family, 10',       3,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'TN-1',   'TN-1, Traditional neighborhood, 1',          4,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'TN-2',   'TN-2, Traditional neighborhood, 2',          5,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'TR-1',   'TR-1, Traditional residential, 1',           6,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'TC-1',   'TC-1, Traditional commercial, 1',            7,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'B-C',    'B-C, Community business',                    8,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'R-1',    'R-1, One family residential',                9,  true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'R-A',    'R-A, Residential agricultural',              10, true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'A-1',    'A-1, Agricultural',                          11, true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'PUD',    'PUD, Planned unit development',              12, true),
  ('00000000-0000-4000-a000-000000000001', 'zoning', 'P-B',    'P-B, Planned business',                      13, false),

  /*
    Property use is what is actually there. Zoning is the regulatory district.
    They are two different fields on purpose: collapsing them breaks the
    "commercial use in a residential district" query, which is a core use case.
  */
  ('00000000-0000-4000-a000-000000000001', 'property_use', 'single_family',  'Single family',  0, true),
  ('00000000-0000-4000-a000-000000000001', 'property_use', 'duplex',         'Duplex',         1, true),
  ('00000000-0000-4000-a000-000000000001', 'property_use', 'townhouse',      'Townhouse',      2, true),
  ('00000000-0000-4000-a000-000000000001', 'property_use', 'multi_family',   'Multi family',   3, true),
  ('00000000-0000-4000-a000-000000000001', 'property_use', 'commercial',     'Commercial',     4, true),
  ('00000000-0000-4000-a000-000000000001', 'property_use', 'institutional',  'Institutional',  5, true),
  ('00000000-0000-4000-a000-000000000001', 'property_use', 'vacant_lot',     'Vacant lot',     6, true),

  ('00000000-0000-4000-a000-000000000001', 'association_type', 'hoa',        'Homeowners association',       0, true),
  ('00000000-0000-4000-a000-000000000001', 'association_type', 'committee',  'Committee',                    1, true),
  ('00000000-0000-4000-a000-000000000001', 'association_type', 'civic_club', 'Civic club',                   2, true),
  ('00000000-0000-4000-a000-000000000001', 'association_type', 'poa',        'Property owners association',  3, true),

  ('00000000-0000-4000-a000-000000000001', 'record_type', 'covenant_violation',    'Covenant violation',    0, true),
  ('00000000-0000-4000-a000-000000000001', 'record_type', 'architectural_request', 'Architectural request', 1, true),
  ('00000000-0000-4000-a000-000000000001', 'record_type', 'maintenance_request',   'Maintenance request',   2, true),
  ('00000000-0000-4000-a000-000000000001', 'record_type', 'complaint',             'Complaint',             3, true),
  ('00000000-0000-4000-a000-000000000001', 'record_type', 'meeting_minutes',       'Meeting minutes',       4, true),
  ('00000000-0000-4000-a000-000000000001', 'record_type', 'assessment',            'Assessment',            5, true),
  ('00000000-0000-4000-a000-000000000001', 'record_type', 'correspondence',        'Correspondence',        6, false)
on conflict (org_id, list, value) do nothing;

// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/*
  The migrations, run against a real Postgres.

  There is no Docker on this machine and the database is hosted, so without this
  the first thing to execute `supabase/migrations` would be the production
  database. PGlite is Postgres compiled to WebAssembly: the same parser, the
  same planner, the same plpgsql. It is not Supabase, so `auth` is stubbed
  below, but everything this schema actually asserts is core Postgres.

  The audit log is the reason this file is worth its weight. It is triggers and
  plpgsql, it is the one part of the schema with real logic in it, and a broken
  audit trigger is invisible until somebody needs the history.
*/

const MIGRATIONS = join(import.meta.dirname, 'migrations')
const ORG = '00000000-0000-4000-a000-000000000001'

/*
  Enough of Supabase for the migration to compile. `auth.uid()` reads the same
  setting PostgREST populates, so policies can be exercised by setting it.
*/
const AUTH_STUB = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
`

async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(AUTH_STUB)

  // In filename order, which is the order Supabase applies them in.
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

let db: PGlite

beforeAll(async () => {
  db = await freshDatabase()
}, 60_000)

describe('the migrations', () => {
  it('apply cleanly from empty, in filename order', async () => {
    const tables = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`
    )
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'audit_entries',
      'entities',
      'org_users',
      'orgs',
      'reference_items',
      'relation_types',
      'relations',
    ])
  })

  it('enables row level security on every table, with no exceptions', async () => {
    /*
      Including the lookup tables. A reference list that leaks tells you which
      organisations exist and what they call things.
    */
    const open = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and not rowsecurity`
    )
    expect(open.rows).toEqual([])
  })

  it('gives every table at least one policy, so RLS is not just a locked door', async () => {
    const counts = await db.query<{ tablename: string; n: number }>(
      `select tablename, count(*)::int as n from pg_policies
       where schemaname = 'public' group by tablename`
    )
    const byTable = new Map(counts.rows.map((row) => [row.tablename, row.n]))
    for (const table of [
      'orgs',
      'org_users',
      'entities',
      'relations',
      'relation_types',
      'reference_items',
      'audit_entries',
    ]) {
      expect(byTable.get(table) ?? 0).toBeGreaterThan(0)
    }
  })

  it('filters every policy on the org, which is the whole tenancy story', async () => {
    const policies = await db.query<{ tablename: string; qual: string | null }>(
      `select tablename, qual from pg_policies where schemaname = 'public'`
    )
    for (const policy of policies.rows) {
      // orgs is keyed on its own id; everything else carries org_id.
      const expected = policy.tablename === 'orgs' ? 'id' : 'org_id'
      expect(policy.qual ?? '').toContain(expected)
      expect(policy.qual ?? '').toContain('current_org_ids')
    }
  })

  it('bootstraps the org, the thirteen relation types, and the reference lists', async () => {
    const counts = await db.query<{ orgs: number; types: number; items: number }>(
      `select (select count(*)::int from orgs) as orgs,
              (select count(*)::int from relation_types) as types,
              (select count(*)::int from reference_items) as items`
    )
    expect(counts.rows[0]?.orgs).toBe(1)
    // Ten from the bootstrap, rents and executive_of from 20261016120000, and
    // rents_from from 20261019120000.
    expect(counts.rows[0]?.types).toBe(13)
    expect(counts.rows[0]?.items).toBeGreaterThan(20)
  })

  it('is idempotent, so re-running the bootstrap changes nothing', async () => {
    const bootstrap = readdirSync(MIGRATIONS)
      .filter((name) => name.includes('bootstrap'))
      .sort()
    expect(bootstrap.length).toBe(1)

    const [file] = bootstrap
    expect(file).toBeDefined()
    await db.exec(readFileSync(join(MIGRATIONS, file ?? ''), 'utf8'))

    const counts = await db.query<{ types: number }>(
      `select count(*)::int as types from relation_types`
    )
    expect(counts.rows[0]?.types).toBe(13)
  })

  it('reads the vendor connection from the customer end as "purchases from"', async () => {
    const vendor = await db.query<{ reverse_label: string }>(
      `select reverse_label from relation_types where key = 'vendor_for'`
    )
    expect(vendor.rows[0]?.reverse_label).toBe('purchases from')
  })

  it('splits "rents" into renting a property and renting from someone', async () => {
    const labels = await db.query<{ key: string; label: string; reverse_label: string }>(
      `select key, label, reverse_label from relation_types
       where key in ('rents', 'rents_from') order by key`
    )
    expect(labels.rows).toEqual([
      { key: 'rents', label: 'rents property', reverse_label: 'is rented by' },
      { key: 'rents_from', label: 'rents from', reverse_label: 'rents to' },
    ])
  })

  it('moves an old "rents" connection to "rents from" only when the other end is not a property', async () => {
    const made = await db.query<{ id: string; type: string }>(
      `insert into entities (org_id, type, name) values
         ($1, 'business', 'Knack Pottery'),
         ($1, 'business', '40 Space'),
         ($1, 'property', '104 E 40th St')
       returning id, type`,
      [ORG]
    )
    const [tenant, landlord, lot] = made.rows
    const rents = await db.query<{ id: string }>(
      `select id from relation_types where org_id = $1 and key = 'rents'`,
      [ORG]
    )
    const inserted = await db.query<{ id: string }>(
      `insert into relations (org_id, relation_type_id, from_entity_id, to_entity_id)
       values ($1, $2, $3, $4), ($1, $2, $3, $5) returning id`,
      [ORG, rents.rows[0]?.id, tenant?.id, landlord?.id, lot?.id]
    )

    const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_rents_from.sql'))
    await db.exec(readFileSync(join(MIGRATIONS, file ?? ''), 'utf8'))

    const keys = await db.query<{ to_entity_id: string; key: string }>(
      `select r.to_entity_id, t.key from relations r
       join relation_types t on t.id = r.relation_type_id
       where r.id = any($1::uuid[])`,
      [inserted.rows.map((row) => row.id)]
    )
    const keyFor = (id: string | undefined) =>
      keys.rows.find((row) => row.to_entity_id === id)?.key
    expect(keyFor(landlord?.id)).toBe('rents_from')
    expect(keyFor(lot?.id)).toBe('rents')
  })
})

describe('record status typed by hand', () => {
  it('brings typed statuses onto Open, On hold, and Done, and leaves anything else', async () => {
    const made = await db.query<{ id: string }>(
      `insert into entities (org_id, type, name, data) values
         ($1, 'record', 'a typed closed', '{"status": "Closed"}'),
         ($1, 'record', 'b typed done', '{"status": "Done"}'),
         ($1, 'record', 'c old in review', '{"status": "in_review"}'),
         ($1, 'record', 'd typed on hold', '{"status": " On Hold "}'),
         ($1, 'record', 'e already right', '{"status": "open"}'),
         ($1, 'record', 'f something else', '{"status": "Waiting on city"}')
       returning id`,
      [ORG]
    )

    const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_record_status.sql'))
    await db.exec(readFileSync(join(MIGRATIONS, file ?? ''), 'utf8'))

    const rows = await db.query<{ status: string }>(
      `select data ->> 'status' as status from entities where id = any($1::uuid[])
       order by name`,
      [made.rows.map((row) => row.id)]
    )
    expect(rows.rows.map((row) => row.status)).toEqual([
      'closed',
      'closed',
      'on_hold',
      'on_hold',
      'open',
      'Waiting on city',
    ])
  })
})

describe('the audit log, which is triggers and never application code', () => {
  let entityId: string

  beforeAll(async () => {
    await db.exec(`select set_config('artypest.actor', 'marguerite@example.org', false)`)
    const inserted = await db.query<{ id: string }>(
      `insert into entities (org_id, type, name, data)
       values ($1, 'property', '1402 E 49th St', '{"pin":"20003 15001"}'::jsonb)
       returning id`,
      [ORG]
    )
    entityId = inserted.rows[0]?.id ?? ''
  })

  it('writes one row for an insert, with no field name', async () => {
    const rows = await db.query<{ action: string; field_name: string | null; changed_by: string }>(
      `select action, field_name, changed_by from audit_entries where record_id = $1`,
      [entityId]
    )
    expect(rows.rows).toEqual([
      { action: 'insert', field_name: null, changed_by: 'marguerite@example.org' },
    ])
  })

  it('writes one row per changed field, so history reads as a diff', async () => {
    await db.query(`update entities set name = $2, data = $3 where id = $1`, [
      entityId,
      '1402 E 49th Street',
      '{"pin":"20003 15001","zoning":"TN-2"}',
    ])

    const rows = await db.query<{ field_name: string; old_value: string; new_value: string }>(
      `select field_name, old_value, new_value from audit_entries
       where record_id = $1 and action = 'update' order by field_name`,
      [entityId]
    )
    /*
      `reviewed_at` rides along because a person who opened this record, changed
      it, and saved it has read it, and the hand mark is a real column that the
      audit trigger sees move like any other. It is one row, and it renders as
      "checked this record" rather than as a diff.
    */
    // Inside `data`, key by key: only zoning changed, so only zoning is logged.
    expect(rows.rows.map((row) => row.field_name)).toEqual(['data.zoning', 'name', 'reviewed_at'])
    expect(rows.rows.find((row) => row.field_name === 'name')).toMatchObject({
      old_value: '1402 E 49th St',
      new_value: '1402 E 49th Street',
    })
  })

  it('leaves no trace for an update that changed nothing', async () => {
    const before = await db.query<{ n: number }>(
      `select count(*)::int as n from audit_entries where record_id = $1`,
      [entityId]
    )
    await db.query(`update entities set name = '1402 E 49th Street' where id = $1`, [entityId])
    const after = await db.query<{ n: number }>(
      `select count(*)::int as n from audit_entries where record_id = $1`,
      [entityId]
    )
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n)
  })

  it('never logs updated_at, which changes on every write by definition', async () => {
    const rows = await db.query<{ n: number }>(
      `select count(*)::int as n from audit_entries
       where record_id = $1 and field_name = 'updated_at'`,
      [entityId]
    )
    expect(rows.rows[0]?.n).toBe(0)
  })

  it('audits a soft delete as the field change it is', async () => {
    await db.query(`update entities set deleted_at = now() where id = $1`, [entityId])
    const rows = await db.query<{ action: string }>(
      `select action from audit_entries where record_id = $1 and field_name = 'deleted_at'`,
      [entityId]
    )
    expect(rows.rows).toEqual([{ action: 'update' }])
  })

  it('audits relations, because "Unit 42 changed hands" is the entry that matters', async () => {
    const person = await db.query<{ id: string }>(
      `insert into entities (org_id, type, name) values ($1, 'person', 'Daniel Okonkwo')
       returning id`,
      [ORG]
    )
    const type = await db.query<{ id: string }>(
      `select id from relation_types where org_id = $1 and key = 'owns'`,
      [ORG]
    )
    const relation = await db.query<{ id: string }>(
      `insert into relations (org_id, relation_type_id, from_entity_id, to_entity_id, start_date)
       values ($1, $2, $3, $4, '2019-04-01') returning id`,
      [ORG, type.rows[0]?.id, person.rows[0]?.id, entityId]
    )
    await db.query(`update relations set end_date = '2026-01-31' where id = $1`, [
      relation.rows[0]?.id,
    ])

    const rows = await db.query<{ table_name: string; action: string; field_name: string | null }>(
      `select table_name, action, field_name from audit_entries
       where record_id = $1 order by changed_at, action, field_name`,
      [relation.rows[0]?.id]
    )
    expect(rows.rows).toEqual([
      { table_name: 'relations', action: 'insert', field_name: null },
      { table_name: 'relations', action: 'update', field_name: 'end_date' },
    ])
  })

  it('groups everything one action wrote under one batch id', async () => {
    const batch = '11111111-1111-4111-a111-111111111111'
    await db.exec(`select set_config('artypest.batch_id', '${batch}', false)`)
    await db.query(
      `insert into entities (org_id, type, name)
       select $1, 'property', 'Lot ' || g from generate_series(1, 5) g`,
      [ORG]
    )
    const rows = await db.query<{ n: number }>(
      `select count(*)::int as n from audit_entries where batch_id = $1`,
      [batch]
    )
    expect(rows.rows[0]?.n).toBe(5)
    await db.exec(`select set_config('artypest.batch_id', '', false)`)
  })
})

describe('the constraints that stop bad data', () => {
  const refuses = async (sql: string, params: unknown[]) => {
    await expect(db.query(sql, params)).rejects.toThrow()
  }

  it('refuses a relation pointing at itself', async () => {
    const type = await db.query<{ id: string }>(
      `select id from relation_types where org_id = $1 and key = 'owns'`,
      [ORG]
    )
    const entity = await db.query<{ id: string }>(
      `insert into entities (org_id, type, name) values ($1, 'property', 'Self') returning id`,
      [ORG]
    )
    await refuses(
      `insert into relations (org_id, relation_type_id, from_entity_id, to_entity_id)
       values ($1, $2, $3, $3)`,
      [ORG, type.rows[0]?.id, entity.rows[0]?.id]
    )
  })

  it('refuses an end date before its start date', async () => {
    const type = await db.query<{ id: string }>(
      `select id from relation_types where org_id = $1 and key = 'owns'`,
      [ORG]
    )
    const a = await db.query<{ id: string }>(
      `insert into entities (org_id, type, name) values ($1, 'person', 'A') returning id`,
      [ORG]
    )
    const b = await db.query<{ id: string }>(
      `insert into entities (org_id, type, name) values ($1, 'property', 'B') returning id`,
      [ORG]
    )
    await refuses(
      `insert into relations (org_id, relation_type_id, from_entity_id, to_entity_id, start_date, end_date)
       values ($1, $2, $3, $4, '2020-01-01', '2019-01-01')`,
      [ORG, type.rows[0]?.id, a.rows[0]?.id, b.rows[0]?.id]
    )
  })

  it('refuses an entity type the application does not have', async () => {
    await refuses(`insert into entities (org_id, type, name) values ($1, 'dragon', 'Nope')`, [ORG])
  })

  it('refuses a reference item in a list that does not exist', async () => {
    await refuses(
      `insert into reference_items (org_id, list, value, label) values ($1, 'wards', 'x', 'X')`,
      [ORG]
    )
  })
})

/*
  The hand mark.

  Every case here has a twin in src/lib/review/status.test.ts and
  src/lib/data/review-provider.test.ts, which is the point: the temporary
  provider and the schema that replaces it answer the same questions the same
  way, so swapping one for the other changes nothing a reader can see.

  Run on its own database, because these tests deliberately set
  `artypest.audit_source` and leaving that set would change the meaning of
  every row written after them.
*/
describe('the hand mark', () => {
  let marks: PGlite
  let lot = ''
  let parcel = ''

  beforeAll(async () => {
    // ORG is seeded by the bootstrap migration, so there is nothing to insert.
    marks = await freshDatabase()
  }, 60_000)

  async function stateOf(id: string): Promise<string> {
    const rows = await marks.query<{ state: string }>(
      `select state from entity_review where entity_id = $1`,
      [id]
    )
    return rows.rows[0]?.state ?? 'missing'
  }

  it('is claimed by a hand write, and says who made it', async () => {
    await marks.exec(`
      select set_config('artypest.actor', 'teresa@example.org', false);
      select set_config('artypest.audit_source', 'hand', false);
    `)
    const inserted = await marks.query<{ id: string }>(
      `insert into entities (org_id, type, name) values ($1, 'property', '1207 E Washington Ave')
       returning id`,
      [ORG]
    )
    lot = inserted.rows[0]?.id ?? ''

    const row = await marks.query<{ reviewed_by: string; marked: boolean }>(
      `select reviewed_by, (reviewed_at is not null) as marked from entities where id = $1`,
      [lot]
    )
    expect(row.rows[0]).toEqual({ reviewed_by: 'teresa@example.org', marked: true })
    expect(await stateOf(lot)).toBe('checked')
  })

  /*
    The distinction the whole feature rests on. Whoever pressed the button ran
    the import; they did not read the four hundred lots it wrote.
  */
  it('is not claimed by an import, however many rows it wrote', async () => {
    await marks.exec(`select set_config('artypest.audit_source', 'import', false)`)
    const inserted = await marks.query<{ id: string }>(
      `insert into entities (org_id, type, name) values ($1, 'property', '1204 E Henry St')
       returning id`,
      [ORG]
    )
    parcel = inserted.rows[0]?.id ?? ''

    const row = await marks.query<{ unmarked: boolean }>(
      `select (reviewed_at is null) as unmarked from entities where id = $1`,
      [parcel]
    )
    expect(row.rows[0]?.unmarked).toBe(true)
    expect(await stateOf(parcel)).toBe('unchecked')
  })

  it('ends when the county writes to the record after the check', async () => {
    await marks.exec(`select set_config('artypest.audit_source', 'import', false)`)
    await marks.query(`update entities set data = '{"zoning":"TN-2"}'::jsonb where id = $1`, [lot])

    expect(await stateOf(lot)).toBe('recheck')

    // And the import must not have quietly renewed somebody else's claim.
    const row = await marks.query<{ reviewed_by: string }>(
      `select reviewed_by from entities where id = $1`,
      [lot]
    )
    expect(row.rows[0]?.reviewed_by).toBe('teresa@example.org')
  })

  it('is renewed by checking again', async () => {
    await marks.exec(`
      select set_config('artypest.audit_source', 'hand', false);
      select set_config('artypest.actor', 'daniel@example.org', false);
    `)
    await marks.query(`update entities set reviewed_at = now() where id = $1`, [lot])

    expect(await stateOf(lot)).toBe('checked')
    const row = await marks.query<{ reviewed_by: string }>(
      `select reviewed_by from entities where id = $1`,
      [lot]
    )
    expect(row.rows[0]?.reviewed_by).toBe('daniel@example.org')
  })

  /*
    A re-save, an idempotent upsert, or a script touching every row must never
    be able to manufacture a claim that a person read something.
  */
  it('is not claimed by a write that changed nothing', async () => {
    await marks.query(`update entities set reviewed_at = null where id = $1`, [lot])
    const before = await marks.query<{ n: number }>(
      `select count(*)::int as n from audit_entries where record_id = $1`,
      [lot]
    )

    await marks.query(`update entities set name = name where id = $1`, [lot])

    const row = await marks.query<{ cleared: boolean; anonymous: boolean }>(
      `select (reviewed_at is null) as cleared, (reviewed_by is null) as anonymous
       from entities where id = $1`,
      [lot]
    )
    expect(row.rows[0]).toEqual({ cleared: true, anonymous: true })

    const after = await marks.query<{ n: number }>(
      `select count(*)::int as n from audit_entries where record_id = $1`,
      [lot]
    )
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n)
  })

  it('records where every audit row came from', async () => {
    const row = await marks.query<{ hand: number; imported: number }>(
      `select
         count(*) filter (where source = 'hand')::int as hand,
         count(*) filter (where source = 'import')::int as imported
       from audit_entries where record_id = $1`,
      [lot]
    )
    expect(row.rows[0]?.hand).toBeGreaterThan(0)
    expect(row.rows[0]?.imported).toBeGreaterThan(0)
  })

  /*
    reviewed_by only ever moves alongside reviewed_at, so auditing it would put
    a second, emptier row beside every check.
  */
  it('does not audit reviewed_by beside reviewed_at', async () => {
    const row = await marks.query<{ n: number }>(
      `select count(*)::int as n from audit_entries where field_name = 'reviewed_by'`
    )
    expect(row.rows[0]?.n).toBe(0)
  })
})

/*
  Keeping the association's records here rather than in each browser.

  On its own database, because these tests set request headers and the
  materializing flag, and leaving either set would change every row after.
*/
describe('shared records', () => {
  let shared: PGlite

  beforeAll(async () => {
    shared = await freshDatabase()
    await shared.exec(`select set_config('artypest.actor', 'dana@example.org', false)`)
  }, 60_000)

  const historyOf = async (id: string) =>
    (
      await shared.query<{ field_name: string | null; old_value: string | null; new_value: string | null }>(
        `select field_name, old_value, new_value from audit_entries
         where record_id = $1 order by changed_at, field_name`,
        [id]
      )
    ).rows

  it('logs a photograph as a description, never as the photograph', async () => {
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(500)
    const created = await shared.query<{ id: string }>(
      `insert into entities (org_id, type, name, data) values ($1, 'person', 'Greg Goeken', '{}')
       returning id`,
      [ORG]
    )
    const id = created.rows[0]?.id ?? ''
    await shared.query(`update entities set data = $2 where id = $1`, [
      id,
      JSON.stringify({ photo, images: [photo, photo], phone: '912-555-0100' }),
    ])

    const rows = await historyOf(id)
    expect(rows).toContainEqual({ field_name: 'data.photo', old_value: null, new_value: 'a photograph' })
    expect(rows).toContainEqual({ field_name: 'data.images', old_value: null, new_value: '2 images' })
    expect(rows).toContainEqual({ field_name: 'data.phone', old_value: null, new_value: '912-555-0100' })
    for (const row of rows) expect(row.new_value ?? '').not.toContain('base64')
  })

  it('copies a county parcel in without an edit, a check, or a history entry', async () => {
    const parcel = {
      id: '22222222-2222-4222-a222-222222222222',
      org_id: ORG,
      type: 'property',
      name: '104 E 40th St',
      data: { pin: '20065 38013' },
      folder_id: null,
      created_at: '2024-10-12T13:11:00Z',
      updated_at: '2024-10-12T13:11:00Z',
      deleted_at: null,
      archived_at: null,
      reviewed_at: null,
      reviewed_by: null,
    }
    await shared.query(`select materialize_records($1::jsonb, '[]'::jsonb)`, [JSON.stringify([parcel])])
    // Twice, as two admins touching the same lot at once would.
    await shared.query(`select materialize_records($1::jsonb, '[]'::jsonb)`, [JSON.stringify([parcel])])

    const row = await shared.query<{ name: string; reviewed_at: string | null; updated_at: string }>(
      `select name, reviewed_at, updated_at from entities where id = $1`,
      [parcel.id]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]?.reviewed_at).toBeNull()
    expect(await historyOf(parcel.id)).toEqual([])

    // The next real edit is audited and claims the mark as usual.
    await shared.query(`update entities set data = $2 where id = $1`, [
      parcel.id,
      JSON.stringify({ pin: '20065 38013', zoning: 'TN-2' }),
    ])
    const fields = (await historyOf(parcel.id)).map((entry) => entry.field_name)
    expect(fields).toContain('data.zoning')
    expect(fields).toContain('reviewed_at')
  })

  it('takes the batch and the source from the request, as PostgREST passes them', async () => {
    const batch = '33333333-3333-4333-a333-333333333333'
    await shared.exec(
      `select set_config('request.headers', '{"x-artypest-batch":"${batch}","x-artypest-source":"import"}', false)`
    )
    const created = await shared.query<{ id: string; reviewed_at: string | null }>(
      `insert into entities (org_id, type, name) values ($1, 'property', '1 Import Row')
       returning id, reviewed_at`,
      [ORG]
    )
    await shared.exec(`select set_config('request.headers', '', false)`)

    // An import is not a person reading the record.
    expect(created.rows[0]?.reviewed_at).toBeNull()
    const audit = await shared.query<{ batch_id: string; source: string }>(
      `select batch_id, source from audit_entries where record_id = $1`,
      [created.rows[0]?.id]
    )
    expect(audit.rows).toEqual([{ batch_id: batch, source: 'import' }])
  })

  it('ignores a source header it does not know, and a batch that is not a uuid', async () => {
    await shared.exec(
      `select set_config('request.headers', '{"x-artypest-batch":"nope","x-artypest-source":"admin"}', false)`
    )
    const created = await shared.query<{ id: string }>(
      `insert into entities (org_id, type, name) values ($1, 'property', '2 Odd Headers')
       returning id`,
      [ORG]
    )
    await shared.exec(`select set_config('request.headers', '', false)`)

    const audit = await shared.query<{ source: string }>(
      `select source from audit_entries where record_id = $1`,
      [created.rows[0]?.id]
    )
    expect(audit.rows).toEqual([{ source: 'hand' }])
  })

  it('lists everyone who has changed anything, for the Activity filter', async () => {
    const actors = await shared.query<{ audit_actors: string }>(`select * from audit_actors()`)
    expect(actors.rows.map((row) => row.audit_actors)).toContain('dana@example.org')
  })
})

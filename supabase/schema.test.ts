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

  it('bootstraps the org, the ten relation types, and the reference lists', async () => {
    const counts = await db.query<{ orgs: number; types: number; items: number }>(
      `select (select count(*)::int from orgs) as orgs,
              (select count(*)::int from relation_types) as types,
              (select count(*)::int from reference_items) as items`
    )
    expect(counts.rows[0]?.orgs).toBe(1)
    expect(counts.rows[0]?.types).toBe(10)
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
    expect(counts.rows[0]?.types).toBe(10)
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
    expect(rows.rows.map((row) => row.field_name)).toEqual(['data', 'name'])
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
       where record_id = $1 order by changed_at, field_name`,
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

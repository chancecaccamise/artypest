/*
  The schema, first migration. Forward only.

  Shapes follow src/lib/data/types.ts, which the whole application already reads
  and writes through the DataProvider seam. Names are snake_case here and
  camelCase there; the provider translates. That is the only difference.

  Three rules from CLAUDE.md are structural rather than aspirational, so they
  are enforced here rather than remembered later:

    - one entities table with a type discriminator and a JSONB data column,
      never one table per type
    - one relations table with real foreign keys on both ends
    - every table carries org_id, every policy filters on it, and row level
      security is enabled in the same statement block that creates the table
*/

/*
  No extensions. gen_random_uuid() has been core Postgres since 13 and Supabase
  runs 15, so pgcrypto is not needed for it, and md5() below is core too. An
  extension that is not required is one more thing that has to be present for a
  restore to work.
*/

/* ------------------------------------------------------------------- orgs -- */

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Municipal GIS viewers get replatformed, so the outbound URL is data.
  sagis_url_template text,
  created_at timestamptz not null default now()
);

alter table orgs enable row level security;

/* -------------------------------------------------------------- org_users -- */

/*
  Membership. `user_id` is null for a seeded placeholder who has not been
  invited yet, which is why it is nullable and why the unique index tolerates
  it.
*/
create table org_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  email text not null,
  role text not null check (role in ('admin', 'manager', 'board', 'resident')),
  last_active_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index org_users_org_user_idx on org_users (org_id, user_id)
  where user_id is not null;
create index org_users_org_idx on org_users (org_id);

alter table org_users enable row level security;

/*
  Which orgs the signed-in user belongs to.

  security definer on purpose. Every policy below calls this, including the
  policy on org_users itself, and a policy that queried an RLS-protected table
  to decide whether to allow reading that same table recurses forever.

  search_path is pinned because a security definer function that resolves names
  through the caller's search_path is how privilege escalation happens.
*/
create or replace function current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from org_users where user_id = auth.uid()
$$;

revoke all on function current_org_ids() from public;
grant execute on function current_org_ids() to authenticated;

/* --------------------------------------------------------- relation_types -- */

/*
  Bidirectionality is a read concern. One stored row in `relations`, rendered
  from both ends using label and reverse_label.
*/
create table relation_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  key text not null,
  label text not null,
  reverse_label text not null,
  created_at timestamptz not null default now(),
  unique (org_id, key)
);

alter table relation_types enable row level security;

/* --------------------------------------------------------------- entities -- */

create table entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  type text not null check (
    type in ('person', 'property', 'business', 'association', 'asset', 'document', 'record')
  ),
  name text not null,
  -- Per-type fields. Validated by the Zod schemas in src/lib/validation.
  data jsonb not null default '{}'::jsonb,
  folder_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete and archive are different states with different meanings.
  deleted_at timestamptz,
  archived_at timestamptz
);

create index entities_org_type_idx on entities (org_id, type);
-- The directory's default view: active only, newest first.
create index entities_org_active_idx on entities (org_id, type, name)
  where deleted_at is null and archived_at is null;
-- Containment queries against the JSONB column, such as data->>'pin'.
create index entities_data_idx on entities using gin (data jsonb_path_ops);

alter table entities enable row level security;

/* -------------------------------------------------------------- relations -- */

create table relations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  relation_type_id uuid not null references relation_types (id) on delete restrict,
  -- Real foreign keys on both ends, per CLAUDE.md. A relation to a record that
  -- does not exist is not a state this application has to reason about.
  from_entity_id uuid not null references entities (id) on delete cascade,
  to_entity_id uuid not null references entities (id) on delete cascade,
  start_date date,
  end_date date,
  -- Board role, term dates, and anything else a relation carries.
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  archived_at timestamptz,
  constraint relations_not_self check (from_entity_id <> to_entity_id),
  constraint relations_dates_ordered check (
    end_date is null or start_date is null or end_date >= start_date
  )
);

create index relations_org_from_idx on relations (org_id, from_entity_id);
create index relations_org_to_idx on relations (org_id, to_entity_id);
create index relations_type_idx on relations (relation_type_id);

alter table relations enable row level security;

/* -------------------------------------------------------- reference_items -- */

create table reference_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  list text not null check (
    list in ('zoning', 'property_use', 'association_type', 'record_type')
  ),
  -- Stored on entities. Renaming the label never rewrites stored values.
  value text not null,
  label text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, list, value)
);

create index reference_items_org_list_idx on reference_items (org_id, list, sort_order);

alter table reference_items enable row level security;

/* ---------------------------------------------------------- audit_entries -- */

/*
  One row per changed field, so history reads as a field-level diff rather than
  as "somebody edited this record".

  Written by triggers, never by application code. That is the point: an audit
  log the application maintains is an audit log that is wrong the first time
  somebody writes to the table from anywhere else.
*/
create table audit_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  table_name text not null check (table_name in ('entities', 'relations')),
  record_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  field_name text,
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz not null default now(),
  -- Groups the rows written by one user action, so the Activity feed can say
  -- "the import that produced these 400 rows".
  batch_id uuid
);

create index audit_entries_record_idx on audit_entries (org_id, record_id, changed_at desc);
create index audit_entries_feed_idx on audit_entries (org_id, changed_at desc);
create index audit_entries_batch_idx on audit_entries (batch_id) where batch_id is not null;

alter table audit_entries enable row level security;

/* ---------------------------------------------------------------- audit -- */

/*
  One batch id per user action.

  The application sets `artypest.batch_id` for a deliberate batch, such as a
  parcel import, so every row it writes can be linked back to it. Anything else
  falls back to one id per transaction, which is still the right grouping: two
  rows written by one statement belong together.
*/
create or replace function current_batch_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('artypest.batch_id', true), '')::uuid,
    md5(txid_current()::text)::uuid
  )
$$;

/*
  Who changed it. The email is what a board member recognises in the feed, so
  it is preferred over the opaque user id.
*/
create or replace function current_actor()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('artypest.actor', true), ''),
    nullif(auth.jwt() ->> 'email', ''),
    auth.uid()::text,
    'system'
  )
$$;

create or replace function audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
  target_id uuid;
  old_row jsonb;
  new_row jsonb;
  field text;
  old_value text;
  new_value text;
  wrote boolean := false;
begin
  if tg_op = 'DELETE' then
    target_org := old.org_id;
    target_id := old.id;
  else
    target_org := new.org_id;
    target_id := new.id;
  end if;

  if tg_op = 'INSERT' then
    insert into audit_entries (
      org_id, table_name, record_id, action, field_name, old_value, new_value,
      changed_by, batch_id
    )
    values (
      target_org, tg_table_name, target_id, 'insert', null, null, null,
      current_actor(), current_batch_id()
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into audit_entries (
      org_id, table_name, record_id, action, field_name, old_value, new_value,
      changed_by, batch_id
    )
    values (
      target_org, tg_table_name, target_id, 'delete', null, null, null,
      current_actor(), current_batch_id()
    );
    return old;
  end if;

  old_row := to_jsonb(old);
  new_row := to_jsonb(new);

  for field in select jsonb_object_keys(new_row) loop
    /*
      updated_at changes on every write by definition, so logging it would put
      a meaningless row beside every real one.
    */
    if field = 'updated_at' then
      continue;
    end if;

    old_value := old_row ->> field;
    new_value := new_row ->> field;

    -- `is distinct from` rather than <>, so a value becoming null is a change.
    if old_value is distinct from new_value then
      insert into audit_entries (
        org_id, table_name, record_id, action, field_name, old_value, new_value,
        changed_by, batch_id
      )
      values (
        target_org, tg_table_name, target_id, 'update', field, old_value, new_value,
        current_actor(), current_batch_id()
      );
      wrote := true;
    end if;
  end loop;

  /*
    An update that changed nothing but updated_at leaves no trace, which is
    correct: nothing about the record changed.
  */
  if not wrote then
    return new;
  end if;

  return new;
end;
$$;

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger entities_touch before update on entities
  for each row execute function touch_updated_at();
create trigger relations_touch before update on relations
  for each row execute function touch_updated_at();

/*
  Relation changes are audited too. "Unit 42 changed hands" is the highest value
  entry in the log, and it is a relation, not a field on a record.
*/
create trigger entities_audit after insert or update or delete on entities
  for each row execute function audit_changes();
create trigger relations_audit after insert or update or delete on relations
  for each row execute function audit_changes();

/* ---------------------------------------------------------------- policies -- */

/*
  One shape, repeated: you can see and change a row when it belongs to an org
  you are a member of. No exceptions, including the lookup tables, because a
  lookup table that leaks tells you which orgs exist and what they call things.

  Written out per table rather than generated, so that reading this file tells
  you the whole access story without running anything.
*/

create policy orgs_select on orgs for select to authenticated
  using (id in (select current_org_ids()));
create policy orgs_update on orgs for update to authenticated
  using (id in (select current_org_ids()))
  with check (id in (select current_org_ids()));

create policy org_users_select on org_users for select to authenticated
  using (org_id in (select current_org_ids()));

create policy relation_types_select on relation_types for select to authenticated
  using (org_id in (select current_org_ids()));
create policy relation_types_write on relation_types for all to authenticated
  using (org_id in (select current_org_ids()))
  with check (org_id in (select current_org_ids()));

create policy entities_select on entities for select to authenticated
  using (org_id in (select current_org_ids()));
create policy entities_write on entities for all to authenticated
  using (org_id in (select current_org_ids()))
  with check (org_id in (select current_org_ids()));

create policy relations_select on relations for select to authenticated
  using (org_id in (select current_org_ids()));
create policy relations_write on relations for all to authenticated
  using (org_id in (select current_org_ids()))
  with check (org_id in (select current_org_ids()));

create policy reference_items_select on reference_items for select to authenticated
  using (org_id in (select current_org_ids()));
create policy reference_items_write on reference_items for all to authenticated
  using (org_id in (select current_org_ids()))
  with check (org_id in (select current_org_ids()));

/*
  Read only, deliberately. The audit log is written by triggers running as
  security definer, so it needs no insert policy, and a log a user can write to
  by hand is not a log.
*/
create policy audit_entries_select on audit_entries for select to authenticated
  using (org_id in (select current_org_ids()));

/*
  What the application needs from the database to keep the association's
  records here instead of in each browser.

  Four things, all additive:

    1. History reads field by field inside `data`, as the application has
       always shown it. The trigger used to write one row for the whole JSONB
       column, which would have put a person's entire record, photographs
       included, into the log on every edit.

    2. A county parcel can be copied in the first time somebody touches it,
       without that copy reading as an edit or as a check. The parcel layer is
       reference data served as static files; only what the association
       records about a lot belongs in this table.

    3. A bulk job can say what it is through request headers, because the
       browser reaches this database through PostgREST, one request per
       transaction, and a session setting does not survive between requests.

    4. The Activity page can list who has changed anything.
*/

/* ------------------------------------------------------ request headers -- */

/*
  One header from the current PostgREST request, or null. PostgREST exposes the
  request headers as a JSON setting, lower-cased. Outside a request, in a
  migration or a test, there is none.
*/
create or replace function request_header(header text)
returns text
language sql
stable
as $$
  select nullif(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> lower(header),
    ''
  )
$$;

/*
  The batch a request belongs to. A session setting still wins, for anything
  running inside the database; then the header the application sends for a
  deliberate batch; then one id per transaction, as before. A header that is not
  a uuid is ignored rather than allowed to fail the write.
*/
create or replace function current_batch_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('artypest.batch_id', true), '')::uuid,
    case
      when request_header('x-artypest-batch')
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then request_header('x-artypest-batch')::uuid
    end,
    md5(txid_current()::text)::uuid
  )
$$;

/*
  Import or system, if the request says so, and hand otherwise. Only those two
  are honoured: declaring a write to be a person's is what hand already means,
  and an unknown value is a mistake, not a new kind of source.

  Any member of the association can send this header. What it can do is
  under-claim the hand mark on their own writes, which is the harmless
  direction; it cannot make a write count as somebody having read a record.
*/
create or replace function current_audit_source()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('artypest.audit_source', true), ''),
    case
      when request_header('x-artypest-source') in ('import', 'system')
      then request_header('x-artypest-source')
    end,
    'hand'
  )
$$;

/* ---------------------------------------------------------- audit values -- */

/*
  A JSONB value as one audit cell.

  Strings are stored as themselves, an empty string as nothing, numbers and
  booleans as their text, anything else as JSON. With `summarize`, a photograph
  stored inline as a data URL is described rather than copied: the log is read
  as text, and a photo is several hundred kilobytes of it.

  Mirrors toAuditValue and forAuditLog in src/lib/data/memory-provider.ts.
*/
create or replace function audit_text(value jsonb, summarize boolean)
returns text
language sql
immutable
as $$
  select case
    when value is null or jsonb_typeof(value) = 'null' then null
    when jsonb_typeof(value) = 'string' then
      case
        when summarize and (value #>> '{}') like 'data:image/%' then 'a photograph'
        else nullif(value #>> '{}', '')
      end
    when jsonb_typeof(value) in ('number', 'boolean') then value #>> '{}'
    when summarize
      and jsonb_typeof(value) = 'array'
      and jsonb_array_length(value) > 0
      and not exists (
        select 1
        from jsonb_array_elements(value) as item
        where jsonb_typeof(item) <> 'string' or (item #>> '{}') not like 'data:image/%'
      )
    then
      case
        when jsonb_array_length(value) = 1 then '1 image'
        else jsonb_array_length(value)::text || ' images'
      end
    else value::text
  end
$$;

/* ---------------------------------------------------------------- audit -- */

/*
  The audit trigger, re-stated.

  Unchanged: one row per changed column, relations audited too, updated_at and
  reviewed_by skipped, the source and batch carried onto every row.

  Changed: the `data` column is compared key by key and written as
  `data.<key>`, the shape History has always rendered. Whether a key changed is
  decided on the full value, so swapping one photograph for another is still
  logged even though both read "1 image". And a row copied in by
  materialize_records leaves no trace, because nothing about the record changed:
  it was already true in the county data.
*/
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
  data_key text;
  old_value text;
  new_value text;
begin
  if current_setting('artypest.materializing', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    target_org := old.org_id;
    target_id := old.id;
  else
    target_org := new.org_id;
    target_id := new.id;
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    insert into audit_entries (
      org_id, table_name, record_id, action, field_name, old_value, new_value,
      changed_by, batch_id, source
    )
    values (
      target_org, tg_table_name, target_id, lower(tg_op), null, null, null,
      current_actor(), current_batch_id(), current_audit_source()
    );
    return coalesce(new, old);
  end if;

  old_row := to_jsonb(old);
  new_row := to_jsonb(new);

  for field in select jsonb_object_keys(new_row) loop
    if field in ('updated_at', 'reviewed_by') then
      continue;
    end if;

    if field = 'data' then
      for data_key in
        select jsonb_object_keys(
          coalesce(old_row -> 'data', '{}'::jsonb) || coalesce(new_row -> 'data', '{}'::jsonb)
        )
      loop
        if audit_text(old_row -> 'data' -> data_key, false)
          is distinct from audit_text(new_row -> 'data' -> data_key, false)
        then
          insert into audit_entries (
            org_id, table_name, record_id, action, field_name, old_value, new_value,
            changed_by, batch_id, source
          )
          values (
            target_org, tg_table_name, target_id, 'update', 'data.' || data_key,
            audit_text(old_row -> 'data' -> data_key, true),
            audit_text(new_row -> 'data' -> data_key, true),
            current_actor(), current_batch_id(), current_audit_source()
          );
        end if;
      end loop;
      continue;
    end if;

    old_value := old_row ->> field;
    new_value := new_row ->> field;

    -- `is distinct from` rather than <>, so a value becoming null is a change.
    if old_value is distinct from new_value then
      insert into audit_entries (
        org_id, table_name, record_id, action, field_name, old_value, new_value,
        changed_by, batch_id, source
      )
      values (
        target_org, tg_table_name, target_id, 'update', field, old_value, new_value,
        current_actor(), current_batch_id(), current_audit_source()
      );
    end if;
  end loop;

  return new;
end;
$$;

/*
  The hand mark, re-stated with one addition: a record copied in from the
  county layer has not been read by anybody, so the copy does not claim it.
  Everything else is as 20260902120000_review.sql wrote it.
*/
create or replace function claim_hand_review()
returns trigger
language plpgsql
as $$
declare
  before_row jsonb;
  after_row jsonb;
begin
  if current_setting('artypest.materializing', true) = 'on' then
    return new;
  end if;

  if current_audit_source() <> 'hand' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.reviewed_at := coalesce(new.reviewed_at, now());
    new.reviewed_by := coalesce(new.reviewed_by, current_actor());
    return new;
  end if;

  if new.reviewed_at is distinct from old.reviewed_at then
    new.reviewed_by := case when new.reviewed_at is null then null else current_actor() end;
    return new;
  end if;

  before_row := to_jsonb(old) - 'updated_at' - 'reviewed_at' - 'reviewed_by';
  after_row := to_jsonb(new) - 'updated_at' - 'reviewed_at' - 'reviewed_by';

  if before_row is distinct from after_row then
    new.reviewed_at := now();
    new.reviewed_by := current_actor();
  end if;

  return new;
end;
$$;

/* ----------------------------------------------------------- materialize -- */

/*
  Copies records from the county layer in, as they already are, so that an
  edit or a connection has a row to refer to.

  Security invoker: row level security applies exactly as it does to an
  ordinary insert, so a caller can only copy rows into an org they belong to.
  Rows that are already here are left alone, which makes it safe to call for a
  record somebody else copied in a moment earlier.

  Every column is supplied by the caller. jsonb_populate_recordset does not
  apply column defaults, which is the point: the copy is the record as the
  county layer has it, timestamps included.
*/
create or replace function materialize_records(
  entity_rows jsonb default '[]'::jsonb,
  relation_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('artypest.materializing', 'on', true);

  insert into entities
  select * from jsonb_populate_recordset(null::entities, entity_rows)
  on conflict (id) do nothing;

  insert into relations
  select * from jsonb_populate_recordset(null::relations, relation_rows)
  on conflict (id) do nothing;

  perform set_config('artypest.materializing', 'off', true);
end;
$$;

grant execute on function materialize_records(jsonb, jsonb) to authenticated;

/* --------------------------------------------------------------- actors -- */

/*
  Everyone who has changed anything, for the Activity page's filter. Security
  invoker, so it lists only what row level security already lets the caller
  read.
*/
create or replace function audit_actors()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct changed_by
  from audit_entries
  where changed_by is not null
  order by changed_by
$$;

grant execute on function audit_actors() to authenticated;

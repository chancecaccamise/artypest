/*
  The hand mark, and where an audit row came from.

  Two questions this schema could not answer before:

    1. Has a person read this record, and when?
    2. Was this row written by somebody at a keyboard, or by a bulk import?

  The second is what makes the first worth storing. Without it every row of a
  parcel import is attributed to whoever pressed the button, which is true and
  useless: the association wants to know whether a human has read a record, not
  whether a human started the job that wrote it.

  Forward only, and additive: existing rows keep working, and the defaults are
  the honest reading of history that is already there.
*/

/* ------------------------------------------------------------- entities -- */

/*
  Real columns rather than keys inside `data`.

  Review is the same question for all seven types, so it is not per-type data,
  and "everything nobody has checked yet" is the query the working list runs on
  every page load. That wants an index, and an index on a JSONB key that has to
  exist for every row is a worse version of a column.
*/
alter table entities
  add column reviewed_at timestamptz,
  add column reviewed_by text;

comment on column entities.reviewed_at is
  'When a person last read this record against a source they trust. Null means nobody has.';
comment on column entities.reviewed_by is
  'Who made that check, as current_actor() recorded them.';

/*
  The work queue. Partial, because it only ever serves one question: what is
  left to go through, in the order somebody would work it.
*/
create index entities_org_unreviewed_idx on entities (org_id, type, name)
  where reviewed_at is null and deleted_at is null and archived_at is null;

create index entities_org_reviewed_idx on entities (org_id, type, reviewed_at desc)
  where reviewed_at is not null;

/* -------------------------------------------------------- audit_entries -- */

/*
  `hand` is the default because it is the safe one. A write nobody declared is
  a person at a keyboard, and mistaking a hand edit for an import only
  under-claims the mark; the other way round it would put a green tick on
  sixteen thousand county lots nobody has ever opened.
*/
alter table audit_entries
  add column source text not null default 'hand'
    check (source in ('hand', 'import', 'system'));

create index audit_entries_import_idx on audit_entries (org_id, record_id, changed_at desc)
  where source = 'import';

/*
  Set by the application for a bulk job, exactly as `artypest.batch_id` already
  is, and read here rather than passed in, so a trigger cannot be given a source
  by a caller that is writing rows directly.
*/
create or replace function current_audit_source()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('artypest.audit_source', true), ''),
    'hand'
  )
$$;

/*
  The audit trigger, re-stated with the source carried onto every row.

  Unchanged in every other respect: one row per changed field, relation changes
  audited too, and `updated_at` skipped because it moves on every write by
  definition. `reviewed_by` joins it in that skip list: it only ever changes
  alongside `reviewed_at`, and one row saying "Teresa Vaughn checked this
  record" reads better than two.
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
      changed_by, batch_id, source
    )
    values (
      target_org, tg_table_name, target_id, 'insert', null, null, null,
      current_actor(), current_batch_id(), current_audit_source()
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into audit_entries (
      org_id, table_name, record_id, action, field_name, old_value, new_value,
      changed_by, batch_id, source
    )
    values (
      target_org, tg_table_name, target_id, 'delete', null, null, null,
      current_actor(), current_batch_id(), current_audit_source()
    );
    return old;
  end if;

  old_row := to_jsonb(old);
  new_row := to_jsonb(new);

  for field in select jsonb_object_keys(new_row) loop
    if field in ('updated_at', 'reviewed_by') then
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
      wrote := true;
    end if;
  end loop;

  if not wrote then
    return new;
  end if;

  return new;
end;
$$;

/*
  A hand write claims the mark.

  In the trigger rather than in the application, for the same reason the audit
  log is: a mark the application maintains is a mark that is wrong the first
  time somebody writes to the table from anywhere else. Runs before the audit
  trigger, so the audit trigger sees `reviewed_at` move and records the check.

  Three cases, in the order they are tested:

    the caller set reviewed_at itself   an explicit check, or an explicit
                                        clearing. Honoured exactly as asked.

    the caller changed something else    they opened the record, read it, and
                                        saved it. That is a check.

    the caller changed nothing           nothing happens. An update that moves
                                        no value must leave no trace, which is
                                        already true of the audit log and has to
                                        stay true of the mark: a re-save, an
                                        idempotent upsert, or a script touching
                                        every row must never be able to
                                        manufacture a claim that a person read
                                        something.
*/
create or replace function claim_hand_review()
returns trigger
language plpgsql
as $$
declare
  before_row jsonb;
  after_row jsonb;
begin
  if current_audit_source() <> 'hand' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Typing a record in is reading it. The person entering it is the source.
    new.reviewed_at := coalesce(new.reviewed_at, now());
    new.reviewed_by := coalesce(new.reviewed_by, current_actor());
    return new;
  end if;

  if new.reviewed_at is distinct from old.reviewed_at then
    new.reviewed_by := case when new.reviewed_at is null then null else current_actor() end;
    return new;
  end if;

  /*
    Did anything else move? Compared as jsonb with the bookkeeping columns
    removed, which is the same comparison the audit trigger makes, field by
    field, a few statements later.
  */
  before_row := to_jsonb(old) - 'updated_at' - 'reviewed_at' - 'reviewed_by';
  after_row := to_jsonb(new) - 'updated_at' - 'reviewed_at' - 'reviewed_by';

  if before_row is distinct from after_row then
    new.reviewed_at := now();
    new.reviewed_by := current_actor();
  end if;

  return new;
end;
$$;

/*
  Ordered before entities_touch and entities_audit by name: Postgres fires
  triggers of the same kind in alphabetical order, and `entities_claim_review`
  sorts ahead of both.
*/
create trigger entities_claim_review before insert or update on entities
  for each row execute function claim_hand_review();

/* ----------------------------------------------------------------- view -- */

/*
  The hand mark, resolved.

  A check is a claim about a record at a moment, and the county writing to that
  record afterwards ends the claim. Derived rather than stored, so an import
  cannot leave a stale green tick behind by forgetting to invalidate anything.

  A tie counts as needing a recheck: two writes stamped the same instant carry
  no evidence of which came first, and of the two ways to be wrong, a tick on a
  record the county has since rewritten is the one that costs something.

  Mirrors reviewStateOf in src/lib/review/status.ts. The two are checked against
  the same cases.
*/
create or replace view entity_review as
  select
    e.id as entity_id,
    e.org_id,
    e.type,
    e.reviewed_at,
    e.reviewed_by,
    i.last_import_at,
    case
      when e.reviewed_at is null then 'unchecked'
      when i.last_import_at is not null and i.last_import_at >= e.reviewed_at then 'recheck'
      else 'checked'
    end as state
  from entities e
  left join lateral (
    select max(a.changed_at) as last_import_at
    from audit_entries a
    where a.record_id = e.id
      and a.org_id = e.org_id
      and a.source = 'import'
  ) i on true;

/*
  The view reads `entities` and `audit_entries`, both of which enforce org
  membership, so it inherits their policies rather than restating them. Declared
  explicitly because a view that silently ran as its owner would be a hole.
*/
alter view entity_review set (security_invoker = on);

grant select on entity_review to authenticated;

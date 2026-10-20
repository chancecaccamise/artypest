/*
  The board maintains its own connection types.

  Until now the list on Settings was whatever the migrations seeded. The board
  asked to add and remove kinds of connection without waiting on a release, so
  the list becomes theirs, with two limits the database holds rather than
  trusting every browser to:

  1. The thirteen types that exist today are built in. The plat, the location
     cascade, the board roster, and the insights all read them by key, so one
     going missing breaks a feature rather than a list. Their labels can still
     be reworded; their keys cannot change and they cannot be removed.

  2. A type still used by a current connection cannot be removed. Removing it
     would make those connections vanish from every view without anyone
     having deleted them.

  Removal is a soft delete, as everywhere else. A removed connection keeps its
  type, so its history still reads in its own words, and adding a type with
  the same name again brings the old row back rather than colliding with it.

  Idempotent: the rents migrations before this are re-run in testing, and so
  is this.
*/

alter table relation_types add column if not exists built_in boolean not null default false;
alter table relation_types add column if not exists deleted_at timestamptz;

update relation_types
set built_in = true
where not built_in
  and key in (
    'owns', 'resides_at', 'rents_property', 'rents_from', 'member_of', 'executive_of',
    'manages', 'employed_by', 'related_to', 'vendor_for', 'adjacent_to', 'governs', 'references'
  );

create or replace function guard_relation_type() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Removing the whole association takes its types with it, built in or not.
    if not exists (select 1 from orgs where id = old.org_id) then
      return old;
    end if;
    if old.built_in then
      raise exception 'The connection type "%" is built in and cannot be removed.', old.label;
    end if;
    if exists (select 1 from relations where relation_type_id = old.id) then
      raise exception 'The connection type "%" has connections and cannot be erased.', old.label;
    end if;
    return old;
  end if;

  if old.built_in and (
    new.key is distinct from old.key or new.deleted_at is not null or not new.built_in
  ) then
    raise exception 'The connection type "%" is built in. Its wording can change, nothing else.', old.label;
  end if;

  if new.deleted_at is not null and old.deleted_at is null and exists (
    select 1 from relations where relation_type_id = old.id and deleted_at is null
  ) then
    raise exception 'The connection type "%" is still used by current connections.', old.label;
  end if;

  return new;
end;
$$;

drop trigger if exists relation_types_guard on relation_types;
create trigger relation_types_guard before update or delete on relation_types
  for each row execute function guard_relation_type();

/*
  The other side of the same rule: a browser holding yesterday's list cannot
  file a new connection under a type somebody removed this morning.
*/
create or replace function guard_relation_type_in_use() returns trigger
language plpgsql as $$
begin
  if new.deleted_at is null and exists (
    select 1 from relation_types where id = new.relation_type_id and deleted_at is not null
  ) then
    raise exception 'That connection type has been removed. Reload to see the current list.';
  end if;
  return new;
end;
$$;

drop trigger if exists relations_type_guard on relations;
create trigger relations_type_guard before insert or update of relation_type_id, deleted_at on relations
  for each row execute function guard_relation_type_in_use();

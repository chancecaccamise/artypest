/*
  List items the board can remove.

  The board is still finding out which record types it uses, and asked to
  add, rename, and remove them the way it can relation types. Adding and
  renaming already worked; removing did not exist, because `active` was the
  only way to retire a value.

  A value no record holds is removed outright: there is nothing to keep it
  for. A value a record still holds cannot be, since that record would go on
  storing a value its list no longer explains. Deactivating stays the way to
  retire one of those.

  The rule is for every list, not only record types, and lives here as well as
  in the app because RLS lets any signed in member write to the table.
  Mirrors REFERENCE_LIST_FIELDS in src/lib/data/types.ts.

  Idempotent, like the migrations before it.
*/

create or replace function guard_reference_item() returns trigger
language plpgsql as $$
declare
  holder_type text;
  holder_field text;
begin
  -- Removing the whole association takes its lists with it.
  if not exists (select 1 from orgs where id = old.org_id) then
    return old;
  end if;

  select fields.entity_type, fields.field into holder_type, holder_field
  from (values
    ('zoning', 'property', 'zoning'),
    ('property_use', 'property', 'propertyUse'),
    ('association_type', 'association', 'associationType'),
    ('record_type', 'record', 'recordType')
  ) as fields (list, entity_type, field)
  where fields.list = old.list;

  if holder_field is not null and exists (
    select 1 from entities
    where org_id = old.org_id
      and type = holder_type
      and deleted_at is null
      and data ->> holder_field = old.value
  ) then
    raise exception 'The list item "%" is still used by records. Turn it off instead.', old.label;
  end if;

  return old;
end;
$$;

drop trigger if exists reference_items_guard on reference_items;
create trigger reference_items_guard before delete on reference_items
  for each row execute function guard_reference_item();

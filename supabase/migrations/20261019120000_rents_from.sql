/*
  "rents" was doing two jobs: renting a lot, and renting from a landlord. The
  board asked for them apart, as "rents property" and "rents from".

  The `rents` key keeps the first meaning, because that is what the
  application already reads it as: a tenant of a lot counts as living there,
  for occupancy and for placing a person on the plat. Only its label changes,
  and only where it still says what 20261016120000 wrote, so an org that has
  relabelled it keeps its own wording.

  "rents from" is a new type, for every org, idempotent like the others.
*/

update relation_types
set label = 'rents property'
where key = 'rents' and label = 'rents';

insert into relation_types (org_id, key, label, reverse_label)
select id, 'rents_from', 'rents from', 'rents to' from orgs
on conflict (org_id, key) do nothing;

/*
  A connection stored as "rents" whose other end is not a property was always
  the landlord meaning, so it moves to the new type. The audit trigger records
  the move on each one, which is the honest history: the connection was
  recategorised, not created.
*/
update relations
set relation_type_id = rents_from.id
from relation_types rents, relation_types rents_from, entities target
where relations.relation_type_id = rents.id
  and rents.key = 'rents'
  and rents_from.key = 'rents_from'
  and rents_from.org_id = rents.org_id
  and target.id = relations.to_entity_id
  and target.type <> 'property';

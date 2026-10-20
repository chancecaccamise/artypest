/*
  The key catches up with the label.

  20261019120000 relabelled `rents` as "rents property" and kept the key, so
  existing connections to lots kept working. The key is on the Settings page,
  though, and a board that asked for "rents" to be gone still saw it there
  beside "rents from". Renaming the key is one row per org: connections point
  at the type's id, which does not change.

  Idempotent: once renamed, there is no `rents` left to match. Safe to run
  after 20261019120000 was applied by hand, and safe for that migration to run
  again afterwards, since it only acts on a `rents` key.
*/

update relation_types
set key = 'rents_property'
where key = 'rents'
  and not exists (
    select 1 from relation_types existing
    where existing.org_id = relation_types.org_id and existing.key = 'rents_property'
  );

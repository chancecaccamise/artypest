/*
  Two more kinds of connection, and a better way to read one of the old ones.

  The board asked for "rents" and "is an executive of" by name, and for the
  vendor connection to read "purchases from" from the customer's end. "uses
  vendor" was accurate and nobody says it.

  For every org rather than the bootstrap one, because these are part of what
  the application offers, not part of one association's setup. Idempotent like
  the bootstrap: a type that already exists is left alone.
*/

insert into relation_types (org_id, key, label, reverse_label)
select id, 'rents', 'rents', 'is rented by' from orgs
on conflict (org_id, key) do nothing;

insert into relation_types (org_id, key, label, reverse_label)
select id, 'executive_of', 'is an executive of', 'has executive' from orgs
on conflict (org_id, key) do nothing;

/*
  Only where it still says what the bootstrap wrote, so an org that has
  relabelled it keeps its own wording. Labels are read, never stored on
  relations, so every existing connection reads the new way at once.
*/
update relation_types
set reverse_label = 'purchases from'
where key = 'vendor_for' and reverse_label = 'uses vendor';

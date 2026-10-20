/*
  A record's status, typed by hand until now.

  The form offered a text box, so a board member finishing a record typed
  "Closed" or "Done", and every list, the dashboard, and the overdue check
  compare against "closed". Those records stayed open everywhere that counted.

  The form now offers three: Open, On hold, and Closed, stored as `open`,
  `on_hold`, and `closed`. This brings what was already typed onto them, once
  case, spacing, and punctuation are set aside. "In review", the old middle
  status, becomes On hold. Anything else is left as typed, and the form keeps
  it choosable, so nothing is guessed at.
*/

with typed as (
  select
    id,
    trim(both '_' from regexp_replace(lower(data ->> 'status'), '[^a-z]+', '_', 'g')) as word
  from entities
  where type = 'record' and jsonb_typeof(data -> 'status') = 'string'
),
mapped as (
  select
    id,
    case
      when word = 'open' then 'open'
      when word in ('on_hold', 'hold', 'in_review') then 'on_hold'
      when word in ('closed', 'done', 'complete', 'completed', 'resolved') then 'closed'
    end as status
  from typed
)
update entities
set data = jsonb_set(entities.data, '{status}', to_jsonb(mapped.status))
from mapped
where entities.id = mapped.id
  and mapped.status is not null
  and entities.data ->> 'status' is distinct from mapped.status;

/*
  Files on a record.

  The board asked to attach PDFs, spreadsheets, JSON exports, and the like to
  an asset. The Files tab has been waiting on Storage since it was drawn, and
  every record type has one, so this serves all of them.

  The bytes go to a private Storage bucket. What the record keeps is a short
  description of each file in `data.files` (name, size, type, where it is
  stored, who added it), so attaching a file is an ordinary audited change to
  the record and History says which file came and went.

  Every object lives under its association's id, `<org_id>/<record_id>/...`,
  and the policies filter on that first folder, which is how org_id reaches a
  table this schema does not own. Nothing is public: a file is read through a
  link that expires, handed out only to someone signed in to that association.

  Idempotent, like the migrations before it.
*/

insert into storage.buckets (id, name, public, file_size_limit)
values ('record-files', 'record-files', false, 26214400)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists record_files_select on storage.objects;
create policy record_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'record-files'
    and (storage.foldername(name))[1] in (select org_id::text from current_org_ids() as org_id)
  );

drop policy if exists record_files_insert on storage.objects;
create policy record_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'record-files'
    and (storage.foldername(name))[1] in (select org_id::text from current_org_ids() as org_id)
  );

drop policy if exists record_files_delete on storage.objects;
create policy record_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'record-files'
    and (storage.foldername(name))[1] in (select org_id::text from current_org_ids() as org_id)
  );

/*
  The audit cell for a list of files is their names, not their JSON: History
  reads "warranty.pdf, specs.json", not a wall of storage paths. An empty list
  reads as not set, for files and images alike, rather than as "[]".

  Whether something changed is still decided on the full value by the trigger,
  which calls this with `summarize` off. Mirrors forAuditLog in
  src/lib/data/memory-provider.ts.
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
    when summarize and jsonb_typeof(value) = 'array' and jsonb_array_length(value) = 0 then null
    when summarize
      and jsonb_typeof(value) = 'array'
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
    when summarize
      and jsonb_typeof(value) = 'array'
      and not exists (
        select 1
        from jsonb_array_elements(value) as item
        where jsonb_typeof(item) <> 'object'
          or coalesce(jsonb_typeof(item -> 'name'), '') <> 'string'
      )
    then (
      select string_agg(item ->> 'name', ', ' order by position)
      from jsonb_array_elements(value) with ordinality as files(item, position)
    )
    else value::text
  end
$$;

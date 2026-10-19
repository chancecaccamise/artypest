import { Select } from '@/components/ui/field'
import { useUpdateEntity } from '@/hooks/use-data'
import type { Entity } from '@/lib/data/types'
import { readString } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RECORD_STATUS_OPTIONS } from './config'

/*
  A record's status, changed where it is read.

  Closing a record is the most common thing done to one, and it used to mean
  opening the edit form and typing the word, where "Closed" with a capital was
  a different status from the "closed" every list and the dashboard look for.
  One choice from a fixed list, saved the moment it is picked, like the
  Checked mark beside it.
*/

export function RecordStatusSelect({
  entity,
  className,
}: {
  entity: Entity
  className?: string
}) {
  const update = useUpdateEntity()
  const current = readString(entity.data.status)
  const known = RECORD_STATUS_OPTIONS.some((option) => option.value === current)

  return (
    <Select
      aria-label="Status"
      value={current}
      disabled={update.isPending}
      onChange={(event) =>
        update.mutate({
          id: entity.id,
          patch: { data: { ...entity.data, status: event.target.value } },
        })
      }
      className={cn('h-9 w-auto text-sm', className)}
    >
      {/* Only before a status is set: choosing "not set" is never the fix. */}
      {current === '' ? <option value="">Status not set</option> : null}
      {/* A status typed by hand before this list, kept choosable so it is not erased unseen. */}
      {current !== '' && !known ? <option value={current}>{current}</option> : null}
      {RECORD_STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}

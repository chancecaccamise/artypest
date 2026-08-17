import { useEffect, useRef, useState } from 'react'

import { readString } from '@/lib/format'

import { EmptyState } from '@/components/ui/empty-state'
import { Field, Textarea } from '@/components/ui/field'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { useUpdateEntity } from '@/hooks/use-data'
import type { Entity } from '@/lib/data/types'
import { useRole } from '@/lib/role'

const AUTOSAVE_DELAY_MS = 900

/*
  The internal notes field, with autosave.

  Notes are never visible to a resident. That is enforced here rather than by
  hiding the tab alone, so a resident who reaches this component by any route
  still cannot read them.
*/
export function NotesTab({ entity }: { entity: Entity }) {
  const { canSeeNotes, canEdit } = useRole()
  const updateEntity = useUpdateEntity()

  const [value, setValue] = useState(() => readString(entity.data.notes))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-read when the reader moves to a different record. Deliberately keyed on
  // the id and not on the notes text: re-reading after every autosave would
  // fight whatever has been typed since the save started.
  const [loadedId, setLoadedId] = useState(entity.id)
  if (loadedId !== entity.id) {
    setLoadedId(entity.id)
    setValue(readString(entity.data.notes))
    setStatus('idle')
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  if (!canSeeNotes) {
    return (
      <Panel>
        <PanelHeader title="Notes" />
        <PanelBody>
          <EmptyState
            title="Notes are internal"
            description="Board members and staff can read and write notes. The resident view never shows them."
          />
        </PanelBody>
      </Panel>
    )
  }

  const scheduleSave = (next: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setStatus('saving')
      updateEntity.mutate(
        { id: entity.id, patch: { data: { ...entity.data, notes: next } } },
        {
          onSuccess: () => setStatus('saved'),
          onError: () => setStatus('idle'),
        }
      )
    }, AUTOSAVE_DELAY_MS)
  }

  return (
    <Panel>
      <PanelHeader title="Notes" meta="internal only" />
      <PanelBody>
        <Field
          label="Internal notes"
          hideLabel
          hint="Visible to board members and staff. Never shown to residents."
        >
          <Textarea
            value={value}
            disabled={!canEdit}
            className="min-h-48"
            placeholder="What would you want the next board to know about this record?"
            onChange={(event) => {
              setValue(event.target.value)
              setStatus('idle')
              if (canEdit) scheduleSave(event.target.value)
            }}
          />
        </Field>
      </PanelBody>
      <PanelFooter>
        <span role="status" aria-live="polite" className="font-mono text-xs">
          {status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : 'Autosaves as you type'}
        </span>
        <span className="font-mono text-xs">{value.length} characters</span>
      </PanelFooter>
    </Panel>
  )
}

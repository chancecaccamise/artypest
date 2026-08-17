import { ImageUp, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { useUpdateEntity } from '@/hooks/use-data'
import { readString } from '@/lib/format'
import { ACCEPTED_TYPES, initialsFor, MAX_DIMENSION, readPhotoFile } from '@/lib/photos'
import type { Entity } from '@/lib/data/types'

/*
  A photograph on a person's record.

  There is nowhere to put a file yet, so the image is downscaled in the browser
  and kept on the record as a data URL, which is saved with everything else the
  reader types. When Supabase Storage arrives this becomes an upload returning a
  URL and nothing around it changes, because the record already holds a string.

  Downscaling is not a nicety. A phone photograph is several megabytes, the
  browser holds about five in total, and a board with thirty residents would
  fill it with the first handful.
*/

export function PhotoPanel({ entity }: { entity: Entity }) {
  const update = useUpdateEntity()
  const inputRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const photo = readString(entity.data.photo)

  const save = (next: string | null) => {
    update.mutate({
      id: entity.id,
      // Spread, because data is replaced wholesale by the provider.
      patch: { data: { ...entity.data, photo: next ?? '' } },
    })
  }

  const choose = async (file: File | undefined) => {
    if (!file) return

    setBusy(true)
    setError(null)
    try {
      const result = await readPhotoFile(file)
      save(result.dataUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That image could not be read.')
    } finally {
      setBusy(false)
      // Cleared so choosing the same file twice still fires a change event.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <Panel>
      <PanelHeader title="Photograph" />
      <PanelBody className="flex items-start gap-4">
        {photo === '' ? (
          <span
            aria-hidden="true"
            className="border-rule bg-paper-sunken text-ink-muted font-display flex size-20 shrink-0 items-center justify-center rounded-[3px] border text-xl"
          >
            {initialsFor(entity.name)}
          </span>
        ) : (
          <img
            src={photo}
            alt={`Photograph of ${entity.name}`}
            className="border-rule size-20 shrink-0 rounded-[3px] border object-cover"
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            className="sr-only"
            aria-label="Choose a photograph"
            onChange={(event) => void choose(event.target.files?.[0])}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              <ImageUp />
              {busy ? 'Working' : photo === '' ? 'Add a photograph' : 'Replace'}
            </Button>

            {photo === '' ? null : (
              <Button
                size="sm"
                variant="ghost"
                className="text-oxblood"
                onClick={() => save(null)}
              >
                <Trash2 />
                Remove
              </Button>
            )}
          </div>

          {error === null ? (
            <p className="text-ink-faint text-xs">
              Stored on the record and kept in this browser until the database is connected.
              Reduced to {MAX_DIMENSION} pixels so a photograph of everybody still fits.
            </p>
          ) : (
            <p role="alert" className="text-oxblood text-xs">
              {error}
            </p>
          )}
        </div>
      </PanelBody>
    </Panel>
  )
}

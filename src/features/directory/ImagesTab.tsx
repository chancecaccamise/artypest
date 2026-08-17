import { ImageUp, Star, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Tooltip } from '@/components/ui/tooltip'
import { useUpdateEntity } from '@/hooks/use-data'
import { useRole } from '@/lib/role'
import { ACCEPTED_TYPES, MAX_DIMENSION, readPhotoFile } from '@/lib/photos'
import type { Entity } from '@/lib/data/types'

/*
  Images on a record.

  The same pipeline the profile photograph uses: chosen from the computer,
  downscaled in the browser, and kept on the record as a data URL until Supabase
  Storage exists. The difference is that this is a list, and one of them can be
  made the photograph that appears on the card and in search.

  A hard ceiling on how many, because these are the one thing here big enough to
  fill the browser's storage on their own, and a refusal with a reason is better
  than a save that silently fails later.
*/

const MAX_IMAGES = 12

/** Reads the stored list, tolerating a record that has never had one. */
export function imagesOf(entity: Entity): string[] {
  const raw = entity.data.images
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && item !== '')
}

export function ImagesTab({ entity }: { entity: Entity }) {
  const update = useUpdateEntity()
  const { canEdit } = useRole()
  const inputRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const images = imagesOf(entity)
  const photo = typeof entity.data.photo === 'string' ? entity.data.photo : ''

  const save = (next: string[], nextPhoto?: string) => {
    update.mutate({
      id: entity.id,
      // Spread, because the provider replaces data wholesale.
      patch: {
        data: {
          ...entity.data,
          images: next,
          ...(nextPhoto === undefined ? {} : { photo: nextPhoto }),
        },
      },
    })
  }

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      setError(`That is the most images one record can hold (${MAX_IMAGES}).`)
      return
    }

    setBusy(true)
    setError(null)
    const added: string[] = []

    try {
      for (const file of [...files].slice(0, room)) {
        const result = await readPhotoFile(file)
        added.push(result.dataUrl)
      }

      const next = [...images, ...added]
      // The first image on a record with no photograph becomes the photograph,
      // because that is what the reader meant by adding it.
      save(next, photo === '' && added[0] !== undefined ? added[0] : undefined)

      if (files.length > room) {
        setError(`Only ${String(room)} more would fit, so the rest were not added.`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That image could not be read.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = (image: string) => {
    const next = images.filter((candidate) => candidate !== image)
    // Removing the image that is also the photograph must not leave a record
    // pointing at something that is gone.
    save(next, photo === image ? (next[0] ?? '') : undefined)
  }

  return (
    <Panel>
      <PanelHeader
        title="Images"
        meta={images.length === 0 ? undefined : `${String(images.length)} of ${String(MAX_IMAGES)}`}
        action={
          canEdit ? (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPTED_TYPES.join(',')}
                className="sr-only"
                aria-label="Choose images"
                onChange={(event) => void add(event.target.files)}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={busy || images.length >= MAX_IMAGES}
                onClick={() => inputRef.current?.click()}
              >
                <ImageUp />
                {busy ? 'Working' : 'Add images'}
              </Button>
            </>
          ) : null
        }
      />

      <PanelBody className="flex flex-col gap-3">
        {error === null ? null : (
          <p role="alert" className="text-oxblood text-13">
            {error}
          </p>
        )}

        {images.length === 0 ? (
          <EmptyState
            title="No images on this record"
            description={`Photographs, scanned plans, and site pictures live here. They are reduced to ${String(MAX_DIMENSION)} pixels and kept in this browser until the database is connected.`}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image, index) => (
              <li key={image.slice(-48) + String(index)} className="border-rule rounded-[3px] border">
                <img
                  src={image}
                  alt={`Image ${String(index + 1)} on ${entity.name}`}
                  className="aspect-square w-full rounded-t-[2px] object-cover"
                />
                {canEdit ? (
                  <div className="border-rule flex items-center justify-between border-t px-1 py-1">
                    <Tooltip
                      label={photo === image ? 'This is the profile photograph' : 'Use as the profile photograph'}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={
                          photo === image
                            ? 'Currently the profile photograph'
                            : 'Use this as the profile photograph'
                        }
                        aria-pressed={photo === image}
                        onClick={() => save(images, image)}
                        className={photo === image ? 'text-moss' : 'text-ink-faint'}
                      >
                        <Star className="size-4" aria-hidden="true" />
                      </Button>
                    </Tooltip>
                    <Tooltip label="Remove">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove image ${String(index + 1)}`}
                        onClick={() => remove(image)}
                        className="text-ink-faint hover:text-oxblood"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  )
}

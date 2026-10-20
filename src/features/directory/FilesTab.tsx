import { Download, FileText, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Tooltip } from '@/components/ui/tooltip'
import { fileUrl, maxFileBytes, useAttachFile, useRemoveFile } from '@/hooks/use-data'
import { isSharedRecords } from '@/lib/data'
import type { Attachment, Entity } from '@/lib/data/types'
import { fileSizeProblem, filesOf, formatFileSize } from '@/lib/files'
import { formatDateTime } from '@/lib/format'
import { useRole } from '@/lib/role'

/*
  Files on a record: warranties, inspection reports, spreadsheets, exports.

  Any kind of file, stored in the association's shared records and described
  on the record, so History says who attached what and when. In the demo there
  is no shared store, so a file is kept inside the record in this browser,
  and the limit says so.
*/
export function FilesTab({ entity }: { entity: Entity }) {
  const attach = useAttachFile()
  const remove = useRemoveFile()
  const { canEdit } = useRole()
  const inputRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The file whose remove button was pressed, waiting on a yes. */
  const [removing, setRemoving] = useState<string | null>(null)

  const files = filesOf(entity)
  const limit = maxFileBytes()

  const add = async (chosen: FileList | null) => {
    if (!chosen || chosen.length === 0) return
    setBusy(true)
    setError(null)
    const problems: string[] = []
    try {
      // One at a time, so each lands on the record as it finishes and a
      // failure partway leaves the ones before it attached.
      for (const file of chosen) {
        const problem = fileSizeProblem(file, limit)
        if (problem) {
          problems.push(problem)
          continue
        }
        try {
          await attach.mutateAsync({ entityId: entity.id, file })
        } catch (caught) {
          problems.push(caught instanceof Error ? caught.message : `${file.name} was not attached.`)
        }
      }
      if (problems.length > 0) setError(problems.join(' '))
    } finally {
      setBusy(false)
      // Cleared so choosing the same file twice still fires a change event.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const discard = (file: Attachment) => {
    setError(null)
    remove
      .mutateAsync({ entityId: entity.id, fileId: file.id })
      .then(() => setRemoving(null))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : `${file.name} could not be removed.`)
      )
  }

  return (
    <Panel>
      <PanelHeader
        title="Files"
        meta={files.length === 0 ? undefined : String(files.length)}
        action={
          canEdit ? (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="sr-only"
                aria-label="Choose files"
                onChange={(event) => void add(event.target.files)}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                <Upload />
                {busy ? 'Uploading' : 'Attach files'}
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

        {files.length === 0 ? (
          <EmptyState
            title="No files attached"
            description={`Warranties, inspection reports, approved plans, spreadsheets, and exports. Any kind of file, up to ${formatFileSize(limit)} each${
              isSharedRecords()
                ? '.'
                : ' while this is the demo, which keeps files in this browser.'
            }`}
          />
        ) : (
          <ul className="divide-rule border-rule divide-y rounded-[3px] border">
            {files.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <FileText className="text-ink-faint size-4 shrink-0" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <button
                    type="button"
                    className="hover:text-survey truncate text-left text-sm hover:underline"
                    onClick={() =>
                      void openFile(file).catch((caught: unknown) => setError(reason(caught, file)))
                    }
                  >
                    {file.name}
                  </button>
                  <span className="text-ink-faint text-xs">
                    {formatFileSize(file.size)} · added {formatDateTime(file.uploadedAt)}
                    {file.uploadedBy ? ` by ${file.uploadedBy}` : ''}
                  </span>
                </div>

                {removing === file.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-ink-muted text-xs">Remove this file?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => discard(file)}
                    >
                      Remove
                    </Button>
                    <Button size="sm" onClick={() => setRemoving(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Tooltip label="Download">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Download ${file.name}`}
                        onClick={() =>
                          void downloadFile(file).catch((caught: unknown) =>
                            setError(reason(caught, file))
                          )
                        }
                      >
                        <Download />
                      </Button>
                    </Tooltip>
                    {canEdit ? (
                      <Tooltip label="Remove">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${file.name}`}
                          className="text-ink-faint hover:text-oxblood"
                          onClick={() => setRemoving(file.id)}
                        >
                          <Trash2 />
                        </Button>
                      </Tooltip>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  )
}

function reason(caught: unknown, file: Attachment): string {
  return caught instanceof Error ? caught.message : `${file.name} could not be opened.`
}

/*
  The tab is opened before the link is asked for. A browser allows a new tab
  only during the click itself, and in the shared records the link takes a
  round trip to arrive, by which time the click is over.
*/
async function openFile(file: Attachment): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const url = await fileUrl(file, false)
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (caught) {
    tab?.close()
    throw caught
  }
}

async function downloadFile(file: Attachment): Promise<void> {
  const link = document.createElement('a')
  link.href = await fileUrl(file, true)
  link.download = file.name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

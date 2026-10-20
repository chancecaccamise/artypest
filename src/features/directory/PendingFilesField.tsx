import { Paperclip, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { fileSizeProblem, formatFileSize } from '@/lib/files'

/*
  Files chosen while a record is being added.

  The record does not exist yet, so there is nowhere to store them: they are
  held here and attached once it is saved. Sizes are checked as they are
  chosen, so the one failure left for after saving is the network.
*/
export function PendingFilesField({
  value,
  onChange,
  maxBytes,
}: {
  value: File[]
  onChange: (files: File[]) => void
  maxBytes: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = (chosen: FileList | null) => {
    if (!chosen) return
    const accepted: File[] = []
    const problems: string[] = []
    for (const file of chosen) {
      const problem = fileSizeProblem(file, maxBytes)
      if (problem) problems.push(problem)
      else accepted.push(file)
    }
    setError(problems.length > 0 ? problems.join(' ') : null)
    onChange([...value, ...accepted])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="border-rule flex flex-col gap-2 border-t pt-4">
      <div>
        <h3 className="font-display text-ink text-sm font-bold">Files</h3>
        <p className="text-ink-muted mt-0.5 text-xs">
          PDFs, spreadsheets, JSON, any kind of file, up to {formatFileSize(maxBytes)} each. They
          are attached as soon as this is saved.
        </p>
      </div>

      <span className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose files to attach"
          onChange={(event) => choose(event.target.files)}
        />
        <Button size="sm" onClick={() => inputRef.current?.click()}>
          <Paperclip />
          Attach files
        </Button>
      </span>

      {error === null ? null : (
        <p role="alert" className="text-oxblood text-13">
          {error}
        </p>
      )}

      {value.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {value.map((file, index) => (
            <li
              key={`${file.name}-${String(index)}`}
              className="border-rule flex items-center gap-2 rounded-[3px] border px-2 py-1 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-ink-faint font-mono text-xs">{formatFileSize(file.size)}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Do not attach ${file.name}`}
                onClick={() => onChange(value.filter((_, position) => position !== index))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

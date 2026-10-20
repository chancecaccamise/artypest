import type { Attachment, Entity } from '@/lib/data/types'

/*
  Files on a record: limits, naming, and reading `data.files` back.

  Any kind of file is accepted. The board keeps warranties as PDFs, inventories
  as spreadsheets, and exports as JSON, and refusing a type it did not think of
  would only send the file somewhere this application cannot see it.
*/

/** The Storage bucket's own limit, 20261020130000_record_files.sql. */
export const SHARED_MAX_FILE_BYTES = 25 * 1024 * 1024

/*
  The demo keeps a file inside the record, as text a third larger than the
  file, in a browser that holds about five megabytes for everything. Two
  ordinary PDFs at the shared limit would fill it.
*/
export const DEMO_MAX_FILE_BYTES = 1024 * 1024

/** "1.4 MB", "212 KB", "640 bytes". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  const megabytes = bytes / (1024 * 1024)
  return `${megabytes < 10 ? megabytes.toFixed(1) : String(Math.round(megabytes))} MB`
}

/** Why `file` cannot be kept, or null when it can. */
export function fileSizeProblem(
  file: Pick<File, 'name' | 'size'>,
  maxBytes: number
): string | null {
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size <= maxBytes) return null
  return `${file.name} is ${formatFileSize(file.size)}. Files can be up to ${formatFileSize(maxBytes)}.`
}

function isAttachment(value: unknown): value is Attachment {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Attachment>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.size === 'number'
  )
}

/** The record's files, tolerating a record that has never had any. */
export function filesOf(entity: Pick<Entity, 'data'>): Attachment[] {
  const raw = entity.data.files
  return Array.isArray(raw) ? raw.filter(isAttachment) : []
}

/** True for a value shaped like `data.files`, so the audit log can name them. */
export function isFileList(value: unknown): value is Attachment[] {
  return Array.isArray(value) && value.length > 0 && value.every(isAttachment)
}

/**
 * Where a file is stored: `<org>/<record>/<file id>/<name>`.
 *
 * The association comes first because the Storage policies read it there. The
 * name is reduced to characters every store accepts; the original is kept on
 * the record and is what a download is saved as.
 */
export function storagePath(orgId: string, entityId: string, fileId: string, name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
  return `${orgId}/${entityId}/${fileId}/${safe}`
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('That file could not be read.'))
    }
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
}

/*
  Photographs of people, before there is anywhere to put them.

  Supabase Storage is not set up, so a photo is downscaled in the browser and
  kept on the record as a data URL. That is not how it should work forever, and
  the reason it is acceptable now is the reason it has to be downscaled: a
  phone photograph is three or four megabytes, the browser will hold about five
  in total, and a board with thirty residents would fill it with the first
  handful.

  Reduced to 320 pixels on the long edge a face is about 25KB, which is plenty
  for the avatar and the record header, and leaves room for a hundred of them.

  When Storage arrives, `readPhotoFile` becomes an upload returning a URL and
  nothing else here changes: the record already holds a string.
*/

/** The long edge, in pixels. A face at this size is legible at any size shown. */
export const MAX_DIMENSION = 320

/** JPEG quality. Above this the gain is invisible and the size is not. */
const QUALITY = 0.8

/** Refused before reading, so a video never becomes a 40MB data URL. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** Refused before reading. Downscaling happens after, so this is generous. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024

export type PhotoError =
  | { kind: 'type'; message: string }
  | { kind: 'size'; message: string }
  | { kind: 'decode'; message: string }

/**
 * The size to draw at, preserving aspect ratio.
 *
 * An image already smaller than the limit is left alone rather than being
 * scaled up into a blurrier version of itself.
 */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_DIMENSION
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max || longest === 0) {
    return { width: Math.max(Math.round(width), 1), height: Math.max(Math.round(height), 1) }
  }

  const ratio = max / longest
  return {
    width: Math.max(Math.round(width * ratio), 1),
    height: Math.max(Math.round(height * ratio), 1),
  }
}

/** Checked before anything is read, so a bad file costs nothing. */
export function validatePhotoFile(file: File): PhotoError | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return {
      kind: 'type',
      message: 'That is not an image. Choose a JPEG, PNG, WebP, or GIF.',
    }
  }

  if (file.size > MAX_FILE_BYTES) {
    return {
      kind: 'size',
      message: 'That image is very large. Choose one under 15MB.',
    }
  }

  return null
}

/** Roughly what a data URL costs in storage: base64 is a third larger. */
export function approximateBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return 0
  return Math.round((dataUrl.length - comma - 1) * 0.75)
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be read.'))
    image.src = source
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // readAsDataURL always yields a string, but the type admits ArrayBuffer,
      // and a buffer stringified would be "[object ArrayBuffer]" as an img src.
      const { result } = reader
      if (typeof result === 'string') resolve(result)
      else reject(new Error('The file could not be read as an image.'))
    }
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

export interface PhotoResult {
  /** A data URL, ready to store on the record and to use as an img src. */
  dataUrl: string
  width: number
  height: number
  bytes: number
}

/**
 * Reads a chosen file and returns a downscaled JPEG data URL.
 *
 * Always re-encodes, even for an image already small enough, because the point
 * is a predictable size on the record rather than whatever the camera produced.
 * Transparency is flattened onto white: a PNG with an alpha channel would
 * otherwise come back with black where it was see-through.
 */
export async function readPhotoFile(file: File): Promise<PhotoResult> {
  const invalid = validatePhotoFile(file)
  if (invalid) throw new Error(invalid.message)

  const source = await readAsDataUrl(file)
  const image = await loadImage(source)

  const { width, height } = fitWithin(image.naturalWidth || image.width, image.naturalHeight || image.height)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize images.')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)

  return { dataUrl, width, height, bytes: approximateBytes(dataUrl) }
}

/** Initials for the placeholder shown when there is no photograph. */
export function initialsFor(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word))

  if (words.length === 0) return '?'
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase()

  const first = (words[0] ?? '').charAt(0)
  const last = (words[words.length - 1] ?? '').charAt(0)
  return `${first}${last}`.toUpperCase()
}

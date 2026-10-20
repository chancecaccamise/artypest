import { beforeEach, describe, expect, it } from 'vitest'

import { createFakeRemote, type FakeRemote } from '@/test/fake-remote'
import { buildDemoData } from '@/lib/data/fixtures'
import { createMemoryProvider } from '@/lib/data/memory-provider'
import { withStableIds } from '@/lib/data/stable-ids'
import { createSyncedProvider } from '@/lib/data/synced-provider'
import type { DataProvider, DataSnapshot } from '@/lib/data/types'

import {
  DEMO_MAX_FILE_BYTES,
  fileSizeProblem,
  filesOf,
  formatFileSize,
  SHARED_MAX_FILE_BYTES,
  storagePath,
} from './files'

const REFERENCE = new Date('2026-10-20T00:00:00.000Z')
const ORG = {
  id: 'a1b2c3d4-0000-4000-a000-000000000001',
  name: 'Thomas Square Neighborhood Association',
  sagisUrlTemplate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function pdf(name = 'warranty.pdf', bytes = 2048): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })
}

describe('file helpers', () => {
  it('reads sizes the way a person says them', () => {
    expect(formatFileSize(640)).toBe('640 bytes')
    expect(formatFileSize(212 * 1024)).toBe('212 KB')
    expect(formatFileSize(1.4 * 1024 * 1024)).toBe('1.4 MB')
    expect(formatFileSize(SHARED_MAX_FILE_BYTES)).toBe('25 MB')
  })

  it('refuses an empty file and one over the limit, with the reason', () => {
    expect(fileSizeProblem({ name: 'a.pdf', size: 0 }, 100)).toBe('a.pdf is empty.')
    expect(fileSizeProblem({ name: 'a.pdf', size: 2 * 1024 * 1024 }, DEMO_MAX_FILE_BYTES)).toBe(
      'a.pdf is 2.0 MB. Files can be up to 1.0 MB.'
    )
    expect(fileSizeProblem({ name: 'a.pdf', size: 100 }, 100)).toBeNull()
  })

  it('stores under the association first, which is what the bucket policies read', () => {
    expect(storagePath('org', 'rec', 'file', 'Pool pump (2024) warranty.pdf')).toBe(
      'org/rec/file/Pool_pump_2024_warranty.pdf'
    )
  })

  it('reads a record that has never had files as having none', () => {
    expect(filesOf({ data: {} })).toEqual([])
    expect(filesOf({ data: { files: [{ nonsense: true }] } })).toEqual([])
  })
})

let remote: FakeRemote

async function synced(): Promise<DataProvider> {
  const baseline: DataSnapshot = withStableIds(
    buildDemoData(REFERENCE, [], { includeTemporaryData: false })
  ).data
  remote = createFakeRemote({
    org: ORG,
    relationTypes: baseline.relationTypes.map((type) => ({ ...type, id: `db-${type.key}` })),
  })
  return createSyncedProvider({ remote, baseline, snapshot: await remote.loadAll() })
}

describe.each([
  [
    'in the demo',
    () =>
      Promise.resolve(
        createMemoryProvider(buildDemoData(REFERENCE, [], { includeTemporaryData: false }))
      ),
  ],
  ['in the shared records', synced],
])('files on a record %s', (_, open) => {
  let data: DataProvider

  beforeEach(async () => {
    data = await open()
  })

  it('attaches a file to the record and keeps what else the record holds', async () => {
    const asset = await data.createEntity({
      type: 'asset',
      name: 'Pool pump',
      data: { condition: 'good' },
    })
    const saved = await data.attachFile(asset.id, pdf())

    expect(saved.data.condition).toBe('good')
    expect(filesOf(saved)).toEqual([
      expect.objectContaining({
        name: 'warranty.pdf',
        size: 2048,
        contentType: 'application/pdf',
      }),
    ])
  })

  it('refuses a file over the limit before storing anything', async () => {
    const asset = await data.createEntity({ type: 'asset', name: 'Pool pump' })
    const tooBig = pdf('manual.pdf', data.maxFileBytes + 1)
    await expect(data.attachFile(asset.id, tooBig)).rejects.toThrow(/manual\.pdf is/)
    expect(filesOf((await data.getEntity(asset.id)) ?? { data: {} })).toEqual([])
  })

  it('removes one file and leaves the others', async () => {
    const asset = await data.createEntity({ type: 'asset', name: 'Pool pump' })
    await data.attachFile(asset.id, pdf('warranty.pdf'))
    const both = await data.attachFile(asset.id, pdf('specs.json'))
    const [first] = filesOf(both)

    const after = await data.removeFile(asset.id, first?.id ?? '')
    expect(filesOf(after).map((file) => file.name)).toEqual(['specs.json'])
  })

  it('hands back a link to open the file', async () => {
    const asset = await data.createEntity({ type: 'asset', name: 'Pool pump' })
    const [file] = filesOf(await data.attachFile(asset.id, pdf()))
    if (!file) throw new Error('No file attached')
    expect(await data.getFileUrl(file)).toMatch(/^(blob:|data:application\/pdf|https:)/)
  })
})

describe('files in the shared records', () => {
  it('stores the bytes under the association and the record, and deletes them on removal', async () => {
    const data = await synced()
    const asset = await data.createEntity({ type: 'asset', name: 'Pool pump' })
    const [file] = filesOf(await data.attachFile(asset.id, pdf()))
    if (!file) throw new Error('No file attached')

    expect(file.path).toBe(`${ORG.id}/${asset.id}/${file.id}/warranty.pdf`)
    expect(remote.storedPaths()).toEqual([file.path])
    // A download is saved under the name it had, not the stored one.
    expect(await data.getFileUrl(file, { download: true })).toContain('download=warranty.pdf')

    await data.removeFile(asset.id, file.id)
    expect(remote.storedPaths()).toEqual([])
  })
})

describe('files in the demo', () => {
  it('logs the file by name in History, never as its contents', async () => {
    const data = createMemoryProvider(buildDemoData(REFERENCE, [], { includeTemporaryData: false }))
    const asset = await data.createEntity({ type: 'asset', name: 'Pool pump' })
    await data.attachFile(asset.id, pdf('warranty.pdf'))
    const [file] = filesOf((await data.getEntity(asset.id)) ?? { data: {} })
    await data.removeFile(asset.id, file?.id ?? '')

    const history = (await data.listAuditEntries(asset.id))
      .filter((entry) => entry.fieldName === 'data.files')
      .map((entry) => [entry.oldValue, entry.newValue])
    expect(history).toEqual(
      expect.arrayContaining([
        [null, 'warranty.pdf'],
        ['warranty.pdf', null],
      ])
    )
  })
})

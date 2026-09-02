import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, ChevronDown, Pencil, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { IdChip } from '@/components/ui/id-chip'
import { Notice } from '@/components/ui/empty-state'
import { Panel, PanelBody } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { TabPanel, Tabs, type TabDefinition } from '@/components/ui/tabs'
import { ConnectionsTab } from '@/features/directory/ConnectionsTab'
import { DetailsTab } from '@/features/directory/DetailsTab'
import { EntityFormDialog } from '@/features/directory/EntityFormDialog'
import { FilesTab } from '@/features/directory/FilesTab'
import { ImagesTab, imagesOf } from '@/features/directory/ImagesTab'
import { HistoryTab } from '@/features/directory/HistoryTab'
import { NotesTab } from '@/features/directory/NotesTab'
import { RecordsTab } from '@/features/directory/RecordsTab'
import { DIRECTORY_CONFIGS } from '@/features/directory/config'
import { ReviewToggle, reviewSentence } from '@/features/review/ReviewMark'
import {
  useArchiveEntity,
  useDeleteEntity,
  useEntity,
  useRelations,
  useOrg,
  useRestoreEntity,
  useReviewIndex,
} from '@/hooks/use-data'
import { ENTITY_TYPE_LABELS, type EntityType } from '@/lib/data/types'
import { formatDateTime } from '@/lib/format'
import { stateFor } from '@/lib/review/status'
import { useRole } from '@/lib/role'

const TABS: TabDefinition[] = [
  { value: 'details', label: 'Details' },
  { value: 'images', label: 'Images' },
  { value: 'connections', label: 'Connections' },
  { value: 'records', label: 'Records' },
  { value: 'files', label: 'Files' },
  { value: 'notes', label: 'Notes' },
  { value: 'history', label: 'History' },
]

export function DirectoryDetailPage({ type }: { type: EntityType }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const config = DIRECTORY_CONFIGS[type]
  const { canEdit, canSeeNotes } = useRole()

  const entityQuery = useEntity(id)
  /** For the connection count on the tab strip. */
  const relationsQuery = useRelations(id)
  const org = useOrg()
  const reviewIndex = useReviewIndex()

  const archiveEntity = useArchiveEntity()
  const restoreEntity = useRestoreEntity()
  const deleteEntity = useDeleteEntity()

  const [params, setParams] = useSearchParams()
  const [editOpen, setEditOpen] = useState(false)
  const [focusField, setFocusField] = useState<string | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const requested = params.get('tab') ?? 'details'
  const tab = TABS.some((candidate) => candidate.value === requested) ? requested : 'details'

  /*
    Counts on the tabs, so a reader can see there are two connections and no
    images without opening either. A zero is shown rather than hidden: "nothing
    here" is an answer to the question they were about to ask.
  */
  const tabs = useMemo(() => {
    const current = entityQuery.data
    const connections = (relationsQuery.data ?? []).filter(
      (relation) => relation.deletedAt === null
    ).length

    const withCounts = TABS.map((definition) => {
      if (definition.value === 'images') {
        return { ...definition, count: current ? imagesOf(current).length : undefined }
      }
      if (definition.value === 'connections') {
        return { ...definition, count: relationsQuery.data ? connections : undefined }
      }
      return definition
    })

    return canSeeNotes ? withCounts : withCounts.filter((item) => item.value !== 'notes')
  }, [canSeeNotes, entityQuery.data, relationsQuery.data])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const setTab = (next: string) => {
    const search = new URLSearchParams(params)
    if (next === 'details') search.delete('tab')
    else search.set('tab', next)
    setParams(search, { replace: true })
  }

  if (entityQuery.isLoading) {
    return (
      <>
        <Skeleton className="mb-3 h-9 w-72" />
        <Skeleton className="mb-4 h-5 w-48" />
        <Panel>
          <PanelBody className="flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </PanelBody>
        </Panel>
      </>
    )
  }

  const entity = entityQuery.data

  if (!entity || entity.type !== type) {
    return (
      <>
        <PageHeader
          title="Record not found"
          breadcrumbs={[{ label: config.title, to: config.path }, { label: 'Not found' }]}
        />
        <Panel>
          <PanelBody>
            <Notice tone="warning">
              This {config.singular.toLowerCase()} does not exist, or it was deleted. Go back to{' '}
              <Link to={config.path} className="text-survey underline">
                {config.title}
              </Link>
              .
            </Notice>
          </PanelBody>
        </Panel>
      </>
    )
  }

  const chips = config.chips(entity)
  const archived = entity.archivedAt !== null
  const reviewState = stateFor(reviewIndex.data, entity.id)
  const reviewStatus = reviewIndex.data?.byEntity.get(entity.id)

  return (
    <>
      <PageHeader
        size="record"
        breadcrumbs={[{ label: config.title, to: config.path }, { label: entity.name }]}
        title={entity.name}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={entity.type}>{ENTITY_TYPE_LABELS[entity.type].singular}</TypeBadge>
            {chips.map((chip) => (
              <IdChip key={`${chip.prefix ?? ''}${chip.value}`} prefix={chip.prefix} title={chip.title}>
                {chip.value}
              </IdChip>
            ))}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-mono">Last changed {formatDateTime(entity.updatedAt)}</span>
            <span className="text-ink-faint" aria-hidden="true">
              &middot;
            </span>
            <span>{reviewSentence(reviewState, reviewStatus)}</span>
          </span>
        }
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              {/*
                Checking is the most repeated action of the whole reconciliation
                job, so it sits in the open beside the record rather than inside
                the menu. Everything in the menu is done once per record; this
                is done to every record.
              */}
              <ReviewToggle
                entityId={entity.id}
                state={reviewState}
                status={reviewStatus}
                className="h-9 px-3 text-sm"
              />
              <div className="relative" ref={menuRef}>
              <Button
                variant="secondary"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                Actions
                <ChevronDown />
              </Button>

              {menuOpen ? (
                <div
                  role="menu"
                  className="panel panel-enter absolute right-0 z-30 mt-1 w-48 p-1"
                  style={{
                    boxShadow: '0 8px 24px -10px color-mix(in srgb, var(--ink) 35%, transparent)',
                  }}
                >
                  <MenuItem
                    onClick={() => {
                      setFocusField(undefined)
                      setEditOpen(true)
                      setMenuOpen(false)
                    }}
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </MenuItem>

                  {archived ? (
                    <MenuItem
                      onClick={() => {
                        restoreEntity.mutate(entity.id)
                        setMenuOpen(false)
                      }}
                    >
                      <ArchiveRestore className="size-3.5" />
                      Restore
                    </MenuItem>
                  ) : (
                    <MenuItem
                      onClick={() => {
                        archiveEntity.mutate(entity.id)
                        setMenuOpen(false)
                      }}
                    >
                      <Archive className="size-3.5" />
                      Archive
                    </MenuItem>
                  )}

                  <MenuItem
                    tone="destructive"
                    onClick={() => {
                      setConfirmDelete(true)
                      setMenuOpen(false)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </MenuItem>
                </div>
                ) : null}
              </div>
            </div>
          ) : null
        }
      />

      {archived ? (
        <Notice tone="warning" className="mb-4">
          <span className="flex flex-wrap items-center gap-3">
            <span>
              This {config.singular.toLowerCase()} is archived. It stays in the records and in the
              history, but it is out of the active working set.
            </span>
            {canEdit ? (
              <Button size="sm" onClick={() => restoreEntity.mutate(entity.id)}>
                Restore
              </Button>
            ) : null}
          </span>
        </Notice>
      ) : null}

      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-4" />

      <TabPanel value="details" active={tab === 'details'}>
        <DetailsTab
          entity={entity}
          org={org.data}
          onAddParcelRecord={() => {
            setFocusField('pin')
            setEditOpen(true)
          }}
        />
      </TabPanel>
      <TabPanel value="images" active={tab === 'images'}>
        {entity ? <ImagesTab entity={entity} /> : null}
      </TabPanel>

      <TabPanel value="connections" active={tab === 'connections'}>
        <ConnectionsTab entity={entity} />
      </TabPanel>
      <TabPanel value="records" active={tab === 'records'}>
        <RecordsTab entity={entity} />
      </TabPanel>
      <TabPanel value="files" active={tab === 'files'}>
        <FilesTab />
      </TabPanel>
      <TabPanel value="notes" active={tab === 'notes'}>
        <NotesTab entity={entity} />
      </TabPanel>
      <TabPanel value="history" active={tab === 'history'}>
        <HistoryTab entity={entity} />
      </TabPanel>

      <EntityFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        type={type}
        entity={entity}
        focusField={focusField}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${entity.name}?`}
        description="Deleting is a soft delete: the record leaves every list but stays recoverable and stays in the audit log. It is not the same as archiving."
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                void deleteEntity.mutateAsync(entity.id).then(() => {
                  setConfirmDelete(false)
                  navigate(config.path)
                })
              }}
            >
              Delete {config.singular.toLowerCase()}
            </Button>
          </>
        }
      >
        <p className="text-ink-muted text-sm">
          Archive instead if this record is simply no longer active. Archived records keep appearing
          in connections and history, which is usually what a board wants.
        </p>
      </Dialog>
    </>
  )
}

function MenuItem({
  onClick,
  children,
  tone = 'default',
}: {
  onClick: () => void
  children: React.ReactNode
  tone?: 'default' | 'destructive'
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        tone === 'destructive'
          ? 'text-oxblood hover:bg-paper-sunken flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-13 transition-colors duration-[120ms]'
          : 'text-ink hover:bg-paper-sunken flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-13 transition-colors duration-[120ms]'
      }
    >
      {children}
    </button>
  )
}

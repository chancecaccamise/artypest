import { useCallback, useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IdChip } from '@/components/ui/id-chip'
import { EmptyState, Notice } from '@/components/ui/empty-state'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { applyOwnerPlan } from '@/features/owners/apply'
import { reconcileOwners, summarizeOwners, type OwnerGroup } from '@/features/owners/reconcile'
import { useGraph } from '@/hooks/use-data'
import { data } from '@/lib/data'
import { cn } from '@/lib/utils'

/*
  Reconciling the county's owner field against the directory, for the whole
  layer at once.

  The parcel import does this a handful of parcels at a time, which is right for
  an import somebody is watching and wrong for 13,493 distinct owner names. This
  screen is the bulk case, and it is built around one rule: the safe decisions
  are applied together, and everything doubtful waits for a person.
*/

/** Kept well under the point where a browser stops enjoying itself. */
const REVIEW_PAGE_SIZE = 40

export function OwnerReconcilePage() {
  const queryClient = useQueryClient()
  const { graph } = useGraph()

  const [applied, setApplied] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [shown, setShown] = useState(REVIEW_PAGE_SIZE)

  const groups = useMemo(() => {
    if (!graph) return []
    const properties = graph.entities.filter((entity) => entity.type === 'property')
    const candidates = graph.entities.filter(
      (entity) =>
        entity.type === 'person' || entity.type === 'business' || entity.type === 'association'
    )
    return reconcileOwners({ properties, candidates })
  }, [graph])

  const summary = useMemo(() => summarizeOwners(groups), [groups])
  const actionable = useMemo(
    () => groups.filter((group) => group.verdict === 'link' || group.verdict === 'create'),
    [groups]
  )
  const review = useMemo(() => groups.filter((group) => group.verdict === 'review'), [groups])

  const apply = useCallback(() => {
    if (!graph) return
    const ownsType = graph.relationTypes.find((type) => type.key === 'owns')
    if (!ownsType) return

    const byId = new Map(graph.entities.map((entity) => [entity.id, entity]))

    setApplying(true)
    setProgress({ done: 0, total: actionable.length })
    void applyOwnerPlan({
      provider: data,
      groups: actionable,
      ownsRelationTypeId: ownsType.id,
      propertiesById: byId,
      onProgress: (done, total) => {
        setProgress({ done, total })
      },
    })
      .then(async (result) => {
        // This workflow calls the provider directly rather than through a
        // mutation hook. Refresh every reader of the changed graph and audit
        // trail before reporting completion.
        await queryClient.invalidateQueries()
        setApplied(
          `${result.ownersCreated.toLocaleString()} owners created, ${result.ownersLinked.toLocaleString()} linked, ` +
            `${result.relationsCreated.toLocaleString()} ownerships recorded.` +
            (result.relationsSkipped > 0
              ? ` ${result.relationsSkipped.toLocaleString()} were already on file.`
              : '')
        )
      })
      .finally(() => {
        setApplying(false)
        setProgress(null)
      })
  }, [graph, actionable, queryClient])

  if (!graph) {
    return (
      <>
        <PageHeader title="Owner reconciliation" subtitle="Reading the county's owner field" />
        <Panel>
          <PanelBody>
            <Skeleton className="h-64 w-full" />
          </PanelBody>
        </Panel>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Owner reconciliation"
        subtitle="Every owner the county names, against the records already here"
      />

      <Panel>
        <PanelHeader
          title="What the county says"
          action={
            <StatusBadge tone="neutral">
              {summary.owners.toLocaleString()} owners on {summary.parcels.toLocaleString()} lots
            </StatusBadge>
          }
        />
        <PanelBody className="flex flex-col gap-4">
          <p className="text-ink-muted text-13 max-w-3xl">
            One owner is one record however many lots they hold. The safe decisions below can be
            applied together and are audited as one batch. Everything the rules could not read
            confidently waits for a person, because creating a record is reversible and attaching a
            lot to the wrong resident is not.
          </p>

          <dl className="grid max-w-3xl gap-x-8 gap-y-2 sm:grid-cols-3">
            <Figure label="Already in the directory" value={summary.link} tone="moss" />
            <Figure label="New records to create" value={summary.create} tone="survey" />
            <Figure label="Need a person to read them" value={summary.review} tone="amber" />
          </dl>

          {summary.truncated > 0 ? (
            <Notice tone="info">
              <span>
                {summary.truncated.toLocaleString()} of those are truncated at 40 characters by the
                county before the data reaches us. The end of the name is gone and nothing here can
                recover it: those need the county's own record, not a better reading.
              </span>
            </Notice>
          ) : null}

          {/*
            Worth saying before somebody presses the button. In the demo the
            store lives in this browser, and eleven thousand records plus their
            ownerships plus the audit rows behind both is several times what
            localStorage holds. The work happens and is correct; it will not
            survive a reload until Postgres is behind this, and the save failure
            is reported in Settings rather than swallowed.
          */}
          {data.kind === 'memory' && actionable.length > 500 ? (
            <Notice tone="warning">
              <span>
                This is running on demo data kept in this browser. Applying{' '}
                {actionable.length.toLocaleString()} decisions is more than local storage can hold,
                so the result will be correct on screen but will not survive a reload. Connect the
                database first if you want it kept.
              </span>
            </Notice>
          ) : null}

          {applied ? <Notice tone="info">{applied}</Notice> : null}
        </PanelBody>
        <PanelFooter className="flex-wrap gap-y-2">
          <span>
            {progress
              ? `Writing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`
              : 'Applied as one audited batch, so the Activity feed can show exactly what this wrote.'}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={apply}
            disabled={applying || actionable.length === 0}
          >
            <Users />
            {applying
              ? 'Applying'
              : `Apply ${actionable.length.toLocaleString()} safe ${actionable.length === 1 ? 'decision' : 'decisions'}`}
          </Button>
        </PanelFooter>
      </Panel>

      <Panel className="mt-4">
        <PanelHeader
          title="Needs a person"
          action={
            <StatusBadge tone={review.length === 0 ? 'moss' : 'amber'}>
              {review.length.toLocaleString()}
            </StatusBadge>
          }
        />
        <PanelBody className="flex flex-col gap-3">
          {review.length === 0 ? (
            <EmptyState
              title="Nothing is waiting"
              description="Every owner name the county filed was read confidently."
            />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {review.slice(0, shown).map((group) => (
                  <ReviewRow key={group.raw} group={group} />
                ))}
              </ul>
              {review.length > shown ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setShown((current) => current + REVIEW_PAGE_SIZE)
                  }}
                >
                  Show {Math.min(REVIEW_PAGE_SIZE, review.length - shown)} more
                </Button>
              ) : null}
            </>
          )}
        </PanelBody>
        {review.length > 0 ? (
          <PanelFooter>
            <span>
              These are the names no rule could read confidently. Opening the lot shows the county's
              record beside them, which is usually enough to say who the owner is.
            </span>
          </PanelFooter>
        ) : null}
      </Panel>
    </>
  )
}

function Figure({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-ink-muted text-13">{label}</dt>
      <dd className={cn('font-display text-xl font-bold', `text-${tone}`)}>
        {value.toLocaleString()}
      </dd>
    </div>
  )
}

function ReviewRow({ group }: { group: OwnerGroup }) {
  return (
    <li className="border-rule rounded-[6px] border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink text-13 font-mono break-words">{group.raw}</p>
          <p className="text-ink-muted text-13 mt-1">{group.reason}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <IdChip prefix="lots">{String(group.propertyIds.length)}</IdChip>
          {group.parsed.truncated ? <StatusBadge tone="amber">truncated</StatusBadge> : null}
        </div>
      </div>
    </li>
  )
}

export default OwnerReconcilePage

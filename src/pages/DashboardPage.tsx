import { PageHeader } from '@/components/layout/PageHeader'
import { Notice } from '@/components/ui/empty-state'
import { NeedsAttentionPanel, RecentActivityPanel } from '@/features/dashboard/widgets'
import { useGraph, useOrg } from '@/hooks/use-data'

/*
  The default landing page. Two rows, full width:

    1. Needs attention
    2. Recent activity

  The board asked for only these two while they work with the records and
  decide what else belongs here. The stat strip, Board and committees,
  Occupancy, and Quick add are still in src/features/dashboard/widgets.tsx,
  ready to be put back.

  Every widget owns its own loading skeleton and empty state, so a slow or
  empty section never blanks the page.
*/
export function DashboardPage() {
  const org = useOrg()
  const { graph, isError } = useGraph()

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={org.data ? `${org.data.name}, at a glance` : 'Loading the association'}
      />

      {isError ? (
        <Notice tone="error" className="mb-4">
          The dashboard could not read the records. Reload the page. If it keeps happening, the data
          layer is misconfigured.
        </Notice>
      ) : null}

      <div className="mb-4">
        <NeedsAttentionPanel graph={graph} />
      </div>

      <RecentActivityPanel />
    </>
  )
}

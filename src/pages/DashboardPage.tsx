import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Notice } from '@/components/ui/empty-state'
import {
  BoardPanel,
  MapPreviewPanel,
  NeedsAttentionPanel,
  OccupancyPanel,
  QuickAddPanel,
  RecentActivityPanel,
  StatStrip,
} from '@/features/dashboard/widgets'
import { BoardEditorDialog } from '@/features/dashboard/BoardEditorDialog'
import { EntityFormDialog } from '@/features/directory/EntityFormDialog'
import { useGraph, useOrg } from '@/hooks/use-data'
import type { EntityType } from '@/lib/data/types'
import { useRole } from '@/lib/role'

/*
  The default landing page. Four rows:

    1. Stat strip
    2. Needs attention (two thirds) and Board and committees (one third)
    3. Recent activity (two thirds) and Occupancy (one third)
    4. Quick add (half) and Connection Map (half)

  Every widget owns its own loading skeleton and empty state, so a slow or
  empty section never blanks the page.
*/
export function DashboardPage() {
  const org = useOrg()
  const { graph, isError } = useGraph()
  const { canEdit } = useRole()

  const [addType, setAddType] = useState<EntityType | null>(null)
  const [boardEditorOpen, setBoardEditorOpen] = useState(false)

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

      <StatStrip graph={graph} />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NeedsAttentionPanel graph={graph} />
        </div>
        <BoardPanel graph={graph} onManage={() => setBoardEditorOpen(true)} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentActivityPanel />
        </div>
        <OccupancyPanel graph={graph} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <QuickAddPanel disabled={!canEdit} onAdd={(type) => setAddType(type)} />
        <MapPreviewPanel graph={graph} />
      </div>

      {addType ? <EntityFormDialog open onClose={() => setAddType(null)} type={addType} /> : null}

      {graph ? (
        <BoardEditorDialog
          open={boardEditorOpen}
          onClose={() => setBoardEditorOpen(false)}
          graph={graph}
        />
      ) : null}
    </>
  )
}

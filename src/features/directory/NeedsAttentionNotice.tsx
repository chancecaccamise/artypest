import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useGraph } from '@/hooks/use-data'
import type { Entity } from '@/lib/data/types'
import { daysUntil, formatDate, formatRelativeDays } from '@/lib/format'
import { needsAttentionFor, type AttentionItem, type AttentionKind } from '@/lib/insights'
import { useRole } from '@/lib/role'
import { cn } from '@/lib/utils'

/*
  The dashboard's Needs attention lines, on the record they are about.

  Somebody who clicks "term ends" on the dashboard arrives here to do something
  about it, and a record page with no trace of the reason they came is a dead
  end. The lines are the dashboard's own, word for word, so they are
  recognisably the thing that was clicked.

  Each line offers the one place the fix happens. Nothing is shown at all when
  nothing needs attention, which is most records.
*/

export interface NeedsAttentionNoticeProps {
  entity: Entity
  onOpenConnections: () => void
  /** Opens the edit form with this field focused. */
  onEditField: (fieldKey: string) => void
}

interface Fix {
  label: string
  run: () => void
}

export function NeedsAttentionNotice({
  entity,
  onOpenConnections,
  onEditField,
}: NeedsAttentionNoticeProps) {
  const { graph } = useGraph()
  const { canEdit } = useRole()

  const items = useMemo(
    () => (graph ? needsAttentionFor(graph, entity.id) : []),
    [graph, entity.id]
  )

  if (items.length === 0) return null

  const fixFor = (kind: AttentionKind): Fix | null => {
    switch (kind) {
      // Terms, contracts, insurance, and ownership are all dated connections.
      case 'term':
      case 'contract':
      case 'insurance':
      case 'no-owner':
        return { label: 'Open connections', run: onOpenConnections }
      case 'no-pin':
        return canEdit ? { label: 'Add parcel number', run: () => onEditField('pin') } : null
      case 'no-contact':
        return canEdit ? { label: 'Add email or phone', run: () => onEditField('email') } : null
      case 'follow-up':
        return canEdit
          ? { label: 'Change follow-up date', run: () => onEditField('followUpDate') }
          : null
    }
  }

  return (
    <Panel role="region" aria-label="Needs attention" className="mb-4 overflow-hidden">
      <PanelHeader
        title="Needs attention"
        meta={items.length > 1 ? `${items.length}` : undefined}
      />
      <ul className="divide-rule divide-y">
        {items.map((item) => (
          <AttentionLine key={item.id} item={item} fix={fixFor(item.kind)} />
        ))}
      </ul>
    </Panel>
  )
}

function AttentionLine({ item, fix }: { item: AttentionItem; fix: Fix | null }) {
  const overdue = item.urgency === 'overdue'

  return (
    <li
      className={cn(
        // The same edge the dashboard draws: red overdue, amber coming up, none for a gap.
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l-[3px] px-3 py-2',
        overdue
          ? 'border-l-oxblood'
          : item.urgency === 'approaching'
            ? 'border-l-amber'
            : 'border-l-transparent'
      )}
    >
      <span className="text-ink text-13 min-w-0 flex-1">{item.description}</span>

      <span className="text-ink-faint hidden shrink-0 font-mono text-[0.6875rem] sm:inline">
        {item.source}
      </span>

      {item.date ? (
        <span
          className={cn(
            'shrink-0 font-mono text-xs whitespace-nowrap',
            overdue ? 'text-oxblood' : 'text-ink-muted'
          )}
        >
          {formatDate(item.date)}, {formatRelativeDays(daysUntil(item.date))}
        </span>
      ) : null}

      {fix ? (
        <Button size="sm" onClick={fix.run} className="shrink-0">
          {fix.label}
        </Button>
      ) : null}
    </li>
  )
}

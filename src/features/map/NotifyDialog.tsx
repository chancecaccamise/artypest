import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'

import { buildNotifyList, notifyListAsText } from './spatial'
import { entityHref } from '@/components/layout/nav-config'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState, Notice } from '@/components/ui/empty-state'
import { Field, Select } from '@/components/ui/field'
import { IdChip } from '@/components/ui/id-chip'
import { Table, TableWrap, Tbody, Td, Th, Thead, Tr } from '@/components/ui/table'
import type { Entity, LocationIndex } from '@/lib/data/types'
import type { ResolvedGraph } from '@/lib/insights'

/*
  Notify adjacent owners. See docs/MAP-SPEC.md section 6.

  This is the spatial query that earns its keep: it produces the mailing list an
  architectural review notification needs, de-duplicated by owner, with the
  lots each owner holds and the gaps called out rather than quietly dropped.

  A notice that was never sent is the thing that voids the decision later, so
  every adjacent lot with nobody to write to is listed explicitly.
*/

const RADIUS_OPTIONS = [
  { value: '', label: 'Lots sharing a boundary' },
  { value: '150', label: 'Within 150 feet' },
  { value: '300', label: 'Within 300 feet' },
  { value: '500', label: 'Within 500 feet' },
]

export interface NotifyDialogProps {
  open: boolean
  onClose: () => void
  subject: Entity
  subjectPin: string
  graph: ResolvedGraph
  locations: LocationIndex
}

export function NotifyDialog({
  open,
  onClose,
  subject,
  subjectPin,
  graph,
  locations,
}: NotifyDialogProps) {
  const [radius, setRadius] = useState('')
  const [copied, setCopied] = useState(false)

  const list = useMemo(
    () =>
      buildNotifyList({
        subjectPin,
        graph,
        locations,
        radiusFeet: radius === '' ? undefined : Number(radius),
      }),
    [subjectPin, graph, locations, radius]
  )

  const copy = () => {
    void navigator.clipboard?.writeText(notifyListAsText(list)).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Notify adjacent owners"
      description={`Everyone the association would write to about ${subject.name}.`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={copy} disabled={list.recipients.length === 0}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy mailing list'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Who counts as a neighbour" className="w-64">
            <Select value={radius} onChange={(event) => setRadius(event.target.value)}>
              {RADIUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <p className="text-ink-muted text-13">
            <span className="text-ink font-display text-lg font-bold">
              {list.recipients.length}
            </span>{' '}
            owners across{' '}
            <span className="text-ink font-display text-lg font-bold">{list.parcels.length}</span>{' '}
            lots
          </p>
        </div>

        {list.recipients.length === 0 ? (
          <EmptyState
            title="No neighbouring owners on file"
            description="Either this lot has no recorded neighbours, or none of them have a current owner. Widen the radius, or record the ownership first."
          />
        ) : (
          <TableWrap>
            <Table>
              <Thead>
                <tr>
                  <Th>Owner</Th>
                  <Th>Mailing address</Th>
                  <Th className="w-56">Lots</Th>
                </tr>
              </Thead>
              <Tbody>
                {list.recipients.map((recipient) => (
                  <Tr key={recipient.ownerId}>
                    <Td>
                      <span className="flex flex-wrap items-center gap-2">
                        <Link
                          to={entityHref(recipient.ownerType, recipient.ownerId)}
                          className="text-ink hover:text-survey font-medium hover:underline"
                        >
                          {recipient.ownerName}
                        </Link>
                        {recipient.unreachable ? (
                          <StatusBadge tone="oxblood">no contact details</StatusBadge>
                        ) : null}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs">
                      {recipient.mailingAddress ?? (
                        <span className="text-oxblood font-sans">No address on file</span>
                      )}
                    </Td>
                    <Td className="text-ink-muted text-xs">
                      {recipient.lots.map((lot) => lot.propertyName).join(', ')}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableWrap>
        )}

        {list.parcelsWithNoOwner.length > 0 ? (
          <Notice tone="warning">
            <span>
              {list.parcelsWithNoOwner.length} neighbouring{' '}
              {list.parcelsWithNoOwner.length === 1 ? 'lot has' : 'lots have'} no current owner on
              file, so nobody would be notified for{' '}
              {list.parcelsWithNoOwner.length === 1 ? 'it' : 'them'}:{' '}
              <span className="font-mono text-xs">
                {list.parcelsWithNoOwner
                  .map((parcel) => parcel.propertyName ?? parcel.pin)
                  .join(', ')}
              </span>
            </span>
          </Notice>
        ) : null}

        <div className="text-ink-faint flex flex-wrap items-center gap-2 text-xs">
          <span>Subject lot</span>
          <IdChip prefix="PIN">{subjectPin}</IdChip>
        </div>
      </div>
    </Dialog>
  )
}

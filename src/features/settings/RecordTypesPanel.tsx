import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/empty-state'
import { Checkbox, Field, Input } from '@/components/ui/field'
import { IdChip } from '@/components/ui/id-chip'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, Tbody, Td, Th, Thead, Tr } from '@/components/ui/table'
import {
  useAllEntities,
  useCreateReferenceItem,
  useDeleteReferenceItem,
  useReferenceItems,
  useUpdateReferenceItem,
} from '@/hooks/use-data'
import type { ReferenceItem } from '@/lib/data/types'
import { referenceRemovalBlocker, referenceUsage } from '@/lib/reference-items'

/*
  The kinds of record the association keeps: complaints, architectural
  requests, minutes, whatever the board settles on.

  The same list Reference data has always held, given its own tab because the
  board is still deciding what belongs on it and asked to work on it the way it
  works on relation types: add, rename, remove, with a count of how many
  records use each so it can see which ones earn their place.
*/
export function RecordTypesPanel() {
  const items = useReferenceItems('record_type')
  const entities = useAllEntities()
  const createItem = useCreateReferenceItem()
  const updateItem = useUpdateReferenceItem()
  const deleteItem = useDeleteReferenceItem()

  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null)
  /** The row whose remove button was pressed, waiting on a yes or an explanation. */
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = items.data ?? []
  const usage = useMemo(() => referenceUsage(entities.data ?? [], 'record_type'), [entities.data])

  const report = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : 'That change could not be saved.')

  const add = () => {
    const trimmed = label.trim()
    if (rows.some((item) => item.label.toLowerCase() === trimmed.toLowerCase())) {
      setError(`There is already a record type called "${trimmed}".`)
      return
    }
    setError(null)
    createItem
      .mutateAsync({ list: 'record_type', label: trimmed })
      .then(() => setLabel(''))
      .catch(report)
  }

  const rename = () => {
    if (!editing) return
    const trimmed = editing.label.trim()
    if (trimmed === '') {
      setError('A record type needs a name.')
      return
    }
    setError(null)
    updateItem
      .mutateAsync({ id: editing.id, patch: { label: trimmed } })
      .then(() => setEditing(null))
      .catch(report)
  }

  const remove = (id: string) => {
    setError(null)
    deleteItem
      .mutateAsync(id)
      .then(() => setRemoving(null))
      .catch(report)
  }

  const move = (item: ReferenceItem, direction: -1 | 1) => {
    const index = rows.findIndex((row) => row.id === item.id)
    const swap = rows[index + direction]
    if (!swap) return
    updateItem.mutate({ id: item.id, patch: { sortOrder: swap.sortOrder } })
    updateItem.mutate({ id: swap.id, patch: { sortOrder: item.sortOrder } })
  }

  return (
    <Panel>
      <PanelHeader title="Record types" meta={`${String(rows.length)}`} />

      <PanelBody className="flex flex-col gap-3 p-0">
        <div className="border-rule flex flex-wrap items-end gap-2 border-b p-3">
          <Field label="New record type" className="max-w-sm flex-1">
            <Input
              value={label}
              placeholder="Parking violation"
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && label.trim() !== '') add()
              }}
            />
          </Field>
          <Button
            variant="primary"
            disabled={label.trim() === '' || createItem.isPending}
            onClick={add}
          >
            <Plus />
            Add
          </Button>
        </div>

        {error && (
          <div className="px-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        {items.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No record types yet"
              description="Add the kinds of record the association keeps, such as complaints or architectural requests."
            />
          </div>
        ) : (
          <TableWrap>
            <Table>
              <Thead>
                <tr>
                  <Th>Record type</Th>
                  <Th className="w-52">Stored value</Th>
                  <Th className="w-24">In use</Th>
                  <Th className="w-24">Offered</Th>
                  <Th className="w-24">Order</Th>
                  <Th className="w-56">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </Thead>
              <Tbody>
                {rows.map((item, index) => {
                  const inUse = usage.get(item.value) ?? 0
                  const blocker = referenceRemovalBlocker(item, inUse)
                  const isEditing = editing?.id === item.id

                  return (
                    <Tr key={item.id}>
                      <Td>
                        {isEditing ? (
                          <Input
                            value={editing.label}
                            aria-label={`Rename ${item.label}`}
                            className="h-8 max-w-xs"
                            onChange={(event) =>
                              setEditing({ id: item.id, label: event.target.value })
                            }
                          />
                        ) : (
                          item.label
                        )}
                      </Td>
                      <Td>
                        <IdChip>{item.value}</IdChip>
                      </Td>
                      <Td className="text-ink-muted font-mono text-xs">
                        {inUse === 0 ? 'unused' : inUse.toLocaleString()}
                      </Td>
                      <Td>
                        <Checkbox
                          checked={item.active}
                          aria-label={`Offer ${item.label} for new records`}
                          onChange={(event) =>
                            updateItem.mutate({
                              id: item.id,
                              patch: { active: event.target.checked },
                            })
                          }
                        />
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Move ${item.label} up`}
                            disabled={index === 0}
                            onClick={() => move(item, -1)}
                          >
                            <ChevronUp />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Move ${item.label} down`}
                            disabled={index === rows.length - 1}
                            onClick={() => move(item, 1)}
                          >
                            <ChevronDown />
                          </Button>
                        </span>
                      </Td>
                      <Td>
                        {isEditing ? (
                          <span className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={updateItem.isPending}
                              onClick={rename}
                            >
                              Save
                            </Button>
                            <Button size="sm" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                          </span>
                        ) : removing === item.id ? (
                          blocker ? (
                            <span className="flex items-start gap-2">
                              <span className="text-ink-muted text-xs">{blocker}</span>
                              <Button size="sm" onClick={() => setRemoving(null)}>
                                OK
                              </Button>
                            </span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={deleteItem.isPending}
                                onClick={() => remove(item.id)}
                              >
                                Remove
                              </Button>
                              <Button size="sm" onClick={() => setRemoving(null)}>
                                Cancel
                              </Button>
                            </span>
                          )
                        ) : (
                          <span className="flex items-center gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Rename ${item.label}`}
                              onClick={() => {
                                setRemoving(null)
                                setEditing({ id: item.id, label: item.label })
                              }}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Remove ${item.label}`}
                              onClick={() => {
                                setEditing(null)
                                setRemoving(item.id)
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </span>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          </TableWrap>
        )}
      </PanelBody>

      <PanelFooter>
        <span>
          Records store the value, so renaming a type changes how every record of that type reads
          without rewriting any of them. A type no record uses can be removed. One that is in use
          can be turned off instead, which keeps it on the records that have it and stops it being
          offered for new ones.
        </span>
      </PanelFooter>
    </Panel>
  )
}

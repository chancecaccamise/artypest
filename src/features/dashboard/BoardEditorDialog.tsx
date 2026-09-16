import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { useCreateRelation, useDeleteRelation } from '@/hooks/use-data'
import { computeBoard, type ResolvedGraph } from '@/lib/insights'

const POSITIONS = [
  ['president', 'President'],
  ['vice president', 'Vice president'],
  ['chair', 'Chair'],
  ['treasurer', 'Treasurer'],
  ['secretary', 'Secretary'],
  ['member', 'Member'],
] as const

interface BoardEditorDialogProps {
  open: boolean
  onClose: () => void
  graph: ResolvedGraph
}

export function BoardEditorDialog({ open, onClose, graph }: BoardEditorDialogProps) {
  const createRelation = useCreateRelation()
  const deleteRelation = useDeleteRelation()

  const associations = useMemo(
    () =>
      graph.entities
        .filter(
          (entity) =>
            entity.type === 'association' && entity.archivedAt === null && entity.deletedAt === null
        )
        .sort((a, b) => {
          const seatsA = typeof a.data.boardSeats === 'number' ? a.data.boardSeats : 0
          const seatsB = typeof b.data.boardSeats === 'number' ? b.data.boardSeats : 0
          return seatsB - seatsA || a.name.localeCompare(b.name)
        }),
    [graph.entities]
  )
  const people = useMemo(
    () =>
      graph.entities
        .filter(
          (entity) =>
            entity.type === 'person' && entity.archivedAt === null && entity.deletedAt === null
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [graph.entities]
  )
  const groups = useMemo(() => computeBoard(graph), [graph])

  const [associationId, setAssociationId] = useState('')
  const [personId, setPersonId] = useState('')
  const [position, setPosition] = useState('member')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedAssociationId = associationId || associations[0]?.id || ''
  const selectedAssociation = associations.find(
    (association) => association.id === selectedAssociationId
  )
  const currentGroup = groups.find((group) => group.associationId === selectedAssociationId)
  const seats = currentGroup?.seats ?? []

  const resetForm = () => {
    setPersonId('')
    setPosition('member')
    setStartDate('')
    setEndDate('')
    setError(null)
  }

  const close = () => {
    resetForm()
    setAssociationId('')
    setRemovingId(null)
    onClose()
  }

  const addMember = () => {
    const memberType = [...graph.relationTypes.values()].find((type) => type.key === 'member_of')
    if (!selectedAssociation || !memberType) {
      setError('The board membership connection is not available.')
      return
    }
    if (!personId) {
      setError('Choose a person to add.')
      return
    }
    if (seats.some((seat) => seat.personId === personId)) {
      setError('That person is already a current member of this group.')
      return
    }
    if (startDate && endDate && endDate < startDate) {
      setError('The term end must be on or after the term start.')
      return
    }

    createRelation.mutate(
      {
        relationTypeId: memberType.id,
        fromEntityId: personId,
        toEntityId: selectedAssociation.id,
        startDate: startDate || null,
        endDate: endDate || null,
        attributes: { role: 'board', position },
      },
      {
        onSuccess: resetForm,
        onError: () => setError('The member could not be added. Try again.'),
      }
    )
  }

  const removeMember = (relationId: string) => {
    setRemovingId(relationId)
    setError(null)
    deleteRelation.mutate(relationId, {
      onSuccess: () => setRemovingId(null),
      onError: () => {
        setRemovingId(null)
        setError('The member could not be removed. Try again.')
      },
    })
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Manage board and committees"
      description="Add the people currently serving and remove entries that are no longer correct."
      size="lg"
      footer={<Button onClick={close}>Done</Button>}
    >
      <div className="flex flex-col gap-5">
        <Field label="Board or committee">
          <Select
            data-autofocus
            value={selectedAssociationId}
            onChange={(event) => {
              setAssociationId(event.target.value)
              resetForm()
            }}
          >
            {associations.map((association) => (
              <option key={association.id} value={association.id}>
                {association.name}
              </option>
            ))}
          </Select>
        </Field>

        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="label-caps">Current members</h3>
            <span className="text-ink-faint font-mono text-xs">
              {seats.length} /{' '}
              {typeof selectedAssociation?.data.boardSeats === 'number'
                ? selectedAssociation.data.boardSeats
                : 0}{' '}
              seats
            </span>
          </div>

          {seats.length === 0 ? (
            <p className="border-rule bg-paper-sunken text-ink-muted text-13 rounded-[3px] border px-3 py-3">
              No current members are recorded for this group.
            </p>
          ) : (
            <ul className="border-rule divide-rule divide-y rounded-[3px] border">
              {seats.map((seat) => (
                <li key={seat.relationId} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-ink text-13 block truncate font-medium">
                      {seat.personName}
                    </span>
                    <span className="text-ink-muted block text-xs">
                      {seat.positionLabel}
                      {seat.termEnd ? ` · term ends ${seat.termEnd}` : ' · no term end'}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMember(seat.relationId)}
                    disabled={deleteRelation.isPending}
                    aria-label={`Remove ${seat.personName}`}
                  >
                    <Trash2 />
                    {removingId === seat.relationId ? 'Removing' : 'Remove'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border-rule border-t pt-4">
          <h3 className="label-caps mb-3">Add a member</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Person" required className="sm:col-span-2">
              <Select
                value={personId}
                onChange={(event) => {
                  setPersonId(event.target.value)
                  setError(null)
                }}
              >
                <option value="">Choose a person</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Position" required className="sm:col-span-2">
              <Select value={position} onChange={(event) => setPosition(event.target.value)}>
                {POSITIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Term start" hint="Optional">
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label="Term end" hint="Optional">
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>

          {error ? (
            <p role="alert" className="text-oxblood mt-3 text-xs">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              onClick={addMember}
              disabled={createRelation.isPending || associations.length === 0}
            >
              {createRelation.isPending ? 'Adding' : 'Add member'}
            </Button>
          </div>
        </section>
      </div>
    </Dialog>
  )
}

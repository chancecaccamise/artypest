import { useMemo, useState } from 'react'
import { CalendarDays, Check, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, Input, Textarea } from '@/components/ui/field'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useCreateEntity, useDeleteEntity, useGraph, useUpdateEntity } from '@/hooks/use-data'
import type { Entity } from '@/lib/data/types'
import { getActiveActor } from '@/lib/data/actor'
import { useMemberName } from '@/lib/auth'
import { daysUntil, formatDate, formatDateTime, formatRelativeDays, readString } from '@/lib/format'
import { TODO_RECORD_TYPE, todosForSubject } from '@/lib/todos'
import { useRole } from '@/lib/role'
import { cn } from '@/lib/utils'

interface TaskDraft {
  title: string
  dueDate: string
  details: string
  /** Only offered once the to do is completed. */
  outcome: string
}

const EMPTY_DRAFT: TaskDraft = { title: '', dueDate: '', details: '', outcome: '' }

/** Older to dos stored the day only; newer ones the moment. */
function formatCompletedAt(value: string): string {
  return value.length === 10 ? formatDate(value) : formatDateTime(value)
}

export function ToDoTab({ entity }: { entity: Entity }) {
  const { graph, isLoading } = useGraph()
  const { canEdit } = useRole()
  const createEntity = useCreateEntity()
  const updateEntity = useUpdateEntity()
  const deleteEntity = useDeleteEntity()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Entity | null>(null)
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  const [error, setError] = useState<string | null>(null)
  /** The to do being ticked off, while the outcome is asked for. */
  const [completing, setCompleting] = useState<Entity | null>(null)
  const [outcome, setOutcome] = useState('')
  const nameFor = useMemberName()

  const todos = useMemo(() => (graph ? todosForSubject(graph, entity.id) : []), [entity.id, graph])
  const openCount = todos.filter((todo) => readString(todo.data.status) !== 'closed').length

  const closeDialog = () => {
    setDialogOpen(false)
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
  }

  const openCreate = () => {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
    setDialogOpen(true)
  }

  const openEdit = (todo: Entity) => {
    setEditing(todo)
    setDraft({
      title: todo.name,
      dueDate: readString(todo.data.followUpDate),
      details: readString(todo.data.summary),
      outcome: readString(todo.data.completionNote),
    })
    setError(null)
    setDialogOpen(true)
  }

  const save = () => {
    const title = draft.title.trim()
    if (!title) {
      setError('Enter what needs to be done.')
      return
    }
    if (!draft.dueDate) {
      setError('Choose a due date so this can work as a reminder.')
      return
    }

    if (editing) {
      updateEntity.mutate(
        {
          id: editing.id,
          patch: {
            name: title,
            data: {
              ...editing.data,
              followUpDate: draft.dueDate,
              summary: draft.details.trim() || null,
              ...(readString(editing.data.status) === 'closed'
                ? { completionNote: draft.outcome.trim() || null }
                : {}),
            },
          },
        },
        { onSuccess: closeDialog, onError: () => setError('The to do could not be saved.') }
      )
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    createEntity.mutate(
      {
        type: 'record',
        name: title,
        data: {
          recordNumber: null,
          recordType: TODO_RECORD_TYPE,
          status: 'open',
          occurredOn: today,
          followUpDate: draft.dueDate,
          summary: draft.details.trim() || null,
          notes: null,
          subjectId: entity.id,
          subjectType: entity.type,
          completedAt: null,
        },
      },
      { onSuccess: closeDialog, onError: () => setError('The to do could not be created.') }
    )
  }

  /*
    Ticking one off asks how it went, because "done" a year later is less
    useful than "spoke to the owner, fence comes down Friday". The answer is
    optional so a quick tick stays quick. The moment and the person are kept
    as well as the day, so the list reads as a log.
  */
  const startCompleting = (todo: Entity) => {
    setCompleting(todo)
    // A to do reopened and finished again keeps what was written last time.
    setOutcome(readString(todo.data.completionNote))
  }

  const complete = () => {
    if (!completing) return
    updateEntity.mutate(
      {
        id: completing.id,
        patch: {
          data: {
            ...completing.data,
            status: 'closed',
            completedAt: new Date().toISOString(),
            completedBy: getActiveActor(),
            completionNote: outcome.trim() || null,
          },
        },
      },
      { onSuccess: () => setCompleting(null) }
    )
  }

  /** The note stays, hidden while open, so finishing it again starts from it. */
  const reopen = (todo: Entity) => {
    updateEntity.mutate({
      id: todo.id,
      patch: {
        data: { ...todo.data, status: 'open', completedAt: null, completedBy: null },
      },
    })
  }

  if (isLoading || !graph) {
    return (
      <Panel>
        <PanelHeader title="To do" />
        <PanelBody>
          <SkeletonRows rows={4} />
        </PanelBody>
      </Panel>
    )
  }

  return (
    <>
      <Panel>
        <PanelHeader
          title="To do"
          meta={`${openCount} open`}
          action={
            canEdit ? (
              <Button size="sm" onClick={openCreate}>
                <Plus />
                Add to do
              </Button>
            ) : null
          }
        />
        <PanelBody>
          {todos.length === 0 ? (
            <EmptyState
              title="No reminders for this record"
              description="Add a dated action item and it will appear here and on the dashboard until it is completed."
              action={
                canEdit ? (
                  <Button size="sm" onClick={openCreate}>
                    Add to do
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-rule border-rule divide-y border-t">
              {todos.map((todo) => {
                const completed = readString(todo.data.status) === 'closed'
                const dueDate = readString(todo.data.followUpDate)
                const details = readString(todo.data.summary)
                const days = dueDate ? daysUntil(dueDate) : null
                const overdue = !completed && days !== null && days < 0

                return (
                  <li key={todo.id} className={cn('flex gap-3 py-3', completed && 'opacity-60')}>
                    {canEdit ? (
                      <Button
                        variant={completed ? 'ghost' : 'secondary'}
                        size="icon-sm"
                        aria-label={completed ? `Reopen ${todo.name}` : `Complete ${todo.name}`}
                        title={completed ? 'Reopen' : 'Mark complete'}
                        onClick={() => (completed ? reopen(todo) : startCompleting(todo))}
                      >
                        {completed ? <RotateCcw /> : <Check />}
                      </Button>
                    ) : null}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3
                          className={cn(
                            'text-ink text-sm font-semibold',
                            completed && 'line-through'
                          )}
                        >
                          {todo.name}
                        </h3>
                        {completed ? (
                          <StatusBadge tone="moss">Completed</StatusBadge>
                        ) : overdue ? (
                          <StatusBadge tone="oxblood">Overdue</StatusBadge>
                        ) : (
                          <StatusBadge tone="amber">Open</StatusBadge>
                        )}
                      </div>
                      {details ? <p className="text-ink-muted text-13 mt-1">{details}</p> : null}
                      {completed ? (
                        <CompletionNote
                          completedAt={readString(todo.data.completedAt)}
                          completedBy={readString(todo.data.completedBy)}
                          note={readString(todo.data.completionNote)}
                          nameFor={nameFor}
                        />
                      ) : null}
                      <p
                        className={cn(
                          'mt-1 flex items-center gap-1.5 font-mono text-xs',
                          overdue ? 'text-oxblood' : 'text-ink-faint'
                        )}
                      >
                        <CalendarDays className="size-3.5" aria-hidden="true" />
                        Due {dueDate ? formatDate(dueDate) : 'No due date'}
                        {days === null ? '' : ` · ${formatRelativeDays(days)}`}
                      </p>
                    </div>

                    {canEdit ? (
                      <div className="flex shrink-0 items-start gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${todo.name}`}
                          onClick={() => openEdit(todo)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${todo.name}`}
                          onClick={() => deleteEntity.mutate(todo.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? 'Edit to do' : `Add a to do for ${entity.name}`}
        description="Dated items stay on the dashboard until they are completed."
        size="sm"
        footer={
          <>
            <Button onClick={closeDialog}>Cancel</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={createEntity.isPending || updateEntity.isPending}
            >
              {editing ? 'Save changes' : 'Add to do'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label="What needs to be done"
            required
            error={error && !draft.title.trim() ? error : null}
          >
            <Input
              data-autofocus
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Call, follow up, schedule, review…"
            />
          </Field>
          <Field label="Due date" required error={error && !draft.dueDate ? error : null}>
            <Input
              type="date"
              value={draft.dueDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, dueDate: event.target.value }))
              }
            />
          </Field>
          <Field label="Details" hint="Optional context for whoever handles this reminder.">
            <Textarea
              value={draft.details}
              onChange={(event) =>
                setDraft((current) => ({ ...current, details: event.target.value }))
              }
            />
          </Field>
          {editing && readString(editing.data.status) === 'closed' ? (
            <Field label="How it was completed">
              <Textarea
                value={draft.outcome}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, outcome: event.target.value }))
                }
              />
            </Field>
          ) : null}
          {error && draft.title.trim() && draft.dueDate ? (
            <p role="alert" className="text-oxblood text-xs">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={completing !== null}
        onClose={() => setCompleting(null)}
        title="Complete this to do"
        description={completing?.name}
        size="sm"
        footer={
          <>
            <Button onClick={() => setCompleting(null)}>Cancel</Button>
            <Button variant="primary" onClick={complete} disabled={updateEntity.isPending}>
              <Check />
              Mark complete
            </Button>
          </>
        }
      >
        <Field
          label="How it was completed"
          hint="Optional. What was done, who was spoken to, what was agreed."
        >
          <Textarea
            data-autofocus
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          />
        </Field>
      </Dialog>
    </>
  )
}

function CompletionNote({
  completedAt,
  completedBy,
  note,
  nameFor,
}: {
  completedAt: string
  completedBy: string
  note: string
  nameFor: (actor: string) => string
}) {
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {completedAt ? (
        <p className="text-moss flex items-center gap-1.5 font-mono text-xs">
          <Check className="size-3.5" aria-hidden="true" />
          Completed {formatCompletedAt(completedAt)}
          {completedBy ? ` by ${nameFor(completedBy)}` : ''}
        </p>
      ) : null}
      {note ? <p className="text-ink text-13 whitespace-pre-wrap">{note}</p> : null}
    </div>
  )
}

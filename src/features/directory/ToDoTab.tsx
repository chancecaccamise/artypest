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
import { daysUntil, formatDate, formatRelativeDays, readString } from '@/lib/format'
import { TODO_RECORD_TYPE, todosForSubject } from '@/lib/todos'
import { useRole } from '@/lib/role'
import { cn } from '@/lib/utils'

interface TaskDraft {
  title: string
  dueDate: string
  details: string
}

const EMPTY_DRAFT: TaskDraft = { title: '', dueDate: '', details: '' }

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

  const setCompleted = (todo: Entity, completed: boolean) => {
    updateEntity.mutate({
      id: todo.id,
      patch: {
        data: {
          ...todo.data,
          status: completed ? 'closed' : 'open',
          completedAt: completed ? new Date().toISOString().slice(0, 10) : null,
        },
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
                        onClick={() => setCompleted(todo, !completed)}
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
          {error && draft.title.trim() && draft.dueDate ? (
            <p role="alert" className="text-oxblood text-xs">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  )
}

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Notice } from '@/components/ui/empty-state'
import { DIRECTORY_CONFIGS, type FieldDef } from '@/features/directory/config'
import {
  type PendingPropertyLink,
  PropertyLinkFields,
} from '@/features/directory/PropertyLinkFields'
import { useCreateEntityWithRelations, useRelationTypes, useUpdateEntity } from '@/hooks/use-data'
import { useReferenceLabels } from '@/hooks/use-reference-labels'
import { ENTITY_TYPE_LABELS, type Entity, type EntityType } from '@/lib/data/types'
import { readString } from '@/lib/format'
import { deriveJurisdiction } from '@/lib/parcels/pin'
import { entityFormSchema } from '@/lib/validation/entities'

/*
  Add and edit, driven by the same per-type config as the table and the field
  grid, and validated by the same Zod schema the API layer will use.

  Values are held as strings because that is what an input gives back. The Zod
  schema does the coercion on submit, in one place, so a number field cannot
  quietly store "1926" as text.
*/

export interface EntityFormDialogProps {
  open: boolean
  onClose: () => void
  type: EntityType
  /** Present when editing. Absent when adding. */
  entity?: Entity
  onCreated?: (entity: Entity) => void
  /** Field key to focus on open, used by "Add parcel record". */
  focusField?: string
}

/** Fields the form offers, in config order, notes last. */
function formFields(type: EntityType): FieldDef[] {
  const fields = DIRECTORY_CONFIGS[type].fields
  return [...fields.filter((f) => f.key !== 'notes'), ...fields.filter((f) => f.key === 'notes')]
}

function toInputValue(value: unknown): string {
  return readString(value)
}

export function EntityFormDialog({
  open,
  onClose,
  type,
  entity,
  onCreated,
  focusField,
}: EntityFormDialogProps) {
  const config = DIRECTORY_CONFIGS[type]
  const fields = useMemo(() => formFields(type), [type])
  const { optionsFor } = useReferenceLabels()

  const createEntity = useCreateEntityWithRelations()
  const relationTypes = useRelationTypes()
  const updateEntity = useUpdateEntity()

  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [propertyLinks, setPropertyLinks] = useState<PendingPropertyLink[]>([])

  /*
    Reset whenever the dialog opens, so a cancelled edit does not leak into the
    next one. Adjusting state during render is the pattern React documents for
    this; an effect would render the stale form once before correcting it.
  */
  const openKey = open ? `${type}:${entity?.id ?? 'new'}:${entity?.updatedAt ?? ''}` : null
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null)

  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey)
    if (openKey !== null) {
      setName(entity?.name ?? '')
      setValues(
        Object.fromEntries(
          fields.map((field) => [field.key, toInputValue(entity?.data[field.key])])
        )
      )
      setErrors({})
      setSubmitError(null)
      setPropertyLinks([])
    }
  }

  const isEditing = Boolean(entity)
  const pending = createEntity.isPending || updateEntity.isPending

  const setValue = (key: string, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => {
      if (!previous[key]) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void submit()
  }

  const submit = async () => {
    setSubmitError(null)

    const parsed = entityFormSchema(type).safeParse({ name, data: values })

    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        // Paths are ['name'] or ['data', '<field>'].
        const key = issue.path.length > 1 ? String(issue.path[1]) : String(issue.path[0])
        nextErrors[key] ??= issue.message
      }
      setErrors(nextErrors)
      return
    }

    try {
      if (entity) {
        /*
          Keys the form does not manage are carried through. `data` is replaced
          wholesale by the provider, and the form only submits what is in the
          field list, so without this a person's photograph would vanish the
          moment somebody corrected their phone number, and a parcel would lose
          its neighborhood and county owner on any edit.
        */
        await updateEntity.mutateAsync({
          id: entity.id,
          patch: {
            name: parsed.data.name,
            data: { ...entity.data, ...parsed.data.data },
          },
        })
      } else {
        const relationTypeByKey = new Map(
          (relationTypes.data ?? []).map((relationType) => [relationType.key, relationType])
        )
        const unresolved = propertyLinks.find((link) => !relationTypeByKey.has(link.relationKey))
        if (unresolved) throw new Error('A selected property relationship is not available.')

        const created = await createEntity.mutateAsync({
          entity: {
            type,
            name: parsed.data.name,
            data: parsed.data.data,
          },
          relations: propertyLinks.map((link) => {
            const relationType = relationTypeByKey.get(link.relationKey)
            if (!relationType) throw new Error('A selected property relationship is not available.')
            return {
              relationTypeId: relationType.id,
              toEntityId: link.propertyId,
            }
          }),
        })
        onCreated?.(created)
      }
      onClose()
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'The record could not be saved. Try again.'
      )
    }
  }

  // Jurisdiction is derived, never entered. Showing it live is how the user
  // learns that the PIN they typed resolves to the district they expect.
  const pinValue = values.pin ?? ''
  const jurisdiction = type === 'property' && pinValue !== '' ? deriveJurisdiction(pinValue) : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        isEditing ? `Edit ${config.singular.toLowerCase()}` : `Add ${config.singular.toLowerCase()}`
      }
      description={
        isEditing
          ? 'Every change is recorded field by field in the History tab.'
          : `A new ${config.singular.toLowerCase()} in ${ENTITY_TYPE_LABELS[type].plural.toLowerCase()}.`
      }
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="entity-form" disabled={pending}>
            {pending
              ? 'Saving'
              : isEditing
                ? 'Save changes'
                : `Add ${config.singular.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <form id="entity-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {submitError ? <Notice tone="error">{submitError}</Notice> : null}

        <Field
          label={type === 'property' ? 'Street address' : 'Name'}
          required
          error={errors.name ?? null}
        >
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setErrors((previous) => {
                const next = { ...previous }
                delete next.name
                return next
              })
            }}
            data-autofocus={focusField ? undefined : true}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            const isLong = field.format === 'longtext'
            const referenceOptions = field.referenceList ? optionsFor(field.referenceList) : null

            return (
              <Field
                key={field.key}
                label={field.label}
                error={errors[field.key] ?? null}
                className={isLong ? 'sm:col-span-2' : undefined}
                hint={
                  field.key === 'pin'
                    ? jurisdiction
                      ? `Jurisdiction: ${jurisdiction}`
                      : 'Two valid shapes: 20032 63001 or 10993C01034.'
                    : undefined
                }
              >
                {isLong ? (
                  <Textarea
                    value={values[field.key] ?? ''}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    data-autofocus={focusField === field.key ? true : undefined}
                  />
                ) : referenceOptions ? (
                  <Select
                    value={values[field.key] ?? ''}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    data-autofocus={focusField === field.key ? true : undefined}
                  >
                    <option value="">Not set</option>
                    {referenceOptions.map((option) => (
                      <option key={option.id} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    type={
                      field.format === 'date'
                        ? 'date'
                        : field.format === 'number' ||
                            field.format === 'currency' ||
                            field.format === 'acreage' ||
                            field.format === 'year'
                          ? 'number'
                          : field.format === 'email'
                            ? 'email'
                            : field.format === 'phone'
                              ? 'tel'
                              : 'text'
                    }
                    step={field.format === 'acreage' ? '0.001' : undefined}
                    inputMode={field.format === 'year' ? 'numeric' : undefined}
                    className={field.format === 'mono' ? 'font-mono' : undefined}
                    value={values[field.key] ?? ''}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    data-autofocus={focusField === field.key ? true : undefined}
                  />
                )}
              </Field>
            )
          })}
        </div>

        {!isEditing && (type === 'person' || type === 'business') ? (
          <PropertyLinkFields type={type} value={propertyLinks} onChange={setPropertyLinks} />
        ) : null}
      </form>
    </Dialog>
  )
}

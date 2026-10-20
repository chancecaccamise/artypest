import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { entityHref } from '@/components/layout/nav-config'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Notice } from '@/components/ui/empty-state'
import { DIRECTORY_CONFIGS, optionLabel, type FieldDef } from '@/features/directory/config'
import {
  type PendingPropertyLink,
  PropertyLinkFields,
} from '@/features/directory/PropertyLinkFields'
import { LinkedItemsField } from '@/features/directory/LinkedItemsField'
import { PendingFilesField } from '@/features/directory/PendingFilesField'
import {
  maxFileBytes,
  useAllEntities,
  useAttachFile,
  useCreateEntityWithRelations,
  useRelationTypes,
  useUpdateEntity,
} from '@/hooks/use-data'
import { useReferenceLabels } from '@/hooks/use-reference-labels'
import { ENTITY_TYPE_LABELS, type Entity, type EntityType } from '@/lib/data/types'
import { findDuplicateProperties, type DuplicateMatch } from '@/lib/duplicates'
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
  /** Prefills the name when adding, for "create it from here" elsewhere. */
  initialName?: string
  /** Wording for when the form is a step in something else, like a connection. */
  title?: string
  description?: string
  submitLabel?: string
  /** Field key to focus on open, used by "Add parcel record". */
  focusField?: string
  /**
   * Offered when the property being added is already on file, so a step in
   * something else can carry on with the existing lot instead. Without it the
   * form links to the existing record.
   */
  onChooseExisting?: (entity: Entity) => void
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
  initialName,
  title,
  description,
  submitLabel,
  focusField,
  onChooseExisting,
}: EntityFormDialogProps) {
  const config = DIRECTORY_CONFIGS[type]
  const fields = useMemo(() => formFields(type), [type])
  const { optionsFor } = useReferenceLabels()

  const createEntity = useCreateEntityWithRelations()
  const relationTypes = useRelationTypes()
  const updateEntity = useUpdateEntity()
  const attachFile = useAttachFile()
  const allEntities = useAllEntities()

  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [propertyLinks, setPropertyLinks] = useState<PendingPropertyLink[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  /** What a new record is about, each saved as a "references" connection. */
  const [linkedIds, setLinkedIds] = useState<string[]>([])
  /**
   * Set when the record was saved but a file was not attached. The record
   * exists, so the form must not offer to save it a second time.
   */
  const [savedWithProblems, setSavedWithProblems] = useState<Entity | null>(null)

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
      setName(entity?.name ?? initialName ?? '')
      setValues(
        Object.fromEntries(
          fields.map((field) => [
            field.key,
            toInputValue(entity?.data[field.key]) || (field.defaultValue ?? ''),
          ])
        )
      )
      setErrors({})
      setSubmitError(null)
      setPropertyLinks([])
      setPendingFiles([])
      setLinkedIds([])
      setSavedWithProblems(null)
    }
  }

  const isEditing = Boolean(entity)
  const pending = createEntity.isPending || updateEntity.isPending || attachFile.isPending

  const finish = (created: Entity) => {
    onCreated?.(created)
    onClose()
  }

  /*
    Checked as the reader types, not on submit, so the existing lot is offered
    before the form is filled in rather than after. A parcel number already on
    file refuses outright. An address alone is only asked about, and only when
    adding: condominium units are separate parcels at one address.
  */
  const duplicates = useMemo(() => {
    if (type !== 'property') return []
    const matches = findDuplicateProperties(
      { id: entity?.id, name, pin: values.pin ?? '' },
      allEntities.data ?? []
    )
    return isEditing ? matches.filter((match) => match.by === 'pin') : matches
  }, [type, entity?.id, name, values.pin, allEntities.data, isEditing])
  const pinDuplicate = duplicates.find((match) => match.by === 'pin') ?? null

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
    // Already saved; only its files went wrong. Saving again would make a second record.
    if (savedWithProblems) return
    setSubmitError(null)

    if (pinDuplicate) {
      setErrors((previous) => ({
        ...previous,
        pin: `Already on file as ${pinDuplicate.entity.name}.`,
      }))
      return
    }

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
        // A record points at what it is about; the other end reads "is referenced by".
        const references = relationTypeByKey.get('references')
        if (linkedIds.length > 0 && !references) {
          throw new Error('Records cannot be linked until the "references" connection type exists.')
        }

        const created = await createEntity.mutateAsync({
          entity: {
            type,
            name: parsed.data.name,
            data: parsed.data.data,
          },
          relations: [
            ...propertyLinks.map((link) => {
              const relationType = relationTypeByKey.get(link.relationKey)
              if (!relationType) {
                throw new Error('A selected property relationship is not available.')
              }
              return {
                relationTypeId: relationType.id,
                toEntityId: link.propertyId,
              }
            }),
            ...linkedIds.map((toEntityId) => ({
              relationTypeId: references?.id ?? '',
              toEntityId,
            })),
          ],
        })

        const failed: string[] = []
        for (const file of pendingFiles) {
          try {
            await attachFile.mutateAsync({ entityId: created.id, file })
          } catch (caught) {
            failed.push(caught instanceof Error ? caught.message : `${file.name} was not attached.`)
          }
        }
        if (failed.length > 0) {
          setSavedWithProblems(created)
          setSubmitError(
            `${config.singular} added, but not every file was attached. ${failed.join(' ')} Attach the rest from its Files tab.`
          )
          return
        }
        finish(created)
        return
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
        title ??
        (isEditing ? `Edit ${config.singular.toLowerCase()}` : `Add ${config.singular.toLowerCase()}`)
      }
      description={
        description ??
        (isEditing
          ? 'Every change is recorded field by field in the History tab.'
          : `A new ${config.singular.toLowerCase()} in ${ENTITY_TYPE_LABELS[type].plural.toLowerCase()}.`)
      }
      footer={
        savedWithProblems ? (
          <Button variant="primary" onClick={() => finish(savedWithProblems)}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="entity-form" disabled={pending}>
              {pending
                ? 'Saving'
                : isEditing
                  ? 'Save changes'
                  : duplicates.length > 0
                    ? 'Add as a separate property'
                    : (submitLabel ?? `Add ${config.singular.toLowerCase()}`)}
            </Button>
          </>
        )
      }
    >
      {duplicates.length > 0 ? (
        <DuplicateNotice
          matches={duplicates}
          editing={isEditing}
          onLeave={onClose}
          onChoose={
            onChooseExisting
              ? (existing) => {
                  onChooseExisting(existing)
                  onClose()
                }
              : undefined
          }
        />
      ) : null}

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
                ) : field.options ? (
                  <Select
                    value={values[field.key] ?? ''}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    data-autofocus={focusField === field.key ? true : undefined}
                  >
                    {field.defaultValue === undefined ? <option value="">Not set</option> : null}
                    {/*
                      A value from before the list existed stays choosable, so
                      opening the form and saving does not quietly erase it.
                    */}
                    {values[field.key] &&
                    !field.options.some((option) => option.value === values[field.key]) ? (
                      <option value={values[field.key]}>
                        {optionLabel(field.options, values[field.key] ?? '')} (no longer on the list)
                      </option>
                    ) : null}
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
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

        {!isEditing && type === 'record' && !savedWithProblems ? (
          <LinkedItemsField value={linkedIds} onChange={setLinkedIds} />
        ) : null}

        {!isEditing && !savedWithProblems ? (
          <PendingFilesField
            value={pendingFiles}
            onChange={setPendingFiles}
            maxBytes={maxFileBytes()}
          />
        ) : null}
      </form>
    </Dialog>
  )
}

/** How many existing lots to offer before the list stops helping. */
const DUPLICATE_LIMIT = 3

function DuplicateNotice({
  matches,
  editing,
  onLeave,
  onChoose,
}: {
  matches: DuplicateMatch[]
  editing: boolean
  /** Closes the form when a link leaves it for the existing record. */
  onLeave: () => void
  onChoose?: (entity: Entity) => void
}) {
  const [first] = matches
  if (!first) return null
  const byPin = first.by === 'pin'
  const pin = readString(first.entity.data.pin)

  return (
    <Notice tone={byPin ? 'error' : 'warning'} className="mb-4">
      <span className="flex flex-col gap-2">
        <span>
          {byPin
            ? `Parcel ${pin} is already on file as ${first.entity.name}. One parcel number is one lot, so it cannot be on two records.`
            : `${first.entity.name} is already on file at this address. Use it, or add a separate property if this is a different parcel.`}
          {byPin && editing
            ? ' To combine the two, open the other record and choose Merge duplicate from Actions.'
            : null}
        </span>
        <span className="flex flex-wrap gap-2">
          {matches.slice(0, DUPLICATE_LIMIT).map(({ entity: existing }) => {
            const label = `${existing.name}${
              readString(existing.data.pin) ? ` (${readString(existing.data.pin)})` : ''
            }`
            return onChoose && !editing ? (
              <Button
                key={existing.id}
                size="sm"
                variant="primary"
                onClick={() => onChoose(existing)}
              >
                Use {label}
              </Button>
            ) : (
              <Link
                key={existing.id}
                to={entityHref('property', existing.id)}
                onClick={onLeave}
                className={buttonVariants({ size: 'sm' })}
              >
                Open {label}
              </Link>
            )
          })}
        </span>
      </span>
    </Notice>
  )
}

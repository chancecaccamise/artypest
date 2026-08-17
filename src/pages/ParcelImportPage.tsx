import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, FileUp, Loader2, MapPinned, Upload } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge, TypeBadge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/empty-state'
import { Checkbox, Field, Select, Textarea } from '@/components/ui/field'
import { IdChip } from '@/components/ui/id-chip'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { Table, TableWrap, Tbody, Td, Th, Thead, Tr } from '@/components/ui/table'
import {
  applyImportPlan,
  buildImportPlan,
  parsePinList,
  summarizePlan,
  type ApplyResult,
  type OwnerAction,
  type PlanRow,
  type PropertyAction,
} from '@/features/parcels/import-plan'
import { useGraph } from '@/hooks/use-data'
import { data } from '@/lib/data'
import { formatAcreage, formatCurrency } from '@/lib/format'
import { parcelService } from '@/lib/parcels'
import { deriveJurisdiction } from '@/lib/parcels/pin'
import type { ParcelRecord } from '@/lib/parcels/types'
import { useRole } from '@/lib/role'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'

/*
  Parcel import, in four steps: Source, Preview, Match, Confirm.

  Everything except the data source is real. The parcels come from a local
  fixture rather than the SAGIS API, and the banner says so plainly. Every
  write goes through the DataProvider inside one batch, so the whole import is
  audited like any other change and the result screen links to exactly its own
  rows in Activity.
*/

type Step = 1 | 2 | 3 | 4

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: 'Source' },
  { step: 2, label: 'Preview' },
  { step: 3, label: 'Match' },
  { step: 4, label: 'Confirm' },
]

const PROPERTY_ACTIONS: { value: PropertyAction; label: string }[] = [
  { value: 'create_property', label: 'Create property' },
  { value: 'update_property', label: 'Update property' },
  { value: 'skip', label: 'Skip' },
]

export function ParcelImportPage() {
  const { canEdit } = useRole()
  const { graph } = useGraph()
  const queryClient = useQueryClient()

  const [step, setStep] = useState<Step>(1)
  const [parcels, setParcels] = useState<ParcelRecord[]>([])
  const [missingPins, setMissingPins] = useState<string[]>([])
  const [pastedText, setPastedText] = useState('')
  const [loadingSource, setLoadingSource] = useState<'sample' | 'list' | 'file' | null>(null)
  const [rows, setRows] = useState<PlanRow[]>([])
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set())

  const loadParcels = useCallback(
    async (source: 'sample' | 'list' | 'file', text?: string) => {
      setError(null)
      setLoadingSource(source)
      try {
        if (source === 'sample') {
          const all = await parcelService.listAll()
          setParcels(all)
          setMissingPins([])
          setSelectedIndexes(new Set(all.map((_, index) => index)))
        } else {
          const pins = parsePinList(text ?? '')
          if (pins.length === 0) {
            setError('No parcel numbers were found in that input. Put one PIN on each line.')
            return
          }
          const { found, missing } = await parcelService.getManyByPin(pins)
          setParcels(found)
          setMissingPins(missing)
          setSelectedIndexes(new Set(found.map((_, index) => index)))
          if (found.length === 0) {
            setError(
              `None of those ${pins.length} parcel numbers are in the sample file. The live SAGIS lookup is not connected yet.`
            )
            return
          }
        }
        setStep(2)
      } catch {
        setError('The parcel data could not be read. Try again.')
      } finally {
        setLoadingSource(null)
      }
    },
    []
  )

  const goToMatch = useCallback(() => {
    if (!graph) return
    const chosen = parcels.filter((_, index) => selectedIndexes.has(index))
    setRows(
      buildImportPlan({
        parcels: chosen,
        entities: graph.entities,
        relations: graph.relations,
        relationTypes: graph.relationTypes,
      })
    )
    setStep(3)
  }, [graph, parcels, selectedIndexes])

  const updateRow = useCallback((key: string, patch: Partial<PlanRow>) => {
    setRows((previous) =>
      previous.map((row) => (row.key === key ? { ...row, ...patch } : row))
    )
  }, [])

  const summary = useMemo(() => summarizePlan(rows), [rows])

  const confirm = useCallback(async () => {
    setApplying(true)
    setError(null)
    try {
      const relationTypes = await data.listRelationTypes()
      const owns = relationTypes.find((type) => type.key === 'owns')
      if (!owns) {
        setError('The "owns" relation type is missing, so ownership cannot be recorded.')
        return
      }

      const applied = await applyImportPlan({
        rows,
        provider: data,
        ownsRelationTypeId: owns.id,
      })

      await queryClient.invalidateQueries()
      setResult(applied)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The import did not finish. Nothing was changed.'
      )
    } finally {
      setApplying(false)
    }
  }, [rows, queryClient])

  const reset = () => {
    setStep(1)
    setParcels([])
    setSelectedIndexes(new Set())
    setMissingPins([])
    setPastedText('')
    setRows([])
    setResult(null)
    setError(null)
  }

  if (!canEdit) {
    return (
      <>
        <PageHeader title="Parcel Import" />
        <Panel>
          <PanelBody>
            <EmptyState
              title="Importing parcel data needs an editing role"
              description="Switch the role in the header to Administrator or Property manager to run an import."
            />
          </PanelBody>
        </Panel>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Parcel Import"
        subtitle="Bring county parcel records into the directory, one reviewed row at a time."
        actions={
          step > 1 && !result ? <Button onClick={reset}>Start over</Button> : null
        }
      />

      {/* A plain statement of fact, deliberately not styled as an error. */}
      <Notice tone="info" className="mb-4">
        Parcel data is loaded from a local sample file. Live SAGIS lookup is not connected yet.
      </Notice>

      <StepRail current={result ? 4 : step} />

      {error ? (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      ) : null}

      {result ? (
        <ResultPanel result={result} onReset={reset} />
      ) : step === 1 ? (
        <SourceStep
          pastedText={pastedText}
          onPastedTextChange={setPastedText}
          loadingSource={loadingSource}
          onLoadSample={() => void loadParcels('sample')}
          onLoadList={() => void loadParcels('list', pastedText)}
          onPickFile={() => fileInputRef.current?.click()}
          fileInputRef={fileInputRef}
          onFileChosen={(text) => void loadParcels('file', text)}
        />
      ) : step === 2 ? (
        <PreviewStep
          parcels={parcels}
          missingPins={missingPins}
          selectedIndexes={selectedIndexes}
          onToggle={(index) =>
            setSelectedIndexes((previous) => {
              const next = new Set(previous)
              if (next.has(index)) next.delete(index)
              else next.add(index)
              return next
            })
          }
          onToggleAll={(checked) =>
            setSelectedIndexes(checked ? new Set(parcels.map((_, index) => index)) : new Set())
          }
          onBack={() => setStep(1)}
          onNext={goToMatch}
        />
      ) : step === 3 ? (
        <MatchStep
          rows={rows}
          onUpdateRow={updateRow}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
        />
      ) : (
        <ConfirmStep
          summary={summary}
          applying={applying}
          onBack={() => setStep(3)}
          onConfirm={() => void confirm()}
        />
      )}

    </>
  )
}

/* ------------------------------------------------------------- step rail -- */

function StepRail({ current }: { current: Step }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-2" aria-label="Import steps">
      {STEPS.map(({ step, label }) => {
        const state = step < current ? 'done' : step === current ? 'current' : 'todo'
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-[3px] border px-2.5 py-1 text-13',
                state === 'current'
                  ? 'border-moss text-ink font-semibold'
                  : state === 'done'
                    ? 'border-rule text-ink-muted'
                    : 'border-rule text-ink-faint'
              )}
            >
              <span className="font-mono text-xs">
                {state === 'done' ? <Check className="size-3.5" aria-hidden="true" /> : step}
              </span>
              {label}
            </span>
            {step < 4 ? <span className="bg-rule h-px w-4" aria-hidden="true" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ step 1 -- */

interface SourceStepProps {
  pastedText: string
  onPastedTextChange: (value: string) => void
  loadingSource: 'sample' | 'list' | 'file' | null
  onLoadSample: () => void
  onLoadList: () => void
  onPickFile: () => void
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileChosen: (text: string) => void
}

function SourceStep({
  pastedText,
  onPastedTextChange,
  loadingSource,
  onLoadSample,
  onLoadList,
  onPickFile,
  fileInputRef,
  onFileChosen,
}: SourceStepProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel>
        <PanelHeader title="Load sample neighborhood" />
        <PanelBody className="flex flex-1 flex-col gap-3">
          <p className="text-ink-muted text-13">
            Reads every parcel in the local sample file. About forty already match a lot in the
            directory, so the Match step has real decisions to make.
          </p>
          <Button
            variant="primary"
            className="mt-auto self-start"
            onClick={onLoadSample}
            disabled={loadingSource !== null}
          >
            {loadingSource === 'sample' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <MapPinned />
            )}
            Load sample neighborhood
          </Button>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Paste a list of PINs" />
        <PanelBody className="flex flex-1 flex-col gap-3">
          <Field
            label="Parcel numbers"
            hideLabel
            hint="One per line. Both shapes work: 20032 63001 and 10993C01034."
          >
            <Textarea
              value={pastedText}
              onChange={(event) => onPastedTextChange(event.target.value)}
              placeholder={'20032 63001\n10993C01034'}
              className="min-h-32 font-mono text-13"
            />
          </Field>
          <Button
            className="mt-auto self-start"
            onClick={onLoadList}
            disabled={loadingSource !== null || pastedText.trim() === ''}
          >
            {loadingSource === 'list' ? <Loader2 className="animate-spin" /> : null}
            Look up these parcels
          </Button>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Upload a CSV" />
        <PanelBody className="flex flex-1 flex-col gap-3">
          <p className="text-ink-muted text-13">
            The first column is read as the parcel number. A header row is ignored. Everything else
            in the file is left alone.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            aria-label="Choose a CSV file of parcel numbers"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const input = event.target
              void file.text().then((text) => {
                onFileChosen(text)
                input.value = ''
              })
            }}
          />
          <Button
            className="mt-auto self-start"
            onClick={onPickFile}
            disabled={loadingSource !== null}
          >
            {loadingSource === 'file' ? <Loader2 className="animate-spin" /> : <FileUp />}
            Choose a file
          </Button>
        </PanelBody>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ step 2 -- */

interface PreviewStepProps {
  parcels: ParcelRecord[]
  missingPins: string[]
  selectedIndexes: Set<number>
  onToggle: (index: number) => void
  onToggleAll: (checked: boolean) => void
  onBack: () => void
  onNext: () => void
}

function PreviewStep({
  parcels,
  missingPins,
  selectedIndexes,
  onToggle,
  onToggleAll,
  onBack,
  onNext,
}: PreviewStepProps) {
  const allSelected = parcels.length > 0 && selectedIndexes.size === parcels.length

  return (
    <Panel>
      <PanelHeader
        title="Preview"
        meta={`${selectedIndexes.size} of ${parcels.length} selected`}
      />

      {missingPins.length > 0 ? (
        <div className="border-rule border-b p-3">
          <Notice tone="warning">
            <span>
              {missingPins.length} parcel {missingPins.length === 1 ? 'number is' : 'numbers are'}{' '}
              not in the sample file and {missingPins.length === 1 ? 'was' : 'were'} left out:{' '}
              <span className="font-mono text-xs">{missingPins.slice(0, 6).join(', ')}</span>
              {missingPins.length > 6 ? ` and ${missingPins.length - 6} more` : ''}.
            </span>
          </Notice>
        </div>
      ) : null}

      <TableWrap>
        <Table>
          <Thead>
            <tr>
              <Th className="w-10">
                <Checkbox
                  checked={allSelected}
                  aria-label="Select every parcel"
                  onChange={(event) => onToggleAll(event.target.checked)}
                />
              </Th>
              <Th className="w-44">PIN</Th>
              <Th>Situs address</Th>
              <Th>Owner of record</Th>
              <Th className="w-28 text-right">Acreage</Th>
              <Th className="w-24">Zoning</Th>
              <Th className="w-32 text-right">Assessed</Th>
            </tr>
          </Thead>
          <Tbody>
            {parcels.map((parcel, index) => {
              const jurisdiction = deriveJurisdiction(parcel.pin)
              return (
                <Tr key={`${parcel.pin}-${index}`}>
                  <Td>
                    <Checkbox
                      checked={selectedIndexes.has(index)}
                      aria-label={`Select parcel ${parcel.pin}`}
                      onChange={() => onToggle(index)}
                    />
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <IdChip>{parcel.pin}</IdChip>
                      {jurisdiction ? (
                        <span className="text-ink-faint hidden text-[0.6875rem] lg:inline">
                          {jurisdiction === 'City of Savannah' ? 'City' : 'County'}
                        </span>
                      ) : null}
                    </span>
                  </Td>
                  <Td>{parcel.situsAddress}</Td>
                  <Td className="font-mono text-xs">{parcel.ownerName}</Td>
                  <Td className="text-right font-mono text-xs">{formatAcreage(parcel.acreage)}</Td>
                  <Td className="font-mono text-xs">
                    {/* Null outside city limits: the zoning layer is Savannah only. */}
                    {parcel.zoningDistrict ?? 'Not available'}
                  </Td>
                  <Td className="text-right font-mono text-xs">
                    {formatCurrency(parcel.totalAssessment)}
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </TableWrap>

      <PanelFooter>
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" onClick={onNext} disabled={selectedIndexes.size === 0}>
          Match {selectedIndexes.size} {selectedIndexes.size === 1 ? 'parcel' : 'parcels'}
        </Button>
      </PanelFooter>
    </Panel>
  )
}

/* ------------------------------------------------------------------ step 3 -- */

interface MatchStepProps {
  rows: PlanRow[]
  onUpdateRow: (key: string, patch: Partial<PlanRow>) => void
  onBack: () => void
  onNext: () => void
}

function MatchStep({ rows, onUpdateRow, onBack, onNext }: MatchStepProps) {
  const creates = rows.filter((row) => row.propertyAction === 'create_property').length
  const updates = rows.filter((row) => row.propertyAction === 'update_property').length

  return (
    <Panel>
      <PanelHeader
        title="Match"
        meta={`${creates} to create, ${updates} to update`}
        action={
          <span className="text-ink-muted text-xs">
            Change any proposed action before anything is written
          </span>
        }
      />

      <PanelBody className="flex flex-col gap-3 p-3">
        {rows.map((row) => (
          <MatchRow key={row.key} row={row} onUpdate={(patch) => onUpdateRow(row.key, patch)} />
        ))}
      </PanelBody>

      <PanelFooter>
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" onClick={onNext}>
          Review the summary
        </Button>
      </PanelFooter>
    </Panel>
  )
}

function MatchRow({ row, onUpdate }: { row: PlanRow; onUpdate: (patch: Partial<PlanRow>) => void }) {
  const skipped = !row.selected || row.propertyAction === 'skip'

  const ownerActions: { value: OwnerAction; label: string }[] = [
    ...(row.ownerMatch
      ? [{ value: 'link_owner' as const, label: `Link to ${row.ownerMatch.name}` }]
      : []),
    { value: 'create_owner', label: `Create ${row.ownerKind}: ${row.ownerDisplayName}` },
    { value: 'skip_owner', label: 'Leave the owner alone' },
  ]

  return (
    <div
      className={cn(
        'border-rule rounded-[6px] border p-3 transition-colors duration-[120ms]',
        skipped && 'opacity-55'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Checkbox
            checked={row.selected}
            aria-label={`Include parcel ${row.parcel.pin}`}
            onChange={(event) => onUpdate({ selected: event.target.checked })}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-ink text-sm font-semibold">{row.parcel.situsAddress}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <IdChip prefix="PIN">{row.parcel.pin}</IdChip>
              {row.existingProperty ? (
                <Link
                  to={`/properties/${row.existingProperty.id}`}
                  className="text-survey text-xs hover:underline"
                >
                  matches {row.existingProperty.name}
                </Link>
              ) : (
                <span className="text-ink-faint text-xs">not in the directory</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Property" className="w-[11.5rem]">
            <Select
              value={row.propertyAction}
              onChange={(event) =>
                onUpdate({ propertyAction: event.target.value as PropertyAction })
              }
            >
              {PROPERTY_ACTIONS.filter(
                (action) =>
                  action.value === 'skip' ||
                  (row.existingProperty
                    ? action.value === 'update_property'
                    : action.value === 'create_property')
              ).map((action) => (
                <option key={action.value} value={action.value}>
                  {action.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Owner" className="w-[16rem]">
            <Select
              value={row.ownerAction}
              onChange={(event) => onUpdate({ ownerAction: event.target.value as OwnerAction })}
            >
              {ownerActions.map((action) => (
                <option key={action.value} value={action.value}>
                  {action.label}
                </option>
              ))}
            </Select>
          </Field>

          {row.ownerAction === 'create_owner' ? (
            <Field label="Owner is a" className="w-[9rem]">
              <Select
                value={row.ownerKind}
                onChange={(event) =>
                  onUpdate({ ownerKind: event.target.value as PlanRow['ownerKind'] })
                }
              >
                <option value="person">Person</option>
                <option value="business">Business</option>
              </Select>
            </Field>
          ) : null}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-dashed pt-2.5">
        <div className="min-w-0 flex-1">
          <p className="label-caps mb-1 text-[0.6875rem]">Owner of record</p>
          <p className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="text-ink">{row.parcel.ownerName}</span>
            <span className="text-ink-faint" aria-hidden="true">
              &rarr;
            </span>
            <span className="text-ink">{row.ownerDisplayName}</span>
            <TypeBadge type={row.ownerKind}>
              {row.ownerKind === 'person' ? 'Person' : 'Business'}
            </TypeBadge>
            {row.ownerMatchConfidence === 'normalized' ? (
              <StatusBadge tone="survey">name matched</StatusBadge>
            ) : row.ownerMatchConfidence === 'exact' ? (
              <StatusBadge tone="moss">exact match</StatusBadge>
            ) : (
              <StatusBadge tone="amber">no match found</StatusBadge>
            )}
            {row.ownershipAlreadyRecorded ? (
              <StatusBadge tone="neutral">ownership already recorded</StatusBadge>
            ) : null}
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <p className="label-caps mb-1 text-[0.6875rem]">
            {row.propertyAction === 'create_property' ? 'Will be recorded as' : 'Changes'}
          </p>

          {row.propertyAction === 'create_property' ? (
            <p className="text-ink-muted font-mono text-xs">
              {row.parcel.zoningDistrict ?? 'Zoning not available'} ·{' '}
              {formatAcreage(row.parcel.acreage)} ·{' '}
              {formatCurrency(row.parcel.totalAssessment)}
              {row.parcel.dateUpdated === null ? '' : ` (county updated ${row.parcel.dateUpdated})`}
            </p>
          ) : row.changes.length === 0 ? (
            <p className="text-ink-faint text-xs">
              Nothing to change. The stored record already matches the parcel roll.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {row.changes.map((change) => (
                <li key={change.field} className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                  <span className="text-ink-muted">{change.label}</span>
                  <span className="text-ink-muted line-through decoration-1">
                    {change.from ?? 'not set'}
                  </span>
                  <span className="text-ink-faint" aria-hidden="true">
                    &rarr;
                  </span>
                  <span className="text-ink">{change.to ?? 'not set'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ step 4 -- */

interface ConfirmStepProps {
  summary: ReturnType<typeof summarizePlan>
  applying: boolean
  onBack: () => void
  onConfirm: () => void
}

function ConfirmStep({ summary, applying, onBack, onConfirm }: ConfirmStepProps) {
  const lines = [
    { label: 'Properties to create', value: summary.propertiesToCreate },
    { label: 'Properties to update', value: summary.propertiesToUpdate },
    { label: 'Owners to create', value: summary.ownersToCreate },
    { label: 'Owners to link', value: summary.ownersToLink },
    { label: 'Ownership connections to create', value: summary.ownershipRelations },
    { label: 'Rows skipped', value: summary.skipped },
  ]

  const nothingToDo =
    summary.propertiesToCreate === 0 &&
    summary.propertiesToUpdate === 0 &&
    summary.ownershipRelations === 0

  return (
    <Panel>
      <PanelHeader title="Confirm" />
      <PanelBody className="flex flex-col gap-3">
        <dl className="divide-rule border-rule divide-y border-y">
          {lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between py-2">
              <dt className="text-ink text-13">{line.label}</dt>
              <dd className="font-display text-ink text-lg font-bold">{line.value}</dd>
            </div>
          ))}
        </dl>

        {summary.noChangeUpdates > 0 ? (
          <p className="text-ink-muted text-13">
            {summary.noChangeUpdates} selected{' '}
            {summary.noChangeUpdates === 1 ? 'row already matches' : 'rows already match'} the
            parcel roll and will be left untouched, so nothing pointless lands in the audit log.
          </p>
        ) : null}

        {nothingToDo ? (
          <Notice tone="warning">
            Nothing would change. Go back and select rows, or choose an action other than Skip.
          </Notice>
        ) : (
          <p className="text-ink-muted text-13">
            Every one of these writes is audited field by field and grouped as one batch, so the
            whole import can be reviewed, and each change explained, afterwards.
          </p>
        )}
      </PanelBody>

      <PanelFooter>
        <Button onClick={onBack} disabled={applying}>
          Back
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={applying || nothingToDo}>
          {applying ? <Loader2 className="animate-spin" /> : <Upload />}
          {applying ? 'Importing' : 'Run the import'}
        </Button>
      </PanelFooter>
    </Panel>
  )
}

/* ----------------------------------------------------------------- result -- */

function ResultPanel({ result, onReset }: { result: ApplyResult; onReset: () => void }) {
  const lines = [
    { label: 'Properties created', value: result.propertiesCreated },
    { label: 'Properties updated', value: result.propertiesUpdated },
    { label: 'Owners created', value: result.ownersCreated },
    { label: 'Owners linked', value: result.ownersLinked },
    { label: 'Ownership connections created', value: result.relationsCreated },
    { label: 'Rows skipped', value: result.skipped },
  ]

  return (
    <Panel>
      <PanelHeader title="Import complete" action={<StatusBadge tone="moss">done</StatusBadge>} />
      <PanelBody className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {lines.map((line) => (
            <div key={line.label} className="border-rule rounded-[3px] border px-3 py-2">
              <p className="font-display text-ink text-lg font-bold">{line.value}</p>
              <p className="label-caps text-[0.6875rem]">{line.label}</p>
            </div>
          ))}
        </div>

        <p className="text-ink-muted text-13">
          Every change is in the audit log, grouped under this import.
        </p>
      </PanelBody>

      <PanelFooter>
        <Button onClick={onReset}>Import more parcels</Button>
        <Link
          to={`/activity?batch=${encodeURIComponent(result.batchId)}`}
          className={cn(buttonVariants({ variant: 'primary' }))}
        >
          Review this batch in Activity
        </Link>
      </PanelFooter>
    </Panel>
  )
}

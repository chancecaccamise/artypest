import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Plug, Plus } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/empty-state'
import { Checkbox, Field, Input, Select } from '@/components/ui/field'
import { IdChip } from '@/components/ui/id-chip'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, Tbody, Td, Th, Thead, Tr } from '@/components/ui/table'
import { TabPanel, Tabs, type TabDefinition } from '@/components/ui/tabs'
import {
  useCreateReferenceItem,
  useOrg,
  useReferenceItems,
  useRelationTypes,
  useUpdateOrg,
  useUpdateReferenceItem,
  useUsers,
} from '@/hooks/use-data'
import {
  REFERENCE_LISTS,
  REFERENCE_LIST_LABELS,
  type ReferenceItem,
  type ReferenceList,
} from '@/lib/data/types'
import { formatDateTime } from '@/lib/format'
import { parcelService } from '@/lib/parcels'
import { buildParcelViewerUrl } from '@/lib/parcels/pin'
import { ROLE_LABELS } from '@/lib/role'
import { THEMES, useTheme } from '@/lib/theme'

const TABS: TabDefinition[] = [
  { value: 'organization', label: 'Organization' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'reference', label: 'Reference data' },
  { value: 'relations', label: 'Relation types' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'users', label: 'Users' },
]

/** The PIN the settings preview builds its example link from. */
const SAMPLE_PIN = '20032 63001'

export function SettingsPage() {
  const { tab } = useParams<{ tab: string }>()
  const navigate = useNavigate()

  const active = TABS.some((candidate) => candidate.value === tab) ? (tab as string) : 'organization'

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Organization details, reference lists, and how this application looks."
      />

      <Tabs
        tabs={TABS}
        value={active}
        onChange={(next) =>
          navigate(next === 'organization' ? '/settings' : `/settings/${next}`, { replace: true })
        }
        className="mb-4"
      />

      <TabPanel value="organization" active={active === 'organization'}>
        <OrganizationTab />
      </TabPanel>
      <TabPanel value="integrations" active={active === 'integrations'}>
        <IntegrationsTab />
      </TabPanel>
      <TabPanel value="reference" active={active === 'reference'}>
        <ReferenceDataTab />
      </TabPanel>
      <TabPanel value="relations" active={active === 'relations'}>
        <RelationTypesTab />
      </TabPanel>
      <TabPanel value="appearance" active={active === 'appearance'}>
        <AppearanceTab />
      </TabPanel>
      <TabPanel value="users" active={active === 'users'}>
        <UsersTab />
      </TabPanel>
    </>
  )
}

/* --------------------------------------------------------- organization -- */

function OrganizationTab() {
  const org = useOrg()
  const updateOrg = useUpdateOrg()

  const [name, setName] = useState('')
  const [template, setTemplate] = useState('')
  const [saved, setSaved] = useState(false)

  // Load the stored values into the form once they arrive, and again after a
  // save changes them. Adjusting state during render avoids the extra pass an
  // effect would cost on a form the user is typing into.
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null)
  const loadKey = org.data ? `${org.data.name}::${org.data.sagisUrlTemplate ?? ''}` : null
  if (loadKey !== null && loadKey !== loadedFrom) {
    setLoadedFrom(loadKey)
    setName(org.data?.name ?? '')
    setTemplate(org.data?.sagisUrlTemplate ?? '')
  }

  // The live preview is the whole point: the user sees the link shape they are
  // about to save, built by exactly the function the app will use.
  const preview = useMemo(() => buildParcelViewerUrl(template, SAMPLE_PIN), [template])
  const templateError =
    template.trim() !== '' && !template.includes('{pin}')
      ? 'The template needs a {pin} placeholder. Without it, no link can be built.'
      : null

  if (org.isLoading) {
    return (
      <Panel>
        <PanelBody className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </PanelBody>
      </Panel>
    )
  }

  const dirty = name !== (org.data?.name ?? '') || template !== (org.data?.sagisUrlTemplate ?? '')

  return (
    <Panel>
      <PanelHeader title="Organization" />
      <PanelBody className="flex flex-col gap-4">
        <Field label="Organization name" className="max-w-xl">
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setSaved(false)
            }}
          />
        </Field>

        <Field
          label="Parcel viewer URL template"
          className="max-w-2xl"
          error={templateError}
          hint="Municipal GIS viewers get replatformed, so this is data rather than a hardcoded string. Use {pin} where the parcel number goes."
        >
          <Input
            value={template}
            className="font-mono text-13"
            placeholder="https://gis.chathamcounty.org/parcelviewer?pin={pin}"
            onChange={(event) => {
              setTemplate(event.target.value)
              setSaved(false)
            }}
          />
        </Field>

        <div className="border-rule bg-paper-sunken rounded-[3px] border p-3">
          <p className="label-caps mb-1.5 text-[0.6875rem]">Preview, using a sample parcel</p>
          {preview ? (
            <p className="flex flex-wrap items-center gap-2">
              <IdChip prefix="PIN">{SAMPLE_PIN}</IdChip>
              <a
                href={preview}
                target="_blank"
                rel="noopener noreferrer"
                className="text-survey font-mono text-xs break-all hover:underline"
              >
                {preview}
              </a>
            </p>
          ) : (
            <p className="text-ink-muted text-13">
              With no usable template, the parcel number renders as plain text rather than as a link
              that goes nowhere.
            </p>
          )}
        </div>
      </PanelBody>

      <PanelFooter>
        <span role="status" aria-live="polite">
          {saved ? 'Saved' : dirty ? 'Unsaved changes' : 'Up to date'}
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={!dirty || updateOrg.isPending || Boolean(templateError)}
          onClick={() => {
            void updateOrg
              .mutateAsync({
                name,
                sagisUrlTemplate: template.trim() === '' ? null : template.trim(),
              })
              .then(() => setSaved(true))
          }}
        >
          {updateOrg.isPending ? 'Saving' : 'Save changes'}
        </Button>
      </PanelFooter>
    </Panel>
  )
}

/* --------------------------------------------------------- integrations -- */

function IntegrationsTab() {
  const live = parcelService.kind === 'sagis'

  return (
    <Panel>
      <PanelHeader
        title="SAGIS parcel data"
        action={
          <StatusBadge tone={live ? 'moss' : 'amber'}>
            {live ? 'Reading live county data' : 'Using the local sample'}
          </StatusBadge>
        }
      />
      <PanelBody className="flex flex-col gap-4">
        <p className="text-ink-muted max-w-2xl text-13">
          SAGIS is a public county service. There is no account, no API key, and nothing to
          authorize: it allows browser requests directly, so parcel lookups, the zoning district,
          and address geocoding all work without credentials.
        </p>

        <p className="text-ink-muted max-w-2xl text-13">
          {live
            ? 'Parcel lookups read the county service. Zoning is resolved by locating each parcel inside the county zoning map, which covers the city, the unincorporated county, and the other municipalities.'
            : 'Parcel data is being read from a local sample of 60 real county records, so the app works with no network. Turn on live reading by setting VITE_SAGIS_LIVE in the environment file.'}
        </p>

        <dl className="grid max-w-2xl gap-x-8 gap-y-2 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted text-13">Active source</dt>
            <dd className="font-mono text-xs">
              {live ? 'SAGIS, live' : 'local sample of county records'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted text-13">Zoning district</dt>
            <dd className="font-mono text-xs">county wide, by location</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted text-13">Address lookup</dt>
            <dd className="font-mono text-xs">
              {live ? 'county address locator' : 'local sample'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted text-13">Whole-county download</dt>
            {/* 125,326 parcels behind a page limit. Not an operation. */}
            <dd className="text-ink-faint font-mono text-xs">Not offered</dd>
          </div>
        </dl>

        <div className="text-ink-faint flex items-center gap-2 text-13">
          <Plug className="size-4" aria-hidden="true" />
          <span>
            There is no Connect button here on purpose. There is nothing to connect: the county
            service is open, and which source is read is an environment setting.
          </span>
        </div>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------- reference data -- */

function ReferenceDataTab() {
  const [list, setList] = useState<ReferenceList>('zoning')
  const items = useReferenceItems(list)
  const createItem = useCreateReferenceItem()
  const updateItem = useUpdateReferenceItem()

  const [newLabel, setNewLabel] = useState('')
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null)

  const rows = items.data ?? []

  const move = (item: ReferenceItem, direction: -1 | 1) => {
    const index = rows.findIndex((candidate) => candidate.id === item.id)
    const swap = rows[index + direction]
    if (!swap) return
    updateItem.mutate({ id: item.id, patch: { sortOrder: swap.sortOrder } })
    updateItem.mutate({ id: swap.id, patch: { sortOrder: item.sortOrder } })
  }

  return (
    <Panel>
      <PanelHeader
        title="Reference data"
        action={
          <Field label="List" hideLabel className="w-52">
            <Select value={list} onChange={(event) => setList(event.target.value as ReferenceList)}>
              {REFERENCE_LISTS.map((value) => (
                <option key={value} value={value}>
                  {REFERENCE_LIST_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        }
      />

      <PanelBody className="flex flex-col gap-3 p-0">
        <div className="border-rule flex flex-wrap items-end gap-2 border-b p-3">
          <Field label={`Add to ${REFERENCE_LIST_LABELS[list].toLowerCase()}`} className="max-w-sm flex-1">
            <Input
              value={newLabel}
              placeholder="Label as it should read in the app"
              onChange={(event) => setNewLabel(event.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={newLabel.trim() === '' || createItem.isPending}
            onClick={() => {
              void createItem
                .mutateAsync({ list, label: newLabel.trim() })
                .then(() => setNewLabel(''))
            }}
          >
            <Plus />
            Add
          </Button>
        </div>

        {items.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="This list is empty"
              description="Add the first value. Entities store the value, so renaming a label later never rewrites a record."
            />
          </div>
        ) : (
          <TableWrap>
            <Table>
              <Thead>
                <tr>
                  <Th>Label</Th>
                  <Th className="w-44">Stored value</Th>
                  <Th className="w-24">Active</Th>
                  <Th className="w-32">Order</Th>
                </tr>
              </Thead>
              <Tbody>
                {rows.map((item, index) => (
                  <Tr key={item.id}>
                    <Td>
                      {editing?.id === item.id ? (
                        <span className="flex items-center gap-2">
                          <Input
                            value={editing.label}
                            aria-label={`Rename ${item.label}`}
                            className="h-8 max-w-xs"
                            onChange={(event) =>
                              setEditing({ id: item.id, label: event.target.value })
                            }
                          />
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              void updateItem
                                .mutateAsync({ id: item.id, patch: { label: editing.label } })
                                .then(() => setEditing(null))
                            }}
                          >
                            Save
                          </Button>
                          <Button size="sm" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="hover:text-survey text-left hover:underline"
                          onClick={() => setEditing({ id: item.id, label: item.label })}
                        >
                          {item.label}
                        </button>
                      )}
                    </Td>
                    <Td>
                      <IdChip>{item.value}</IdChip>
                    </Td>
                    <Td>
                      <Checkbox
                        checked={item.active}
                        aria-label={`${item.label} is active`}
                        onChange={(event) =>
                          updateItem.mutate({ id: item.id, patch: { active: event.target.checked } })
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
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableWrap>
        )}
      </PanelBody>

      <PanelFooter>
        <span>
          Deactivating a value hides it from new entries. Records that already store it keep
          rendering it, so history stays readable.
        </span>
      </PanelFooter>
    </Panel>
  )
}

/* --------------------------------------------------------- relation types -- */

function RelationTypesTab() {
  const relationTypes = useRelationTypes()

  return (
    <Panel>
      <PanelHeader
        title="Relation types"
        meta={`${relationTypes.data?.length ?? 0}`}
        action={<span className="text-ink-faint text-xs">Read only in this phase</span>}
      />

      <PanelBody className="p-0">
        {relationTypes.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <TableWrap>
            <Table>
              <Thead>
                <tr>
                  <Th className="w-44">Key</Th>
                  <Th>Forward label</Th>
                  <Th>Reverse label</Th>
                </tr>
              </Thead>
              <Tbody>
                {(relationTypes.data ?? []).map((type) => (
                  <Tr key={type.id}>
                    <Td>
                      <IdChip>{type.key}</IdChip>
                    </Td>
                    <Td>{type.label}</Td>
                    <Td className="text-ink-muted">{type.reverseLabel}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableWrap>
        )}
      </PanelBody>

      <PanelFooter>
        <span>
          One row is stored per connection. Both directions are rendered from these two labels,
          which is why a connection never has to be entered twice.
        </span>
      </PanelFooter>
    </Panel>
  )
}

/* ----------------------------------------------------------- appearance -- */

function AppearanceTab() {
  const { theme, resolved, setTheme } = useTheme()

  const options = [
    { value: 'light' as const, label: 'Light', description: 'Cool gray-green paper stock.' },
    { value: 'dark' as const, label: 'Dark', description: 'Deep slate-teal, same accent hues.' },
    { value: 'system' as const, label: 'Match the system', description: 'Follows the operating system, and keeps following it.' },
  ]

  return (
    <Panel>
      <PanelHeader title="Appearance" action={<span className="text-ink-faint font-mono text-xs">now: {resolved}</span>} />
      <PanelBody>
        <fieldset className="flex flex-col gap-2">
          <legend className="label-caps mb-1">Theme</legend>
          {options.map((option) => (
            <label
              key={option.value}
              className="border-rule hover:border-rule-strong flex cursor-pointer items-start gap-3 rounded-[3px] border p-3 transition-colors duration-[120ms]"
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => setTheme(option.value)}
                className="accent-moss mt-0.5 size-4"
              />
              <span className="min-w-0">
                <span className="text-ink block text-sm font-semibold">{option.label}</span>
                <span className="text-ink-muted block text-13">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="text-ink-faint mt-3 text-xs">
          {THEMES.length} options. Transitions are disabled automatically when the operating system
          asks for reduced motion.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* ---------------------------------------------------------------- users -- */

function UsersTab() {
  const users = useUsers()

  return (
    <Panel>
      <PanelHeader title="Users" meta={`${users.data?.length ?? 0}`} />

      <div className="border-rule border-b p-3">
        <Notice tone="info">
          These are placeholders. Real accounts, invitations, and permissions arrive with the
          backend. The role switcher in the header previews what each role sees.
        </Notice>
      </div>

      <PanelBody className="p-0">
        {users.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <TableWrap>
            <Table>
              <Thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th className="w-44">Role</Th>
                  <Th className="w-48">Last active</Th>
                </tr>
              </Thead>
              <Tbody>
                {(users.data ?? []).map((user) => (
                  <Tr key={user.id}>
                    <Td className="font-medium">{user.name}</Td>
                    <Td className="font-mono text-xs">{user.email}</Td>
                    <Td>{ROLE_LABELS[user.role]}</Td>
                    <Td className="font-mono text-xs">
                      {user.lastActiveAt ? (
                        formatDateTime(user.lastActiveAt)
                      ) : (
                        <span className="text-ink-faint font-sans">never signed in</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableWrap>
        )}
      </PanelBody>
    </Panel>
  )
}

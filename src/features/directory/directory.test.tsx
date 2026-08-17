import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import type { Entity } from '@/lib/data/types'
import { renderWithProviders } from '@/test/render'

/*
  Detail-view behaviour, against the real provider through the real routes.

  These share one module-level provider, which is what the application does
  too, so a test that writes leaves the record changed for later tests in this
  file. Each writing test therefore acts on a record it creates itself.
*/

let property: Entity
let personWithNotes: Entity

beforeAll(async () => {
  const properties = await data.listEntities({ type: 'property', pageSize: 500 })
  const withPin = properties.rows.find((entity) => typeof entity.data.pin === 'string')
  const found = withPin ?? properties.rows[0]
  if (!found) throw new Error('The seeded data has no properties to test against')
  property = found

  const people = await data.listEntities({ type: 'person', pageSize: 500 })
  const person = people.rows[0]
  if (!person) throw new Error('The seeded data has no people to test against')
  personWithNotes = person
})

describe('detail view', () => {
  it('shows every tab and lands on Details', async () => {
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    const tablist = await screen.findByRole('tablist')
    /*
      Connections and Images carry their count in the tab name, so a reader can
      see there are two connections and no images without opening either. The
      name is matched loosely for that reason.
    */
    for (const label of [
      'Details',
      'Images',
      'Connections',
      'Records',
      'Files',
      'Notes',
      'History',
    ]) {
      expect(
        within(tablist).getByRole('tab', { name: new RegExp(`^${label}`) })
      ).toBeInTheDocument()
    }

    expect(within(tablist).getByRole('tab', { name: 'Details', selected: true })).toBeInTheDocument()
  })

  it('renders every field in the schema, including the empty ones', async () => {
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    const grid = within(await screen.findByRole('tabpanel'))
      .getAllByRole('term')
      .map((term) => term.textContent)

    for (const label of ['Lot number', 'Year built', 'Square feet', 'Situs address']) {
      expect(grid).toContain(label)
    }

  })

  it('shows an unfilled field as "Not set" rather than dropping the row', async () => {
    // A lot with nothing but an address, so most of the grid is empty.
    const sparse = await data.createEntity({ type: 'property', name: '1 Empty Field Ln' })

    renderWithProviders(<App />, { route: `/properties/${sparse.id}` })

    const panel = await screen.findByRole('tabpanel')
    expect(within(panel).getAllByText('Not set').length).toBeGreaterThan(3)

    await data.deleteEntity(sparse.id)
  })

  it('keeps zoning and property use as two separate fields', async () => {
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    const labels = within(await screen.findByRole('tabpanel'))
      .getAllByRole('term')
      .map((term) => term.textContent)

    // Collapsing these two would break the "commercial use in a residential
    // district" query, which is a core reason this product exists.
    expect(labels).toContain('Zoning district')
    expect(labels).toContain('Property use')
  })

  it('renders the parcel record with a working viewer link and a disabled refresh', async () => {
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    expect(await screen.findByText('Parcel record')).toBeInTheDocument()

    const pin = String(property.data.pin)
    const link = screen.getByRole('link', { name: new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))

    expect(screen.getByRole('button', { name: /Refresh/ })).toBeDisabled()
    // The card reports when the county last touched the record, taken from the
    // parcel roll's Date_Updated. There is no assessment-year field to show.
    expect(screen.getByText(/County last updated/)).toBeInTheDocument()
  })

  it('derives the jurisdiction from the PIN instead of storing it', async () => {
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    await screen.findByText('Parcel record')
    const pin = String(property.data.pin)
    const expected = pin.startsWith('2') ? 'City of Savannah' : 'Unincorporated Chatham County'
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('moves between tabs and shows the audit trail on History', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    const tablist = await screen.findByRole('tablist')
    await user.click(within(tablist).getByRole('tab', { name: 'History' }))

    expect(await screen.findByRole('tabpanel')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/entries/)).toBeInTheDocument()
    })
  })

  it('groups connections by relation type and labels the direction', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    const tablist = await screen.findByRole('tablist')
    await user.click(within(tablist).getByRole('tab', { name: /^Connections/ }))

    const panel = await screen.findByRole('tabpanel')
    await waitFor(() => {
      expect(within(panel).getByText('Connections')).toBeInTheDocument()
    })

    // Connections are editable now, so this opens rather than being disabled.
    expect(within(panel).getByRole('button', { name: /Add connection/ })).toBeEnabled()
  })

  it('links a connection through to the Connection Map', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    const tablist = await screen.findByRole('tablist')
    await user.click(within(tablist).getByRole('tab', { name: /^Connections/ }))

    const panel = await screen.findByRole('tabpanel')
    expect(within(panel).getByRole('link', { name: /Open in map/ })).toHaveAttribute(
      'href',
      `/map/${property.id}`
    )
  })

  it('labels the files tab as arriving in Phase 2 instead of accepting a file', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/properties/${property.id}` })

    const tablist = await screen.findByRole('tablist')
    await user.click(within(tablist).getByRole('tab', { name: 'Files' }))

    expect(await screen.findByRole('button', { name: /Upload/ })).toBeDisabled()
  })
})

describe('role gating', () => {
  it('hides notes from a resident and drops the tab entirely', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/people/${personWithNotes.id}` })

    const tablist = await screen.findByRole('tablist')
    expect(within(tablist).getByRole('tab', { name: 'Notes' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Preview as role'), 'resident')

    await waitFor(() => {
      expect(within(tablist).queryByRole('tab', { name: 'Notes' })).not.toBeInTheDocument()
    })
  })

  it('removes the add and actions controls for a resident', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/people' })

    expect(await screen.findByRole('button', { name: /Add person/ })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Preview as role'), 'resident')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Add person/ })).not.toBeInTheDocument()
    })
  })
})

describe('creating a record', () => {
  it('validates a bad PIN before writing anything, then saves a good one', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/properties' })

    await user.click(await screen.findByRole('button', { name: /Add property/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Street address/), '99 Test Lane')

    const pinField = within(dialog).getByLabelText(/Parcel number/)
    await user.type(pinField, '2003263001')
    await user.click(within(dialog).getByRole('button', { name: /Add property/ }))

    // The bad PIN is rejected with an explanation, and the dialog stays open.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/11 or 12 characters/)

    await user.clear(pinField)
    await user.type(pinField, '20032 63099')
    await user.click(within(dialog).getByRole('button', { name: /Add property/ }))

    // Saving navigates to the new record.
    expect(
      await screen.findByRole('heading', { name: '99 Test Lane', level: 1 })
    ).toBeInTheDocument()
  })

  it('records the new lot in the audit log as a creation', async () => {
    const created = await data.listEntities({ type: 'property', search: '99 Test Lane' })
    const entity = created.rows[0]
    expect(entity).toBeDefined()
    if (!entity) return

    const history = await data.listAuditEntries(entity.id)
    expect(history.some((row) => row.action === 'insert')).toBe(true)
  })
})

describe('archive and delete', () => {
  it('archives a record and offers to restore it from a banner', async () => {
    const user = userEvent.setup()
    const subject = await data.createEntity({ type: 'person', name: 'Archivable Tester' })

    renderWithProviders(<App />, { route: `/people/${subject.id}` })

    await user.click(await screen.findByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Archive/ }))

    expect(await screen.findByText(/is archived/)).toBeInTheDocument()
    const banner = screen.getByText(/is archived/).closest('div')
    expect(within(banner as HTMLElement).getByRole('button', { name: 'Restore' })).toBeInTheDocument()

    await user.click(within(banner as HTMLElement).getByRole('button', { name: 'Restore' }))
    await waitFor(() => {
      expect(screen.queryByText(/is archived/)).not.toBeInTheDocument()
    })
  })

  it('explains that delete is a soft delete before doing it', async () => {
    const user = userEvent.setup()
    const subject = await data.createEntity({ type: 'person', name: 'Deletable Tester' })

    renderWithProviders(<App />, { route: `/people/${subject.id}` })

    await user.click(await screen.findByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/soft delete/)
    expect(dialog).toHaveTextContent(/not the same as archiving/)

    await user.click(within(dialog).getByRole('button', { name: /Delete person/ }))

    // Back on the list, and the record is gone from it.
    expect(await screen.findByRole('heading', { name: /People/, level: 1 })).toBeInTheDocument()

    const after = await data.getEntity(subject.id)
    expect(after?.deletedAt).not.toBeNull()
  })
})

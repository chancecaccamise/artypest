import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from './App'
import { renderWithProviders } from './test/render'

/*
  Route-level tests. These render the real application against the real
  in-memory provider, so they catch a broken route, a widget that throws on
  empty data, and a page that never leaves its loading state.

  They deliberately avoid asserting on exact figures where the demo data is
  generated relative to today. The arithmetic itself is covered by the unit
  tests in src/lib.
*/

describe('application shell', () => {
  it('lands on the dashboard with the stat strip filled in', async () => {
    renderWithProviders(<App />)

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()

    // The lots tile resolves to a real figure rather than staying a skeleton.
    const lots = await screen.findByText('Lots')
    expect(lots.parentElement?.textContent).toMatch(/\d+/)
  })

  it('renders every navigation group with live counts', async () => {
    renderWithProviders(<App />)

    const nav = await screen.findByRole('navigation', { name: 'Main' })

    for (const label of [
      'Dashboard',
      'Activity',
      'People',
      'Properties',
      'Connection Map',
      'Settings',
    ]) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument()
    }

    await waitFor(() => {
      expect(within(nav).getByRole('link', { name: /Properties/ }).textContent).toMatch(/48/)
    })
  })

  it('searches records from the header', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />)

    const search = await screen.findByRole('combobox', { name: 'Search' })
    await user.type(search, 'ardsley')

    // The association is seeded, so this is a real record from the store.
    const results = await screen.findByRole('listbox', { name: 'Search results' })
    expect(within(results).getByText(/Ardsley Park Homeowners Association/)).toBeInTheDocument()
  })

  it('says nothing matched rather than showing an empty panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />)

    const search = await screen.findByRole('combobox', { name: 'Search' })
    await user.type(search, 'zzzznothinghere')

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument()
  })

  it('routes an unknown path to the not-found page', async () => {
    renderWithProviders(<App />, { route: '/does-not-exist' })

    expect(
      await screen.findByRole('heading', { name: /That page does not exist/, level: 1 })
    ).toBeInTheDocument()
  })
})

describe('directory', () => {
  it('lists every property with a total that matches the seeded data', async () => {
    renderWithProviders(<App />, { route: '/properties' })

    expect(await screen.findByRole('heading', { name: /Properties/, level: 1 })).toBeInTheDocument()

    const table = await screen.findByRole('table')
    await waitFor(() => {
      // 48 lots plus the header row, all inside the first page of 50.
      expect(within(table).getAllByRole('row').length).toBe(49)
    })

    expect(screen.getByText(/1 to 48 of 48/)).toBeInTheDocument()
  })

  it('filters the list from the query string', async () => {
    renderWithProviders(<App />, { route: '/properties?propertyUse=commercial' })

    const table = await screen.findByRole('table')
    await waitFor(() => {
      expect(within(table).getAllByRole('row').length).toBeGreaterThan(1)
    })

    // Every visible row carries the filtered use, so the filter is applied by
    // the provider and not merely reflected in the select.
    const rowCount = within(table).getAllByRole('row').length - 1
    expect(within(table).getAllByText('Commercial')).toHaveLength(rowCount)
  })

  it('shows an empty state that says what to do when nothing matches', async () => {
    renderWithProviders(<App />, { route: '/properties?q=zzzzzznothing' })

    expect(await screen.findByText(/No properties match these filters/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })
})

describe('activity', () => {
  it('renders the audit feed grouped by day', async () => {
    renderWithProviders(<App />, { route: '/activity' })

    expect(await screen.findByRole('heading', { name: /Activity/, level: 1 })).toBeInTheDocument()
    expect(await screen.findAllByRole('heading', { level: 2 })).not.toHaveLength(0)
  })

  it('offers filters for type, action, actor, and a date range', async () => {
    renderWithProviders(<App />, { route: '/activity' })

    expect(await screen.findByLabelText('Record type')).toBeInTheDocument()
    expect(screen.getByLabelText('Action')).toBeInTheDocument()
    expect(screen.getByLabelText('Changed by')).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toBeInTheDocument()
    expect(screen.getByLabelText('To')).toBeInTheDocument()
  })
})

describe('parcel import', () => {
  it('states plainly that parcel data comes from a local sample file', async () => {
    renderWithProviders(<App />, { route: '/parcels' })

    expect(
      await screen.findByText(/Parcel data is loaded from a local sample file/)
    ).toBeInTheDocument()
  })

  it('offers all three sources and no dead Connect button', async () => {
    renderWithProviders(<App />, { route: '/parcels' })

    expect(
      await screen.findByRole('button', { name: /Load sample neighborhood/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Look up these parcels/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Choose a file/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Connect$/ })).not.toBeInTheDocument()
  })
})

describe('settings', () => {
  it('previews the parcel viewer link from the stored template', async () => {
    renderWithProviders(<App />, { route: '/settings' })

    const preview = await screen.findByRole('link', { name: /gis\.chathamcounty\.org/ })
    // The sample PIN is encoded, which is what proves the preview is built by
    // the same function the app uses rather than concatenated in the view.
    expect(preview).toHaveAttribute('href', expect.stringContaining('20032%2063001'))
  })

  it('says which parcel source is active and that SAGIS needs no credentials', async () => {
    renderWithProviders(<App />, { route: '/settings/integrations' })

    /*
      There is no endpoint field and no Connect button any more. SAGIS is a
      public service with no key, so the only real question is which source is
      being read, and that is an environment setting. The tests run offline, so
      the answer here is the committed sample.
    */
    expect(await screen.findByText('Using the local sample')).toBeInTheDocument()
    expect(screen.getByText('local sample of county records')).toBeInTheDocument()
    expect(screen.queryByLabelText('SAGIS endpoint')).not.toBeInTheDocument()
    expect(screen.getByText(/no API key/)).toBeInTheDocument()
  })

  it('lists the ten relation types read only, with both directions', async () => {
    renderWithProviders(<App />, { route: '/settings/relations' })

    const table = await screen.findByRole('table')
    await waitFor(() => {
      expect(within(table).getAllByRole('row').length).toBe(11)
    })
    expect(screen.getByText('Read only in this phase')).toBeInTheDocument()
    expect(within(table).getByText('is owned by')).toBeInTheDocument()
  })
})

describe('connection map', () => {
  it('draws the focus record and its direct connections', async () => {
    renderWithProviders(<App />, { route: '/map' })

    expect(
      await screen.findByRole('heading', { name: 'Connection Map', level: 1 })
    ).toBeInTheDocument()

    // Every non-focus card is a button that re-centres the map.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Centre the map on/ }).length).toBeGreaterThan(0)
    })
  })

  it('offers a type filter chip per connected type', async () => {
    renderWithProviders(<App />, { route: '/map' })

    const chips = await screen.findAllByRole('button', { pressed: true })
    expect(chips.length).toBeGreaterThan(0)
  })
})

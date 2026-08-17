import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { PARCELS } from '@/lib/geo'
import type { Entity } from '@/lib/data/types'
import { normalizePin } from '@/lib/parcels/pin'
import { renderWithProviders } from '@/test/render'

/*
  The plat page, end to end through the real routes and the real provider.

  SVG paths carry a <title>, so a lot is findable by its PIN without reaching
  into the DOM by class name.
*/

const FIRST_PIN = normalizePin(PARCELS.features[0]?.properties.pin ?? '')

let plattedProperty: Entity
let unplacedRecord: Entity

beforeAll(async () => {
  const locations = await data.listLocations()

  const property = locations.propertyByPin.get(FIRST_PIN)
  if (!property) throw new Error('The seeded data has no property on the first platted lot')
  plattedProperty = property

  const unplaced = locations.unplaced[0]
  if (!unplaced) throw new Error('The seeded data places everything, so the tray cannot be tested')
  unplacedRecord = unplaced
})

describe('plat view', () => {
  it('draws every platted lot and the street centrelines', async () => {
    const { container } = renderWithProviders(<App />, { route: '/plat' })

    expect(await screen.findByRole('heading', { name: 'Plat View', level: 1 })).toBeInTheDocument()

    await waitFor(() => {
      expect(container.querySelectorAll('.parcels path').length).toBe(PARCELS.features.length)
    })

    // Streets are a permanent data layer, not a stand-in for a basemap.
    expect(container.querySelectorAll('.streets path').length).toBeGreaterThan(0)
  })

  it('says plainly that there is no basemap', async () => {
    renderWithProviders(<App />, { route: '/plat' })
    expect(await screen.findByText('no basemap')).toBeInTheDocument()
  })

  it('offers explicit zoom and fit controls, since nobody will think to scroll-zoom', async () => {
    renderWithProviders(<App />, { route: '/plat' })

    expect(await screen.findByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fit the whole plat' })).toBeInTheDocument()
  })

  it('selects a lot when its parcel is clicked, and shows what is on it', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<App />, { route: '/plat' })

    await waitFor(() => {
      expect(container.querySelectorAll('.parcels path').length).toBeGreaterThan(0)
    })

    const parcel = [...container.querySelectorAll('.parcels path')].find(
      (path) => path.querySelector('title')?.textContent?.includes(FIRST_PIN) ?? false
    )
    expect(parcel).toBeDefined()
    if (!parcel) return

    await user.click(parcel)

    expect(
      await screen.findByRole('heading', { name: plattedProperty.name, level: 2 })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Notify adjacent owners/ })).toBeInTheDocument()
  })

  it('starts with nothing selected and says so', async () => {
    renderWithProviders(<App />, { route: '/plat' })
    expect(await screen.findByText('Nothing selected')).toBeInTheDocument()
  })

  it('opens with a record selected when the route names one', async () => {
    renderWithProviders(<App />, { route: `/plat/${plattedProperty.id}` })

    expect(
      await screen.findByRole('heading', { name: plattedProperty.name, level: 2 })
    ).toBeInTheDocument()
  })
})

describe('thematic modes', () => {
  it('draws no colouring by default and no legend', async () => {
    renderWithProviders(<App />, { route: '/plat' })

    const select = await screen.findByLabelText('Colour lots by')
    expect(select).toHaveValue('none')
    expect(screen.queryByText('Legend')).not.toBeInTheDocument()
  })

  it('renders a legend with a count per bucket once a mode is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/plat' })

    await user.selectOptions(await screen.findByLabelText('Colour lots by'), 'occupancy')

    expect(await screen.findByText('Legend')).toBeInTheDocument()
    expect(screen.getByText('Owner-occupied')).toBeInTheDocument()
    expect(screen.getByText('Vacant or unknown')).toBeInTheDocument()
  })

  it('lists empty buckets rather than hiding them', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/plat' })

    await user.selectOptions(await screen.findByLabelText('Colour lots by'), 'completeness')

    for (const label of ['Complete', 'No current owner', 'No parcel number', 'Neither on file']) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
  })
})

describe('connection arcs', () => {
  it('draws none until a relation type is switched on', async () => {
    const { container } = renderWithProviders(<App />, { route: '/plat' })

    await waitFor(() => {
      expect(container.querySelectorAll('.parcels path').length).toBeGreaterThan(0)
    })

    expect(container.querySelectorAll('.arcs path')).toHaveLength(0)
    expect(screen.getByText(/Off by default/)).toBeInTheDocument()
  })

  it('draws arcs once a type is switched on', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<App />, { route: '/plat' })

    const ownsChip = await screen.findByRole('button', { name: 'Owns', pressed: false })
    await user.click(ownsChip)
    // Focused on the selection by default, and nothing is selected, so widen it.
    await user.click(screen.getByLabelText('Only the selected record'))

    await waitFor(() => {
      expect(container.querySelectorAll('.arcs path').length).toBeGreaterThan(0)
    })
  })
})

describe('unplaced tray', () => {
  it('surfaces records the cascade could not place', async () => {
    renderWithProviders(<App />, { route: '/plat' })

    expect(await screen.findByText('Unplaced records')).toBeInTheDocument()
    expect(await screen.findByText(/have no location the map can derive/)).toBeInTheDocument()
  })

  it('selects an unplaced record and explains that it has no location', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/plat' })

    const tray = (await screen.findByText('Unplaced records')).closest('.panel') as HTMLElement
    await user.click(within(tray).getByRole('button', { name: unplacedRecord.name }))

    expect(
      await screen.findByText(/No location on file, and none can be derived/)
    ).toBeInTheDocument()
  })
})

describe('split view', () => {
  it('shows the Connection Map beside the plat when split is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/plat/${plattedProperty.id}` })

    await user.click(await screen.findByRole('button', { name: /Split with the Connection Map/ }))

    // The Connection Map re-centres on the selected lot, so its cards appear.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Centre the map on/ }).length).toBeGreaterThan(0)
    })
  })
})

describe('notify adjacent owners', () => {
  it('produces a mailing list de-duplicated by owner', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/plat/${plattedProperty.id}` })

    await user.click(await screen.findByRole('button', { name: /Notify adjacent owners/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/owners across/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Who counts as a neighbour')).toBeInTheDocument()

    // One row per owner, never one per lot.
    const rows = within(dialog).queryAllByRole('row')
    const names = rows
      .slice(1)
      .map((row) => row.querySelector('a')?.textContent)
      .filter(Boolean)
    expect(new Set(names).size).toBe(names.length)
  })

  it('can widen from shared boundaries to a radius in feet', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/plat/${plattedProperty.id}` })

    await user.click(await screen.findByRole('button', { name: /Notify adjacent owners/ }))
    const dialog = await screen.findByRole('dialog')

    const radius = within(dialog).getByLabelText('Who counts as a neighbour')
    expect(radius).toHaveValue('')
    await user.selectOptions(radius, '500')
    expect(radius).toHaveValue('500')
  })
})

describe('location provenance on a record', () => {
  it('states where a location came from on the detail page', async () => {
    renderWithProviders(<App />, { route: `/properties/${plattedProperty.id}` })

    expect(await screen.findByText('Location')).toBeInTheDocument()
    expect(await screen.findByText('From the recorded parcel boundary')).toBeInTheDocument()
    expect(screen.getByText('exact')).toBeInTheDocument()
  })

  it('links from a record to its lot on the plat', async () => {
    renderWithProviders(<App />, { route: `/properties/${plattedProperty.id}` })

    expect(await screen.findByRole('link', { name: /Show on the plat/ })).toHaveAttribute(
      'href',
      `/plat/${plattedProperty.id}`
    )
  })

  it('marks a borrowed location as derived, and says what it was borrowed from', async () => {
    const locations = await data.listLocations()
    const borrowed = [...locations.byEntity.values()].find(
      (location) => location.precision === 'derived' && location.viaEntityId !== null
    )
    expect(borrowed).toBeDefined()
    if (!borrowed) return

    const entity = await data.getEntity(borrowed.entityId)
    expect(entity).not.toBeNull()
    if (!entity) return

    renderWithProviders(<App />, { route: `/people/${entity.id}` })

    expect(await screen.findByText('derived')).toBeInTheDocument()
    expect(screen.getByText(borrowed.explanation)).toBeInTheDocument()
  })
})

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '@/App'
import { entityHref } from '@/components/layout/nav-config'
import { data } from '@/lib/data'
import { arcableKeys, buildArcs, undrawnCounts } from '@/features/map/arcs'
import { parcelHoverLabel } from '@/features/map/parcel-summary'
import { PARCELS } from '@/lib/geo'
import type { Entity } from '@/lib/data/types'
import { resolveGraph } from '@/lib/insights'
import { normalizePin } from '@/lib/parcels/pin'
import { renderWithProviders } from '@/test/render'

/*
  The plat page, end to end through the real routes and the real provider.

  SVG paths carry a <title>, so a lot is findable by its PIN without reaching
  into the DOM by class name.
*/

const FIRST_PIN = normalizePin(PARCELS.features[0]?.properties.pin ?? '')

let plattedProperty: Entity
let plattedHoverLabel: string
/** A record with at least one connection the plat can actually draw a line for. */
let connectedRecord: Entity

beforeAll(async () => {
  const locations = await data.listLocations()

  const property = locations.propertyByPin.get(FIRST_PIN)
  if (!property) throw new Error('The seeded data has no property on the first platted lot')
  plattedProperty = property

  const graph = resolveGraph({
    entities: await data.listAllEntities(),
    relations: await data.listRelations(),
    relationTypes: await data.listRelationTypes(),
  })
  plattedHoverLabel = parcelHoverLabel(plattedProperty, graph)
  const keys = new Set(arcableKeys(graph, locations))

  /*
    Picked rather than named, because most connections have no line to draw:
    an owner who lives in the lot they own sits on the same point at both ends.
    Hard-coding a resident here would tie the test to which of them happens to
    live somewhere else this week.
  */
  const found = graph.entities.find(
    (entity) =>
      entity.deletedAt === null &&
      buildArcs({ graph, locations, keys, focusEntityId: entity.id }).length > 0
  )
  if (!found) throw new Error('No record in the seeded data has a connection the plat can draw')
  connectedRecord = found
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
    /*
      Renamed from "Fit the whole plat" when the plat stopped opening on the
      whole plat. It now opens on the association's records, so fitting the
      county is the way back out rather than the state you start in, and the
      label has to say which of the two it does.
    */
    expect(
      screen.getByRole('button', { name: 'Fit every lot the county recorded' })
    ).toBeInTheDocument()
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

    await user.hover(parcel)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(plattedHoverLabel)
    expect(screen.getByRole('tooltip')).toHaveTextContent(FIRST_PIN)

    await user.click(parcel)

    expect(
      await screen.findByRole('heading', { name: plattedProperty.name, level: 2 })
    ).toBeInTheDocument()
    expect(screen.getByText('Parcel connections')).toBeInTheDocument()
    expect(
      screen.getAllByRole('link').some((link) => link.getAttribute('href')?.startsWith('mailto:'))
    ).toBe(true)
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

  it('keeps the connection workspace in place once a colouring is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/plat' })

    await user.selectOptions(await screen.findByLabelText('Colour lots by'), 'occupancy')

    expect(screen.queryByText('Legend')).not.toBeInTheDocument()
    expect(await screen.findByText('Parcel connections')).toBeInTheDocument()
  })

  it('removes the old colouring explanation panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/plat' })

    await user.selectOptions(await screen.findByLabelText('Colour lots by'), 'completeness')
    expect(screen.queryByText(/Choose a colouring above/)).not.toBeInTheDocument()
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

describe('parcel connection workspace', () => {
  it('replaces the unplaced-record and colouring panels', async () => {
    renderWithProviders(<App />, { route: '/plat' })

    expect(await screen.findByText('Parcel connections')).toBeInTheDocument()
    expect(screen.getByText('Select a parcel to see its connections')).toBeInTheDocument()
    expect(screen.queryByText('Unplaced records')).not.toBeInTheDocument()
    expect(screen.queryByText(/Choose a colouring above/)).not.toBeInTheDocument()
  })

  it('shows the selected parcel name in the connection workspace', async () => {
    renderWithProviders(<App />, { route: `/plat/${plattedProperty.id}` })
    const heading = await screen.findByText('Parcel connections')
    const panel = heading.closest('.panel') as HTMLElement
    expect(within(panel).getByText(plattedProperty.name)).toBeInTheDocument()
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

    renderWithProviders(<App />, { route: entityHref(entity.type, entity.id) })

    expect(await screen.findByText('derived')).toBeInTheDocument()
    expect(screen.getByText(borrowed.explanation)).toBeInTheDocument()
  })
})

describe('from the Connection Map to the plat', () => {
  it('hands the record over with its connections already drawn, and only its own', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<App />, { route: `/map/${connectedRecord.id}` })

    await user.click(await screen.findByRole('link', { name: 'Open in Plat View' }))

    // Switched on by arriving, not by hunting for the button once here.
    expect(await screen.findByRole('button', { name: 'Hide connections' })).toBeInTheDocument()
    await waitFor(() => {
      expect(container.querySelectorAll('.arcs path').length).toBeGreaterThan(0)
    })
    expect(screen.getByLabelText('Only the selected record')).toBeChecked()

    // Every arc on the drawing touches the record that was handed over.
    const locations = await data.listLocations()
    const graph = resolveGraph({
      entities: await data.listAllEntities(),
      relations: await data.listRelations(),
      relationTypes: await data.listRelationTypes(),
    })
    const drawn = buildArcs({
      graph,
      locations,
      keys: new Set(arcableKeys(graph, locations)),
      focusEntityId: connectedRecord.id,
    })
    expect(container.querySelectorAll('.arcs path')).toHaveLength(drawn.length)
  })

  it('counts what is missing from this record rather than from the association', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/map/${connectedRecord.id}` })

    await user.click(await screen.findByRole('link', { name: 'Open in Plat View' }))
    await screen.findByRole('button', { name: 'Hide connections' })

    const locations = await data.listLocations()
    const graph = resolveGraph({
      entities: await data.listAllEntities(),
      relations: await data.listRelations(),
      relationTypes: await data.listRelationTypes(),
    })
    const keys = new Set(arcableKeys(graph, locations))
    const scoped = undrawnCounts(graph, locations, keys, connectedRecord.id)
    const association = undrawnCounts(graph, locations, keys)

    /*
      The note used to report the association's counts whatever was on screen,
      so a reader looking at one resident's four connections was told ninety of
      them had no line to draw.
    */
    expect(association.sameLocation).toBeGreaterThan(scoped.sameLocation)

    if (scoped.sameLocation === 0 && scoped.unplacedEnd === 0) {
      expect(screen.queryByText(/no line to draw/)).not.toBeInTheDocument()
      expect(screen.queryByText(/one end with no location/)).not.toBeInTheDocument()
      return
    }
    if (scoped.sameLocation > 0) {
      const note = await screen.findByText(/no line to draw/)
      expect(note.textContent).not.toContain(String(association.sameLocation))
    }
  })

  it('leaves the connections off when the plat is opened without them', async () => {
    const { container } = renderWithProviders(<App />, {
      route: `/plat/${connectedRecord.id}`,
    })

    expect(await screen.findByRole('button', { name: 'Show connections' })).toBeInTheDocument()
    expect(container.querySelectorAll('.arcs path')).toHaveLength(0)
  })
})

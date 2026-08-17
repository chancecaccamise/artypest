import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { renderWithProviders } from '@/test/render'

/*
  Connecting one record to another, from the record itself.

  This used to be labelled as arriving in Phase 2. The direction is the part
  worth testing: a relation is stored once and read from both ends, so `owns`
  the wrong way round says a lot owns a person.
*/

let person: { id: string; name: string }
let lot: { id: string; name: string }

beforeEach(async () => {
  const people = await data.listEntities({ type: 'person', pageSize: 1 })
  const lots = await data.listEntities({ type: 'property', pageSize: 1 })
  person = { id: people.rows[0]?.id ?? '', name: people.rows[0]?.name ?? '' }
  lot = { id: lots.rows[0]?.id ?? '', name: lots.rows[0]?.name ?? '' }
})

async function openConnections(id: string) {
  const user = userEvent.setup()
  renderWithProviders(<App />, { route: `/people/${id}?tab=connections` })
  await screen.findByRole('tabpanel')
  return user
}

describe('adding a connection', () => {
  it('opens a dialog from the record', async () => {
    const user = await openConnections(person.id)

    await user.click(await screen.findByRole('button', { name: /Add connection/ }))
    expect(await screen.findByRole('dialog', { name: /Add a connection/ })).toBeInTheDocument()
  })

  it('spells out which way round the connection will read', async () => {
    const user = await openConnections(person.id)
    await user.click(await screen.findByRole('button', { name: /Add connection/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Connect to/), lot.name)

    const options = await within(dialog).findAllByRole('button', { name: new RegExp(lot.name) })
    await user.click(options[0] as HTMLElement)

    /*
      The sentence is the whole point. A reader choosing a direction from a
      dropdown of relation labels should not have to work out what it means.
    */
    const sentence = await within(dialog).findByText(/This will read:/)
    // Both ends and the relation label, in one readable line.
    expect(sentence).toHaveTextContent(new RegExp(person.name))
    expect(sentence).toHaveTextContent(new RegExp(lot.name))
  })

  it('saves the connection and shows it on the record', async () => {
    const user = await openConnections(person.id)
    await user.click(await screen.findByRole('button', { name: /Add connection/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Connect to/), lot.name)
    const options = await within(dialog).findAllByRole('button', { name: new RegExp(lot.name) })
    await user.click(options[0] as HTMLElement)
    await user.click(within(dialog).getByRole('button', { name: 'Add connection' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    const panel = screen.getByRole('tabpanel')
    expect(await within(panel).findByRole('link', { name: lot.name })).toBeInTheDocument()
  })

  it('refuses to save without a record to connect to', async () => {
    const user = await openConnections(person.id)
    await user.click(await screen.findByRole('button', { name: /Add connection/ }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add connection' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Choose the record/)
    // Still open, so nothing typed is lost.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('writes the new connection into the record history', async () => {
    const user = await openConnections(person.id)
    await user.click(await screen.findByRole('button', { name: /Add connection/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Connect to/), lot.name)
    const options = await within(dialog).findAllByRole('button', { name: new RegExp(lot.name) })
    await user.click(options[0] as HTMLElement)
    await user.click(within(dialog).getByRole('button', { name: 'Add connection' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // "Unit 42 changed hands" is the highest-value entry in the log.
    const relations = await data.listRelations(person.id)
    expect(relations.some((relation) => relation.toEntityId === lot.id)).toBe(true)
  })
})

describe('removing a connection', () => {
  it('asks first, and says that ending is usually the truthful action', async () => {
    const user = await openConnections(person.id)

    const remove = await screen.findAllByRole('button', { name: /Remove the connection to/ })
    await user.click(remove[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog', { name: /Remove this connection/ })
    expect(dialog).toHaveTextContent(/end date/)
  })
})

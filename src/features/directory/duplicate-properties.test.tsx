import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import type { Entity } from '@/lib/data/types'
import { readString } from '@/lib/format'
import { renderWithProviders } from '@/test/render'

/*
  A lot that is already on file, added again.

  The county layer holds every lot in the corridor, so "+ Property" from the
  connection dialog was making a second record for a lot that was already
  there, and the two split its connections between them.
*/

let person: Entity
let lot: Entity

beforeEach(async () => {
  const people = await data.listEntities({ type: 'person', pageSize: 1 })
  const lots = await data.listEntities({ type: 'property', pageSize: 500 })
  person = people.rows[0] as Entity
  lot = lots.rows.find((row) => readString(row.data.pin) !== '') as Entity
})

describe('adding a property that is already on file', () => {
  it('offers the existing lot from the connection dialog instead of a second record', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/people/${person.id}?tab=connections` })

    await user.click(await screen.findByRole('button', { name: /Add connection/ }))
    const dialog = await screen.findByRole('dialog', { name: /Add a connection/ })
    await user.click(within(dialog).getByRole('button', { name: 'Property' }))

    const form = await screen.findByRole('dialog', { name: /New property to connect to/ })
    await user.type(within(form).getByLabelText(/Parcel number|PIN/), readString(lot.data.pin))

    expect(await within(form).findByText(/is already on file as/)).toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: new RegExp(`^Use ${lot.name}`) }))

    const back = await screen.findByRole('dialog', { name: /Add a connection/ })
    expect(await within(back).findByText(/This will read:/)).toHaveTextContent(lot.name)
  })

  it('refuses a second record with the same parcel number', async () => {
    const before = (await data.listAllEntities()).length
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/people/${person.id}?tab=connections` })

    await user.click(await screen.findByRole('button', { name: /Add connection/ }))
    const dialog = await screen.findByRole('dialog', { name: /Add a connection/ })
    await user.click(within(dialog).getByRole('button', { name: 'Property' }))

    const form = await screen.findByRole('dialog', { name: /New property to connect to/ })
    await user.type(within(form).getByLabelText(/Street address/), 'Somewhere else')
    await user.type(within(form).getByLabelText(/Parcel number|PIN/), readString(lot.data.pin))
    await user.click(within(form).getByRole('button', { name: 'Add as a separate property' }))

    expect(await within(form).findByText(`Already on file as ${lot.name}.`)).toBeInTheDocument()
    expect((await data.listAllEntities()).length).toBe(before)
  })
})

describe('merging a duplicate that already exists', () => {
  it('says so on the record, and folds it into the other one', async () => {
    const duplicate = await data.createEntity({
      type: 'property',
      name: lot.name,
      data: { pin: lot.data.pin },
    })
    const types = await data.listRelationTypes()
    const rents = types.find((type) => type.key === 'rents')
    await data.createRelation({
      relationTypeId: rents?.id ?? '',
      fromEntityId: person.id,
      toEntityId: duplicate.id,
    })

    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/properties/${duplicate.id}` })

    expect(await screen.findByText(/Another property has the same parcel number/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Merge the two/ }))

    const dialog = await screen.findByRole('dialog', { name: /Merge duplicate/ })
    // The county's copy is suggested as the one to keep.
    expect(within(dialog).getAllByRole('radio')[1]).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: `Merge into ${lot.name}` }))

    await waitFor(async () => {
      expect((await data.getEntity(duplicate.id))?.deletedAt).not.toBeNull()
    })
    const moved = await data.listRelations(lot.id)
    expect(moved.some((relation) => relation.fromEntityId === person.id)).toBe(true)
  })
})

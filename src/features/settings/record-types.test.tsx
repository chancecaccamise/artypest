import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { renderWithProviders } from '@/test/render'

/*
  Settings, Record types. The board asked to work on these the way it works on
  relation types while it settles which ones it uses.
*/

describe('record types in settings', () => {
  it('has a tab of its own, and Reference data no longer offers the list', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/settings/record-types' })

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Covenant violation')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Reference data' }))
    const list = await screen.findByRole('combobox', { name: 'List' })
    expect(within(list).queryByRole('option', { name: 'Record type' })).not.toBeInTheDocument()
  })

  it('adds, renames, and removes a record type', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/settings/record-types' })

    await user.type(await screen.findByLabelText('New record type'), 'Parking violation')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    const table = screen.getByRole('table')
    expect(await within(table).findByText('Parking violation')).toBeInTheDocument()

    await user.click(within(table).getByRole('button', { name: 'Rename Parking violation' }))
    const name = within(table).getByRole('textbox', { name: 'Rename Parking violation' })
    await user.clear(name)
    await user.type(name, 'Parking')
    await user.click(within(table).getByRole('button', { name: 'Save' }))
    expect(await within(table).findByText('Parking')).toBeInTheDocument()

    await user.click(within(table).getByRole('button', { name: 'Remove Parking' }))
    await user.click(within(table).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(within(table).queryByText('Parking')).not.toBeInTheDocument())
  })

  it('explains why a type in use cannot be removed', async () => {
    await data.createEntity({
      type: 'record',
      name: 'Gutter complaint',
      data: { recordType: 'complaint' },
    })
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/settings/record-types' })

    const table = await screen.findByRole('table')
    await user.click(await within(table).findByRole('button', { name: 'Remove Complaint' }))
    expect(within(table).getByText(/records? uses? "Complaint"\. Change/)).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('refuses a name the list already has', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/settings/record-types' })

    await user.type(await screen.findByLabelText('New record type'), 'complaint')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(
      await screen.findByText('There is already a record type called "complaint".')
    ).toBeInTheDocument()
  })
})

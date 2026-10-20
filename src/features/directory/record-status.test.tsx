import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { renderWithProviders } from '@/test/render'

/*
  Changing a record's status without opening the edit form.

  It used to be a text box in the form, so "Closed" typed with a capital was a
  status nothing else recognised.
*/

async function overdueRecord() {
  return data.createEntity({
    type: 'record',
    name: 'Fence height complaint',
    data: { recordType: 'todo', status: 'open', followUpDate: '2020-01-01' },
  })
}

describe('record status', () => {
  it('offers only Open, On hold, and Closed', async () => {
    const record = await overdueRecord()
    renderWithProviders(<App />, { route: `/records/${record.id}` })

    const status = await screen.findByRole('combobox', { name: 'Status' })
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Open', 'On hold', 'Closed'])
  })

  it('changes from the record page header', async () => {
    const record = await overdueRecord()
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/records/${record.id}` })

    const status = await screen.findByRole('combobox', { name: 'Status' })
    expect(status).toHaveValue('open')
    await user.selectOptions(status, 'On hold')

    await waitFor(async () => {
      expect((await data.getEntity(record.id))?.data.status).toBe('on_hold')
    })
  })

  it('closes an overdue record from the Needs attention line, which clears it', async () => {
    const record = await overdueRecord()
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/records/${record.id}` })

    const attention = await screen.findByRole('region', { name: 'Needs attention' })
    await user.click(within(attention).getByRole('button', { name: 'Mark closed' }))

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
    })
    expect((await data.getEntity(record.id))?.data.status).toBe('closed')
  })

  it('is a choice from a list in the edit form, not a text box', async () => {
    const record = await overdueRecord()
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/records/${record.id}` })

    await user.click(await screen.findByRole('button', { name: /Actions/ }))
    await user.click(screen.getByRole('menuitem', { name: /Edit/ }))
    const form = await screen.findByRole('dialog', { name: /Edit record/ })
    const status = within(form).getByLabelText('Status')
    expect(status.tagName).toBe('SELECT')
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Open', 'On hold', 'Closed'])
  })
})

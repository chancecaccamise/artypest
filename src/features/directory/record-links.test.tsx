import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { renderWithProviders } from '@/test/render'

/*
  Linking a new record to what it is about, so a letter to an association
  shows on that association's page.
*/

describe('records linked to the directory', () => {
  it('links a new record to an item, and lists it on that item', async () => {
    const recipient = await data.createEntity({
      type: 'association',
      name: 'Ardsley Park Garden Club',
    })
    const user = userEvent.setup()
    const form = renderWithProviders(<App />, { route: '/records' })

    await user.click(await screen.findByRole('button', { name: 'Add record' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add record' })
    await user.type(
      within(dialog).getByRole('textbox', { name: /Name/ }),
      'Draft letter to the garden club'
    )
    await user.type(
      within(dialog).getByRole('searchbox', { name: 'Find in the directory' }),
      'Ardsley Park Garden'
    )
    await user.click(
      await within(dialog).findByRole('button', { name: /Ardsley Park Garden Club/ })
    )
    expect(
      within(dialog).getByRole('button', { name: 'Unlink Ardsley Park Garden Club' })
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Add record' }))

    await waitFor(async () => {
      const relations = await data.listRelations(recipient.id)
      expect(relations).toHaveLength(1)
    })
    const [relation] = await data.listRelations(recipient.id)
    const types = await data.listRelationTypes()
    expect(types.find((type) => type.id === relation?.relationTypeId)?.key).toBe('references')

    form.unmount()
    renderWithProviders(<App />, { route: `/associations/${recipient.id}` })
    await user.click(await screen.findByRole('tab', { name: /^Records/ }))
    expect(await screen.findByText('Draft letter to the garden club')).toBeInTheDocument()
  })

  it('offers linking only when adding a record', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/assets' })
    await user.click(await screen.findByRole('button', { name: 'Add asset' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add asset' })
    expect(within(dialog).queryByText('Linked to')).not.toBeInTheDocument()
  })
})

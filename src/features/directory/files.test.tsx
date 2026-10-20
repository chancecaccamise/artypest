import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { filesOf } from '@/lib/files'
import { renderWithProviders } from '@/test/render'

/*
  Files on an asset, which the board asked for so warranties and inspection
  reports live with the pump they are about.
*/

function warranty(): File {
  return new File(['%PDF-1.4 warranty'], 'warranty.pdf', { type: 'application/pdf' })
}

describe('files on a record', () => {
  it('attaches files chosen while adding an asset', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/assets' })

    await user.click(await screen.findByRole('button', { name: 'Add asset' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add asset' })
    await user.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Pool pump')
    await user.upload(within(dialog).getByLabelText('Choose files to attach'), warranty())
    expect(within(dialog).getByText('warranty.pdf')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }))

    await waitFor(async () => {
      const page = await data.listEntities({ type: 'asset', search: 'Pool pump' })
      const [asset] = page.rows
      expect(asset ? filesOf(asset).map((file) => file.name) : []).toEqual(['warranty.pdf'])
    })
  })

  it('asks only for a name, a date, and the file when adding a document', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/documents' })

    await user.click(await screen.findByRole('button', { name: 'Add document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add document' })
    // The file says what it is and how long it is, so the form no longer asks.
    expect(within(dialog).queryByText('Document type')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Pages')).not.toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Bylaws, 2026')
    await user.upload(within(dialog).getByLabelText('Choose files to attach'), warranty())
    await user.click(within(dialog).getByRole('button', { name: 'Add document' }))

    await waitFor(async () => {
      const page = await data.listEntities({ type: 'document', search: 'Bylaws, 2026' })
      const [document] = page.rows
      expect(document ? filesOf(document).map((file) => file.name) : []).toEqual(['warranty.pdf'])
    })
  })

  it('attaches and removes files from the Files tab', async () => {
    const asset = await data.createEntity({ type: 'asset', name: 'Clubhouse HVAC' })
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/assets/${asset.id}` })

    await user.click(await screen.findByRole('tab', { name: /^Files/ }))
    await user.upload(screen.getByLabelText('Choose files'), warranty())

    expect(await screen.findByRole('button', { name: 'warranty.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Files/ })).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Remove warranty.pdf' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('No files attached')).toBeInTheDocument()
  })

  it('refuses a file over the limit and says why', async () => {
    const asset = await data.createEntity({ type: 'asset', name: 'Gate motor' })
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/assets/${asset.id}` })

    await user.click(await screen.findByRole('tab', { name: /^Files/ }))
    const huge = new File([new Uint8Array(data.maxFileBytes + 1)], 'manual.pdf', {
      type: 'application/pdf',
    })
    await user.upload(screen.getByLabelText('Choose files'), huge)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /manual\.pdf is .* Files can be up to/
    )
  })
})

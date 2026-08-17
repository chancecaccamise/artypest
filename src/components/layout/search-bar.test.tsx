import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { renderWithProviders } from '@/test/render'

/*
  The header search, driven the way it is actually used: typed at, then either
  clicked or driven with the keyboard.
*/

async function typeSearch(text: string) {
  const user = userEvent.setup()
  renderWithProviders(<App />)
  const input = await screen.findByRole('combobox', { name: 'Search' })
  await user.type(input, text)
  return { user, input }
}

describe('header search', () => {
  it('finds a lot by its address, and the people at that address', async () => {
    await typeSearch('1402 e 49th')

    const results = await screen.findByRole('listbox', { name: 'Search results' })
    const options = within(results).getAllByRole('option')

    // The lot itself leads, because its name is the address.
    expect(options[0]).toHaveTextContent('1402 E 49TH ST')

    /*
      Residents whose mailing address is that lot come back too, which is the
      point of searching across records rather than only lot names.
    */
    expect(options.length).toBeGreaterThan(1)
    expect(within(results).getAllByText(/1402 E 49TH ST/).length).toBeGreaterThan(1)
  })

  it('opens the record when a result is clicked', async () => {
    const { user } = await typeSearch('ardsley park homeowners')

    const results = await screen.findByRole('listbox', { name: 'Search results' })
    await user.click(within(results).getAllByRole('option')[0] as HTMLElement)

    // The detail page for that record, not the directory list.
    expect(
      await screen.findByRole('heading', { name: /Ardsley Park Homeowners Association/, level: 1 })
    ).toBeInTheDocument()
  })

  it('is drivable from the keyboard alone', async () => {
    const { user } = await typeSearch('ardsley park homeowners')

    await screen.findByRole('listbox', { name: 'Search results' })
    await user.keyboard('{Enter}')

    expect(
      await screen.findByRole('heading', { name: /Ardsley Park Homeowners Association/, level: 1 })
    ).toBeInTheDocument()
  })

  it('moves the highlight with the arrow keys', async () => {
    const { user } = await typeSearch('a')

    const results = await screen.findByRole('listbox', { name: 'Search results' })
    const first = within(results).getAllByRole('option')[0]
    expect(first).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(first).toHaveAttribute('aria-selected', 'false')
  })

  it('closes on Escape without losing what was typed', async () => {
    const { user, input } = await typeSearch('ardsley')

    await screen.findByRole('listbox', { name: 'Search results' })
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument()
    })
    // The query survives, so a mistyped Escape is not destructive.
    expect(input).toHaveValue('ardsley')
  })

  it('reports itself as a combobox, so it is announced as one', async () => {
    const { input } = await typeSearch('ardsley')

    await screen.findByRole('listbox', { name: 'Search results' })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-activedescendant')
  })

  it('has a clear control once there is something to clear', async () => {
    const { user, input } = await typeSearch('ardsley')

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(input).toHaveValue('')
  })
})

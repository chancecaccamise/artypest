import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { renderWithProviders } from '@/test/render'

/*
  Dashboard widgets, against the real provider.

  Figures are asserted as shapes rather than as values, because the demo data
  is generated relative to today. The arithmetic behind them is covered by
  src/lib/insights.test.ts.
*/

describe('stat strip', () => {
  it('renders all six tiles with resolved figures', async () => {
    renderWithProviders(<App />)

    const strip = (await screen.findByText('Lots')).closest('.panel') as HTMLElement

    for (const label of [
      'Lots',
      'Residents',
      // Also a segment name in the occupancy legend, so it is scoped here.
      'Owner-occupied',
      'Active vendors',
      'Board seats',
      'Open items',
    ]) {
      expect(within(strip).getByText(label)).toBeInTheDocument()
    }

    // Board seats read as "filled of total", not as a bare number.
    await waitFor(() => {
      expect(within(strip).getByText(/^\d+ \/ \d+$/)).toBeInTheDocument()
    })
  })

  it('recomputes from current records after a dashboard write', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />)

    const strip = (await screen.findByText('Lots')).closest('.panel') as HTMLElement
    const openItemsLabel = within(strip).getByText('Open items')
    const tile = openItemsLabel.parentElement as HTMLElement
    const before = Number(tile.querySelector('.text-2xl')?.textContent ?? '0')

    await user.click(screen.getByRole('button', { name: 'Add record' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Name/), 'Dashboard refresh regression')
    await user.type(within(dialog).getByLabelText('Status'), 'open')
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }))

    await waitFor(() => {
      expect(Number(tile.querySelector('.text-2xl')?.textContent ?? '0')).toBe(before + 1)
    })
  })
})

describe('needs attention', () => {
  it('lists items, each linking to the record it is about', async () => {
    renderWithProviders(<App />)

    const heading = await screen.findByText('Needs attention')
    const panel = heading.closest('.panel')
    expect(panel).not.toBeNull()

    await waitFor(() => {
      expect(within(panel as HTMLElement).getAllByRole('link').length).toBeGreaterThan(0)
    })
  })

  it('surfaces at least one overdue item from the seeded data', async () => {
    renderWithProviders(<App />)
    expect(await screen.findByText(/\d+ overdue/)).toBeInTheDocument()
  })
})

describe('board and committees', () => {
  it('shows an editable empty state until the real board roster is entered', async () => {
    renderWithProviders(<App />)

    const heading = await screen.findByText('Board and committees')
    const panel = heading.closest('.panel') as HTMLElement

    expect(await within(panel).findByText('No current board seats on record')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Manage' })).toBeEnabled()
  })

  it('adds and removes current members from the dashboard', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />)

    const heading = await screen.findByText('Board and committees')
    const panel = heading.closest('.panel') as HTMLElement
    await user.click(await within(panel).findByRole('button', { name: 'Manage' }))

    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Person *'), 'Kay Heritage')
    await user.selectOptions(within(dialog).getByLabelText('Position *'), 'Member')
    await user.click(within(dialog).getByRole('button', { name: 'Add member' }))

    await waitFor(() => {
      expect(within(panel).getByRole('link', { name: 'Kay Heritage' })).toBeInTheDocument()
    })

    await user.click(within(dialog).getByRole('button', { name: 'Remove Kay Heritage' }))
    await waitFor(() => {
      expect(within(panel).queryByRole('link', { name: 'Kay Heritage' })).not.toBeInTheDocument()
    })
  })
})

describe('occupancy', () => {
  it('accounts for every lot across the four segments', async () => {
    renderWithProviders(<App />)

    const heading = await screen.findByText('Occupancy')
    const panel = heading.closest('.panel') as HTMLElement

    for (const label of [
      'Owner-occupied',
      'Long-term rental',
      'Short-term rental',
      'Vacant or unknown',
    ]) {
      expect(await within(panel).findByText(label)).toBeInTheDocument()
    }

    // The bar is a labelled image, not a decorative div, so it is readable.
    expect(within(panel).getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Owner-occupied')
    )
  })
})

describe('recent activity', () => {
  it('groups the feed by day and links to the full page', async () => {
    renderWithProviders(<App />)

    const heading = await screen.findByText('Recent activity')
    const panel = heading.closest('.panel') as HTMLElement

    expect(within(panel).getByRole('link', { name: 'Full activity' })).toHaveAttribute(
      'href',
      '/activity'
    )
    await waitFor(() => {
      expect(within(panel).getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0)
    })
  })
})

describe('quick add', () => {
  it('opens the add dialog for the type that was clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />)

    await user.click(await screen.findByRole('button', { name: 'Add business' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: /Add business/ })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('does not render the Connection Map preview card', async () => {
    renderWithProviders(<App />)

    await screen.findByRole('button', { name: 'Add business' })
    expect(screen.queryByRole('link', { name: /Open map/ })).not.toBeInTheDocument()
  })
})

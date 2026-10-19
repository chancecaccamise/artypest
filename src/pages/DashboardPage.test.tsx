import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { renderWithProviders } from '@/test/render'

/*
  Dashboard widgets, against the real provider.

  Figures are asserted as shapes rather than as values, because the demo data
  is generated relative to today. The arithmetic behind them is covered by
  src/lib/insights.test.ts.
*/

describe('the dashboard', () => {
  it('shows only Needs attention and Recent activity', async () => {
    renderWithProviders(<App />)

    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText('Recent activity')).toBeInTheDocument()

    for (const removed of ['Lots', 'Open items', 'Board and committees', 'Occupancy']) {
      expect(screen.queryByText(removed)).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Add business' })).not.toBeInTheDocument()
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

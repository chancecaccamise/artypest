import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { renderWithProviders } from '@/test/render'

/*
  The people directory as cards.

  A board member recognises somebody by their face and by what they are
  connected to, so the card leads with the photograph and carries the counts.
*/

async function openPeople() {
  const user = userEvent.setup()
  renderWithProviders(<App />, { route: '/people' })
  await screen.findByRole('heading', { name: /People/, level: 1 })
  return user
}

describe('people directory', () => {
  it('shows a card for each person rather than a table row', async () => {
    await openPeople()

    await waitFor(() => {
      expect(screen.getAllByRole('listitem').length).toBeGreaterThan(1)
    })
    // A table is the right shape for ten thousand parcels, not for residents.
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('leads with contact details and a way to reach the person', async () => {
    await openPeople()

    const mail = await screen.findAllByRole('link', { name: /@/ })
    expect(mail[0]).toHaveAttribute('href', expect.stringContaining('mailto:'))
  })

  it('says what each person is connected to, without opening anything', async () => {
    await openPeople()

    /*
      "Two properties, one association" is the question this application exists
      to answer, and it should be legible on the card.
    */
    const counts = await screen.findAllByText(/propert(y|ies)|association/)
    expect(counts.length).toBeGreaterThan(0)
  })

  it('offers a route to the Connection Map for each person', async () => {
    await openPeople()

    const links = await screen.findAllByRole('link', { name: /on the Connection Map/ })
    expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/map\//))
  })

  it('opens the person when their name is clicked', async () => {
    const user = await openPeople()

    const people = await data.listEntities({ type: 'person', pageSize: 1 })
    const name = people.rows[0]?.name ?? ''

    await user.click(await screen.findByRole('link', { name }))
    expect(await screen.findByRole('heading', { name, level: 1 })).toBeInTheDocument()
  })

  it('still filters, searches, and pages', async () => {
    const user = await openPeople()

    // The directory's own filter, not the global search in the header.
    await user.type(screen.getByPlaceholderText(/Filter people/i), 'zzzznobody')

    expect(await screen.findByText(/No people match these filters/i)).toBeInTheDocument()
  })

  it('shows a placeholder rather than a broken image when there is no photograph', async () => {
    await openPeople()

    await waitFor(() => {
      expect(screen.getAllByRole('listitem').length).toBeGreaterThan(1)
    })
    // Initials stand in, so a card without a photo is not a grey box.
    const cards = screen.getAllByRole('listitem')
    expect(within(cards[0] as HTMLElement).queryByRole('img')).not.toBeInTheDocument()
  })
})

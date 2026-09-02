import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { renderWithProviders } from '@/test/render'

/*
  The hand mark and the work log, driven through the real application.

  These exist because the interesting failures here are not in the rules, which
  have their own tests, but in the wiring: a mark that never reaches a row, a
  toggle that opens the record instead of checking it, a panel that shows an
  empty list because it asked the wrong question.
*/

async function openProperties(route = '/properties') {
  const user = userEvent.setup()
  renderWithProviders(<App />, { route })
  await screen.findByRole('heading', { name: /Properties/, level: 1 })
  await screen.findByRole('table')
  return user
}

describe('the hand mark in the directory', () => {
  it('marks each row with whether a person has read it', async () => {
    await openProperties()

    const checked = await screen.findAllByRole('button', {
      name: /Clear the check on this record/,
    })
    const unchecked = await screen.findAllByRole('button', {
      name: /Mark this record as checked/,
    })

    // Both states present at once is the whole point: the reader is meant to
    // be able to tell, down a column, what is left.
    expect(checked.length).toBeGreaterThan(0)
    expect(unchecked.length).toBeGreaterThan(0)
  })

  it('says in words who checked a record and when', async () => {
    await openProperties()

    const marks = await screen.findAllByRole('button', {
      name: /Checked by .+ on .+\. Clear the check/,
    })
    expect(marks.length).toBeGreaterThan(0)
  })

  /*
    The row is clickable and so is the mark inside it. Checking a record must
    not navigate away from the list being worked.
  */
  it('checks a record in place, without opening it', async () => {
    const user = await openProperties()

    const before = await screen.findAllByRole('button', {
      name: /Mark this record as checked/,
    })
    const target = before[0]
    expect(target).toBeDefined()

    await user.click(target!)

    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: /Mark this record as checked/ }).length
      ).toBe(before.length - 1)
    })
    // Still on the list.
    expect(screen.getByRole('heading', { name: /Properties/, level: 1 })).toBeInTheDocument()
  })

  it('filters the directory down to a work queue', async () => {
    const user = await openProperties()

    const total = Number(
      screen.getByRole('heading', { name: /Properties/, level: 1 }).parentElement?.textContent
        ?.replace(/\D/g, '') ?? '0'
    )

    await user.selectOptions(screen.getByLabelText('Checked'), 'unchecked')

    await waitFor(() => {
      expect(
        screen.queryAllByRole('button', { name: /Clear the check on this record/ })
      ).toHaveLength(0)
    })

    const remaining = await screen.findAllByRole('button', {
      name: /Mark this record as checked/,
    })
    expect(remaining.length).toBeGreaterThan(0)
    expect(remaining.length).toBeLessThanOrEqual(total)
  })

  it('has a queue for records the county has rewritten since the check', async () => {
    const user = await openProperties()
    await user.selectOptions(screen.getByLabelText('Checked'), 'recheck')

    const marks = await screen.findAllByRole('button', { name: /the county has changed/ })
    expect(marks.length).toBeGreaterThan(0)
  })

  it('reads the filter out of the address, so a queue is a link', async () => {
    await openProperties('/properties?review=recheck')
    expect(await screen.findByLabelText('Checked')).toHaveValue('recheck')
  })
})

describe('the work log', () => {
  async function openLog() {
    const user = await openProperties()
    await user.click(screen.getByRole('button', { name: /Work log/ }))
    return { user, panel: await screen.findByRole('complementary', { name: 'Work log' }) }
  }

  it('opens from the header and stays open across the app', async () => {
    const { panel } = await openLog()
    expect(within(panel).getByText('Where you were')).toBeInTheDocument()
  })

  /*
    "What was the last one I did" is the question somebody comes back with
    after looking away at a printed list, and it is the reason the panel is
    pinned rather than scrolled to.
  */
  it('names the last record touched, as a link back to it', async () => {
    const { user, panel } = await openLog()

    const target = screen.getAllByRole('button', { name: /Mark this record as checked/ })[0]
    expect(target).toBeDefined()
    await user.click(target!)

    await waitFor(() => {
      const where = within(panel).getByText('Where you were').parentElement
      expect(within(where!).getByRole('link')).toBeInTheDocument()
    })
  })

  it('counts the session in the header, so it is visible without opening', async () => {
    const { user, panel } = await openLog()

    /*
      From a known boundary. The provider is a module singleton, so whatever
      the tests before this one checked is still in the log; starting a fresh
      session is what makes "one record" mean one record.
    */
    await user.click(within(panel).getByRole('button', { name: 'Start fresh' }))
    await screen.findByRole('button', { name: 'Work log. Nothing recorded this session.' })

    const target = screen.getAllByRole('button', { name: /Mark this record as checked/ })[0]
    expect(target).toBeDefined()
    await user.click(target!)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Work log. 1 record this session.' })
      ).toBeInTheDocument()
    })
  })

  it('says how much of the list is left, and links to it', async () => {
    const { user, panel } = await openLog()

    const target = screen.getAllByRole('button', { name: /Mark this record as checked/ })[0]
    await user.click(target!)

    const still = await within(panel).findByRole('link', { name: /still to check/ })
    expect(still).toHaveAttribute('href', '/properties?review=unchecked')
  })

  it('empties without touching the records when a fresh session is started', async () => {
    const { user, panel } = await openLog()

    const target = screen.getAllByRole('button', { name: /Mark this record as checked/ })[0]
    await user.click(target!)
    await within(panel).findByRole('link', { name: /still to check/ })

    await user.click(within(panel).getByRole('button', { name: 'Start fresh' }))

    await waitFor(() => {
      expect(within(panel).getByText(/Nothing yet\. Check or change a record/)).toBeInTheDocument()
    })
    // The check itself survives: only the log's starting point moved.
    expect(
      screen.getAllByRole('button', { name: /Clear the check on this record/ }).length
    ).toBeGreaterThan(0)
  })
})

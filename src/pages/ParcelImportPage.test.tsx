import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { RAW_PARCEL_FIXTURE } from '@/lib/parcels/FixtureParcelService'
import { normalizePin } from '@/lib/parcels/pin'
import { renderWithProviders } from '@/test/render'

/*
  The import, end to end through the real screen and the real provider.

  Two parcels are used rather than the whole sample: one that already has a
  matching lot in the directory, and one that does not, so the run exercises
  both an update and a create in a single pass.
*/

/*
  Parcels 0 to 39 have a seeded lot, 40 to 59 do not. Index 5 is one of the
  lots the fixtures deliberately leave stale, so the Match step has a real
  old-to-new diff to render rather than an empty one.
*/
const MATCHED = RAW_PARCEL_FIXTURE[5]
const UNMATCHED = RAW_PARCEL_FIXTURE[45]

if (!MATCHED || !UNMATCHED) {
  throw new Error('The parcel fixture is smaller than the import tests expect')
}

describe('parcel import, four steps', () => {
  it('walks source to result and writes exactly what the summary promised', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/parcels' })

    /* Step 1: paste two parcel numbers. */
    const textarea = await screen.findByLabelText('Parcel numbers')
    await user.click(textarea)
    await user.paste(`${MATCHED.pin}\n${UNMATCHED.pin}`)
    await user.click(screen.getByRole('button', { name: /Look up these parcels/ }))

    /* Step 2: both parcels are found and preselected. */
    const previewTable = await screen.findByRole('table', {}, { timeout: 3000 })
    await waitFor(() => {
      expect(within(previewTable).getAllByRole('row').length).toBe(3)
    })
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument()
    expect(screen.getByText(MATCHED.situsAddress)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Match 2 parcels/ }))

    /* Step 3: one update with a diff, one create. */
    await screen.findByText(/to create, .* to update/)
    expect(screen.getByRole('link', { name: /^matches / })).toBeInTheDocument()
    expect(screen.getByText(/not in the directory/)).toBeInTheDocument()

    // The stale lot shows what would change, so nothing changes silently.
    expect(screen.getByText('Assessed value')).toBeInTheDocument()

    // The county owner name is shown next to the form a person would type.
    expect(screen.getAllByText(MATCHED.ownerName).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /Review the summary/ }))

    /* Step 4: the summary, then the run. */
    expect(await screen.findByText('Properties to create')).toBeInTheDocument()
    const before = await data.countsByType()

    await user.click(screen.getByRole('button', { name: /Run the import/ }))

    expect(await screen.findByText('Import complete', {}, { timeout: 5000 })).toBeInTheDocument()

    const after = await data.countsByType()
    expect(after.property).toBe(before.property + 1)

    /* The new lot really exists, with the parcel data attached. */
    const created = await data.listEntities({
      type: 'property',
      search: normalizePin(UNMATCHED.pin),
      pageSize: 10,
    })
    expect(created.rows).toHaveLength(1)
    expect(created.rows[0]?.data.parcelSource).toBe('imported')
    expect(created.rows[0]?.data.zoning).toBe(UNMATCHED.zoningDistrict)

    /* The result screen links to this import's own rows in Activity. */
    const reviewLink = screen.getByRole('link', { name: /Review this batch in Activity/ })
    expect(reviewLink).toHaveAttribute('href', expect.stringContaining('/activity?batch='))
  })

  it('reports parcel numbers that are not in the sample rather than dropping them', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/parcels' })

    const textarea = await screen.findByLabelText('Parcel numbers')
    await user.click(textarea)
    await user.paste(`${MATCHED.pin}\n29999 00001`)
    await user.click(screen.getByRole('button', { name: /Look up these parcels/ }))

    expect(await screen.findByText(/not in the sample file/)).toBeInTheDocument()
    expect(screen.getByText('29999 00001')).toBeInTheDocument()
  })

  it('says so plainly when none of the pasted numbers exist', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/parcels' })

    const textarea = await screen.findByLabelText('Parcel numbers')
    await user.click(textarea)
    await user.paste('29999 00002\n29999 00003')
    await user.click(screen.getByRole('button', { name: /Look up these parcels/ }))

    expect(
      await screen.findByText(/None of those 2 parcel numbers are in the sample file/)
    ).toBeInTheDocument()
  })

  it('rejects input that contains no parcel numbers at all', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/parcels' })

    const textarea = await screen.findByLabelText('Parcel numbers')

    // Whitespace alone cannot even be submitted: the button stays disabled.
    await user.click(textarea)
    await user.paste('   ')
    expect(screen.getByRole('button', { name: /Look up these parcels/ })).toBeDisabled()

    // A file that is nothing but a header row parses to zero parcel numbers.
    await user.clear(textarea)
    await user.click(textarea)
    await user.paste('PIN,Address')
    await user.click(screen.getByRole('button', { name: /Look up these parcels/ }))

    expect(await screen.findByText(/No parcel numbers were found/)).toBeInTheDocument()
  })
})

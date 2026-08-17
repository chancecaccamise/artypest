import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import { renderWithProviders } from '@/test/render'

/*
  Images on a record. The upload path itself needs a canvas, which jsdom does
  not have, so what is checked here is everything around it: the tab, the count,
  the empty state, and that a stored image is rendered and can be made the
  profile photograph.
*/

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

async function personWithImages(images: string[], photo = '') {
  const people = await data.listEntities({ type: 'person', pageSize: 1 })
  const person = people.rows[0]
  if (!person) throw new Error('The demo data has no people.')

  await data.updateEntity(person.id, {
    data: { ...person.data, images, photo },
  })
  return person
}

describe('images tab', () => {
  it('says so plainly when a record has none', async () => {
    const people = await data.listEntities({ type: 'person', pageSize: 1 })
    renderWithProviders(<App />, { route: `/people/${people.rows[0]?.id ?? ''}?tab=images` })

    expect(await screen.findByText(/No images on this record/)).toBeInTheDocument()
  })

  it('counts the images on the tab, so the count is visible without opening it', async () => {
    const person = await personWithImages([PIXEL, PIXEL])
    renderWithProviders(<App />, { route: `/people/${person.id}` })

    const tablist = await screen.findByRole('tablist')
    expect(within(tablist).getByRole('tab', { name: /^Images/ })).toHaveTextContent('2')
  })

  it('renders the images that are stored', async () => {
    const person = await personWithImages([PIXEL])
    renderWithProviders(<App />, { route: `/people/${person.id}?tab=images` })

    const image = await screen.findByRole('img', { name: new RegExp(`on ${person.name}`) })
    expect(image).toHaveAttribute('src', PIXEL)
  })

  it('lets one image become the profile photograph', async () => {
    const user = userEvent.setup()
    const person = await personWithImages([PIXEL])
    renderWithProviders(<App />, { route: `/people/${person.id}?tab=images` })

    await user.click(await screen.findByRole('button', { name: /Use this as the profile/ }))

    const updated = await data.getEntity(person.id)
    expect(updated?.data.photo).toBe(PIXEL)
  })

  it('does not leave the profile photograph pointing at a removed image', async () => {
    const user = userEvent.setup()
    const person = await personWithImages([PIXEL], PIXEL)
    renderWithProviders(<App />, { route: `/people/${person.id}?tab=images` })

    await user.click(await screen.findByRole('button', { name: /Remove image 1/ }))

    const updated = await data.getEntity(person.id)
    expect(updated?.data.images).toEqual([])
    // Otherwise the card would show a broken image.
    expect(updated?.data.photo).toBe('')
  })
})

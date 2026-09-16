import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import App from '@/App'
import { data } from '@/lib/data'
import type { Entity } from '@/lib/data/types'
import { renderWithProviders } from '@/test/render'

const TITLE = 'Follow up with reminder test contact'
let person: Entity
let createdId: string | null = null

beforeAll(async () => {
  const people = await data.listEntities({ type: 'person', pageSize: 100 })
  const found = people.rows.find((entity) => entity.archivedAt === null)
  if (!found) throw new Error('No active person is available for the reminder test')
  person = found
})

afterAll(async () => {
  if (!createdId) return
  const created = await data.getEntity(createdId)
  if (created?.deletedAt === null) await data.deleteEntity(createdId)
})

describe('person and business reminders', () => {
  it('creates a to do, surfaces it on the dashboard, and removes it when completed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: `/people/${person.id}?tab=todo` })

    expect(await screen.findByRole('tab', { name: /To do/, selected: true })).toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: 'Add to do' }))[0]!)

    const dialog = await screen.findByRole('dialog', { name: `Add a to do for ${person.name}` })
    await user.type(within(dialog).getByLabelText('What needs to be done *'), TITLE)
    await user.type(within(dialog).getByLabelText('Due date *'), '2020-01-02')
    await user.type(within(dialog).getByLabelText('Details'), 'Call and confirm the next step.')
    await user.click(within(dialog).getByRole('button', { name: 'Add to do' }))

    expect((await screen.findAllByText(TITLE)).length).toBeGreaterThan(0)
    const created = (await data.listEntities({ type: 'record', pageSize: 500 })).rows.find(
      (entity) => entity.name === TITLE
    )
    expect(created).toBeDefined()
    createdId = created?.id ?? null

    await user.click(screen.getByRole('link', { name: 'Dashboard' }))
    const dashboardLines = await screen.findAllByText(TITLE)
    const dashboardLine = dashboardLines.find(
      (line) => line.closest('a')?.getAttribute('href') === `/people/${person.id}?tab=todo`
    )
    expect(dashboardLine).toBeDefined()

    await user.click(dashboardLine!)
    await user.click(await screen.findByRole('button', { name: `Complete ${TITLE}` }))
    await waitFor(async () => {
      expect((await data.getEntity(createdId ?? ''))?.data.status).toBe('closed')
    })

    await user.click(screen.getByRole('link', { name: 'Dashboard' }))
    await waitFor(() => {
      const openReminderLinks = screen.queryAllByText(TITLE).filter(
        (line) => line.closest('a')?.getAttribute('href') === `/people/${person.id}?tab=todo`
      )
      expect(openReminderLinks).toHaveLength(0)
    })
  })
})

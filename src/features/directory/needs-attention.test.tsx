import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import App from '@/App'
import { entityHref } from '@/components/layout/nav-config'
import { data } from '@/lib/data'
import type { Entity, Relation } from '@/lib/data/types'
import { computeNeedsAttention, resolveGraph, type AttentionItem } from '@/lib/insights'
import { renderWithProviders } from '@/test/render'

/*
  A Needs attention line followed from the dashboard should still be in front
  of the reader when they arrive on the record. Driven through the real routes
  and the real provider; nothing here writes.
*/

let items: AttentionItem[]
let quiet: Entity
let termPerson: Entity
let noContactPerson: Entity
let termRelation: Relation

beforeAll(async () => {
  const [setupRelationTypes, associations] = await Promise.all([
    data.listRelationTypes(),
    data.listEntities({ type: 'association', pageSize: 100 }),
  ])
  const memberOf = setupRelationTypes.find((type) => type.key === 'member_of')
  const association = associations.rows[0]
  if (!memberOf || !association) throw new Error('Board test fixtures are unavailable')

  termPerson = await data.createEntity({
    type: 'person',
    name: 'Attention Test Member',
    data: { email: 'attention@example.com', phone: null },
  })
  noContactPerson = await data.createEntity({
    type: 'person',
    name: 'Missing Contact Test Person',
    data: { email: null, phone: null },
  })
  const termEnd = new Date()
  termEnd.setDate(termEnd.getDate() + 30)
  termRelation = await data.createRelation({
    relationTypeId: memberOf.id,
    fromEntityId: termPerson.id,
    toEntityId: association.id,
    endDate: termEnd.toISOString().slice(0, 10),
    attributes: { role: 'board', position: 'secretary' },
  })

  const [entities, relations, relationTypes] = await Promise.all([
    data.listAllEntities(),
    data.listRelations(),
    data.listRelationTypes(),
  ])
  const graph = resolveGraph({ entities, relations, relationTypes })
  items = computeNeedsAttention(graph)

  const flagged = new Set(items.map((item) => item.entityId))
  const found = entities.find(
    (entity) =>
      entity.type === 'person' &&
      entity.deletedAt === null &&
      entity.archivedAt === null &&
      !flagged.has(entity.id)
  )
  if (!found) throw new Error('The seeded data has no person with nothing needing attention')
  quiet = found
})

afterAll(async () => {
  await data.deleteRelation(termRelation.id)
  await Promise.all([data.deleteEntity(termPerson.id), data.deleteEntity(noContactPerson.id)])
})

function itemOfKind(kind: AttentionItem['kind']): AttentionItem {
  const item = items.find((candidate) => candidate.kind === kind)
  if (!item) throw new Error(`The seeded data raises no ${kind} item`)
  return item
}

describe('needs attention on a record', () => {
  it('carries the line clicked on the dashboard onto the record it opens', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />)

    const term = itemOfKind('term')
    const dashboardLine = await screen.findByText(term.description)
    const dashboardPanel = dashboardLine.closest('a')
    if (!dashboardPanel) throw new Error('The dashboard attention line is not linked')
    const line = dashboardPanel.textContent ?? ''
    await user.click(dashboardPanel)

    expect(
      await screen.findByRole('heading', { name: termPerson.name, level: 1 })
    ).toBeInTheDocument()

    const panel = await screen.findByRole('region', { name: 'Needs attention' })
    expect(within(panel).getByText(term.description)).toBeInTheDocument()
    expect(line).toContain(within(panel).getByText(/term ends/).textContent)
    expect(within(panel).getByText(/in \d+ days/)).toBeInTheDocument()
  })

  it('opens the connections, where a term is changed', async () => {
    const user = userEvent.setup()
    const term = itemOfKind('term')
    renderWithProviders(<App />, { route: entityHref(term.entityType, term.entityId) })

    const panel = await screen.findByRole('region', { name: 'Needs attention' })
    await user.click(within(panel).getAllByRole('button', { name: 'Open connections' })[0]!)

    expect(screen.getByRole('tab', { name: /^Connections/, selected: true })).toBeInTheDocument()
  })

  it('opens the edit form for a missing detail', async () => {
    const user = userEvent.setup()
    const gap = itemOfKind('no-contact')
    renderWithProviders(<App />, { route: entityHref(gap.entityType, gap.entityId) })

    const panel = await screen.findByRole('region', { name: 'Needs attention' })
    await user.click(within(panel).getByRole('button', { name: 'Add email or phone' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('shows nothing at all on a record with nothing wrong', async () => {
    const { queryClient } = renderWithProviders(<App />, {
      route: entityHref(quiet.type, quiet.id),
    })

    expect(await screen.findByRole('heading', { name: quiet.name, level: 1 })).toBeInTheDocument()
    // Nothing still loading, so absence is an answer rather than a race.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
  })
})

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { EntityFormDialog } from '@/features/directory/EntityFormDialog'
import { data } from '@/lib/data'
import type { Entity } from '@/lib/data/types'
import { renderWithProviders } from '@/test/render'

let placeableProperties: Entity[] = []

beforeAll(async () => {
  const [entities, locations] = await Promise.all([data.listAllEntities(), data.listLocations()])
  placeableProperties = entities
    .filter(
      (entity) =>
        entity.type === 'property' &&
        entity.deletedAt === null &&
        entity.archivedAt === null &&
        locations.byEntity.has(entity.id)
    )
    .slice(0, 2)

  if (placeableProperties.length < 2) throw new Error('The test needs two placeable properties')
})

async function selectProperty(
  dialog: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
  property: Entity
) {
  const search = within(dialog).getByLabelText('Find a property')
  await user.type(search, property.name)
  const results = await within(dialog).findByRole('list', { name: 'Property results' })
  const name = await within(results).findByText(property.name)
  await user.click(name.closest('button') as HTMLButtonElement)
}

async function removeCreated(entity: Entity) {
  const relations = await data.listRelations(entity.id)
  await Promise.all(relations.map((relation) => data.deleteRelation(relation.id)))
  await data.deleteEntity(entity.id)
}

describe('property links while creating records', () => {
  it('links a person to multiple owned properties and resolves their map location', async () => {
    const user = userEvent.setup()
    let created: Entity | undefined

    renderWithProviders(
      <EntityFormDialog
        open
        onClose={vi.fn()}
        type="person"
        onCreated={(entity) => {
          created = entity
        }}
      />
    )

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Name/), 'Mapped Person Test')
    await selectProperty(dialog, user, placeableProperties[0] as Entity)
    await selectProperty(dialog, user, placeableProperties[1] as Entity)
    await user.click(within(dialog).getByRole('button', { name: 'Add person' }))

    await waitFor(() => expect(created).toBeDefined())
    if (!created) return

    const relations = await data.listRelations(created.id)
    expect(relations).toHaveLength(2)
    expect(new Set(relations.map((relation) => relation.toEntityId))).toEqual(
      new Set(placeableProperties.map((property) => property.id))
    )

    const location = await data.resolveLocation(created.id)
    expect(location?.source).toBe('ownership')
    expect(placeableProperties.map((property) => property.id)).toContain(location?.viaEntityId)

    await removeCreated(created)
  })

  it('places a business through a general property association', async () => {
    const user = userEvent.setup()
    let created: Entity | undefined

    renderWithProviders(
      <EntityFormDialog
        open
        onClose={vi.fn()}
        type="business"
        onCreated={(entity) => {
          created = entity
        }}
      />
    )

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Name/), 'Mapped Business Test')
    await user.selectOptions(within(dialog).getByLabelText('Relationship'), 'Associated with')
    await selectProperty(dialog, user, placeableProperties[0] as Entity)
    await user.click(within(dialog).getByRole('button', { name: 'Add business' }))

    await waitFor(() => expect(created).toBeDefined())
    if (!created) return

    const location = await data.resolveLocation(created.id)
    expect(location?.source).toBe('related')
    expect(location?.viaEntityId).toBe(placeableProperties[0]?.id)

    await removeCreated(created)
  })
})

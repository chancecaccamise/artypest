import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Entity, ResolvedLocation } from '@/lib/data/types'
import { centroidForPin, platPins } from '@/lib/geo'

import type { MapArc } from './arcs'
import { PlatView, type PlatMarker } from './PlatView'

/*
  The dots on the plat. They were four pixels across, answered only with the
  browser's slow native tooltip, and a dot sitting on a lot let every click
  through to the lot, so following a connection to its end selected the
  property underneath and lost the reader's place.
*/

const [LOT_A = '', LOT_B = '', LOT_C = ''] = platPins()

function entity(id: string, type: Entity['type'], name: string): Entity {
  return {
    id,
    orgId: 'org',
    type,
    name,
    data: {},
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }
}

function onLot(record: Entity, pin: string): PlatMarker {
  const point = centroidForPin(pin)
  if (!point) throw new Error(`No centroid for ${pin}`)
  const location: ResolvedLocation = {
    entityId: record.id,
    point,
    source: 'ownership',
    precision: 'derived',
    viaEntityId: null,
    viaEntityName: null,
    explanation: `Owns ${pin}`,
    pin,
  }
  return { entity: record, location, onDrawnLot: true }
}

const association = entity('assoc', 'association', 'Thomas Square Neighborhood Association')
const brewery = entity('brew', 'business', '1st City Brewing')
const bystander = entity('quiet', 'person', 'Nobody Connected')

const markers = [onLot(association, LOT_A), onLot(brewery, LOT_B), onLot(bystander, LOT_C)]

const arc: MapArc = {
  relationId: 'rel-1',
  relationKey: 'member_of',
  relationLabel: 'is a member of',
  fromEntityId: brewery.id,
  toEntityId: association.id,
  fromName: brewery.name,
  toName: association.name,
  from: markers[1]?.location.point ?? [0, 0],
  to: markers[0]?.location.point ?? [0, 0],
  current: true,
  startDate: null,
}

function renderPlat(handlers: { onSelectEntity?: () => void; onSelectPin?: () => void } = {}) {
  return render(
    <PlatView
      theming={{ colorForPin: () => 'var(--paper)', legend: [], mode: 'none' } as never}
      litPins={null}
      selectedPin={null}
      markers={markers}
      selectedEntityId={association.id}
      arcs={[arc]}
      onSelectPin={handlers.onSelectPin ?? (() => {})}
      onSelectEntity={handlers.onSelectEntity ?? (() => {})}
      labelForPin={(pin) => pin}
      placingEntity={null}
      onPlace={() => {}}
    />
  )
}

function dot(container: HTMLElement, id: string): Element {
  const found = container.querySelector(`[data-entity-id="${id}"]`)
  if (!found) throw new Error(`No dot for ${id}`)
  return found
}

describe('dots on the plat', () => {
  it('previews a record on hover, with a link that opens it in a new tab', () => {
    const { container } = renderPlat()
    fireEvent.pointerEnter(dot(container, brewery.id))

    const preview = screen.getByRole('dialog', { name: 'Preview of 1st City Brewing' })
    expect(preview).toHaveTextContent(
      '1st City Brewing is a member of Thomas Square Neighborhood Association'
    )
    const link = screen.getByRole('link', { name: 'Open in a new tab' })
    expect(link).toHaveAttribute('href', `/businesses/${brewery.id}`)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('keeps the preview open while the pointer moves into it', async () => {
    const { container } = renderPlat()
    fireEvent.pointerEnter(dot(container, brewery.id))
    fireEvent.pointerLeave(dot(container, brewery.id))
    const preview = screen.getByRole('dialog', { name: 'Preview of 1st City Brewing' })
    fireEvent.pointerEnter(preview)

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(screen.getByRole('dialog', { name: 'Preview of 1st City Brewing' })).toBeInTheDocument()

    fireEvent.pointerLeave(preview)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('selects the record at the end of a connection, not the lot beneath it', () => {
    const onSelectEntity = vi.fn()
    const onSelectPin = vi.fn()
    const { container } = renderPlat({ onSelectEntity, onSelectPin })

    fireEvent.click(dot(container, brewery.id))
    expect(onSelectEntity).toHaveBeenCalledWith(brewery.id)
    expect(onSelectPin).not.toHaveBeenCalled()
  })

  it('leaves a dot nothing points at to its lot, so the lot can still be clicked', () => {
    const { container } = renderPlat()
    expect(dot(container, bystander.id)).toHaveAttribute('pointer-events', 'none')
    expect(dot(container, brewery.id)).not.toHaveAttribute('pointer-events')
  })
})

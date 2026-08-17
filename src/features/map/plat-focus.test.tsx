import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { PlatView } from './PlatView'
import { PARCELS, platPins } from '@/lib/geo'

/*
  Selecting a record elsewhere in the app routes to /plat/:id. Before this, the
  plat highlighted the lot and left the view where it was, which at corridor
  scale means landing on a two pixel mark somewhere in six kilometres of city.
*/

const PINS = platPins()

function renderPlat(selectedPin: string | null) {
  return render(
    <PlatView
      theming={{ colorForPin: () => 'var(--paper)', legend: [], mode: 'none' } as never}
      litPins={null}
      selectedPin={selectedPin}
      markers={[]}
      selectedEntityId={null}
      arcs={[]}
      onSelectPin={() => {}}
      onSelectEntity={() => {}}
      labelForPin={(pin) => pin}
      placingEntity={null}
      onPlace={() => {}}
    />
  )
}

/** The transform d3 has written onto the group that carries the drawing. */
function currentTransform(container: HTMLElement): string {
  const group = container.querySelector('svg > g')
  return group?.getAttribute('transform') ?? ''
}

describe('navigating to a selected lot', () => {
  it('moves the view when a lot is selected from outside the plat', () => {
    const { container, rerender } = renderPlat(null)
    const before = currentTransform(container)

    rerender(
      <PlatView
        theming={{ colorForPin: () => 'var(--paper)', legend: [], mode: 'none' } as never}
        litPins={null}
        selectedPin={PINS[3] ?? null}
        markers={[]}
        selectedEntityId={null}
        arcs={[]}
        onSelectPin={() => {}}
        onSelectEntity={() => {}}
        labelForPin={(pin) => pin}
        placingEntity={null}
        onPlace={() => {}}
      />
    )

    // It has to actually go somewhere. Highlighting a lot the reader cannot
    // find is the bug being fixed.
    expect(currentTransform(container)).not.toBe(before)
    expect(currentTransform(container)).toMatch(/scale\(/)
  })

  it('does nothing when there is no selection', () => {
    const { container } = renderPlat(null)
    // zoomIdentity, so no scaling has been applied.
    expect(currentTransform(container)).toBe('translate(0,0) scale(1)')
  })

  it('survives a pin that is not on the plat', () => {
    // A record whose parcel was never harvested still selects; the plat simply
    // has nowhere to go, and must not throw.
    expect(() => renderPlat('29999 99999')).not.toThrow()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('reaches every lot the plat draws', () => {
    for (const pin of PINS.slice(0, 12)) {
      const { container, unmount } = renderPlat(pin)
      expect(currentTransform(container), pin).toMatch(/scale\(/)
      unmount()
    }
  })

  it('has a ceiling high enough to read one lot in the corridor', async () => {
    /*
      A lot is about two pixels across when the whole corridor is framed, so a
      ceiling of 20 could only ever reach fifty pixels. The zoom-in control has
      to still be usable well past that.
    */
    const user = userEvent.setup()
    const { container } = renderPlat(null)

    const zoomIn = screen.getByRole('button', { name: /zoom in/i })
    for (let press = 0; press < 8; press += 1) {
      if ((zoomIn as HTMLButtonElement).disabled) break
      await user.click(zoomIn)
    }

    const scale = Number(/scale\(([\d.]+)\)/.exec(currentTransform(container))?.[1] ?? '1')
    expect(scale).toBeGreaterThan(20)
  })
})

describe('the plat fixture', () => {
  it('has lots to navigate to', () => {
    expect(PARCELS.features.length).toBeGreaterThan(0)
    expect(PINS.length).toBe(PARCELS.features.length)
  })
})

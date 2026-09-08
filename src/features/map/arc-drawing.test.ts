import { describe, expect, it } from 'vitest'

import { arcStroke, toggleAllArcKeys } from './arcs'

/*
  How an arc is drawn on the plat, and what the one button in the control row
  does. Both are pure, so neither needs a projection or a DOM to test.
*/

describe('how heavily an arc is drawn', () => {
  it('draws bold arcs thicker and more visible than plain ones', () => {
    const plain = arcStroke({ current: true })
    const bold = arcStroke({ current: true, bold: true })

    expect(bold.strokeWidth).toBeGreaterThan(plain.strokeWidth)
    expect(bold.opacity).toBeGreaterThan(plain.opacity)
  })

  it('never lets grading make the plat louder than not grading', () => {
    for (const bold of [false, true]) {
      const ungraded = arcStroke({ current: true, bold })
      for (const strength of [0.3, 0.55, 1]) {
        expect(arcStroke({ current: true, strength, bold }).opacity).toBeLessThanOrEqual(
          ungraded.opacity + 1e-9
        )
      }
    }
  })

  it('lifts the age ramp rather than flattening it', () => {
    const oldest = arcStroke({ current: true, strength: 0.3, bold: true }).opacity
    const middle = arcStroke({ current: true, strength: 0.6, bold: true }).opacity
    const newest = arcStroke({ current: true, strength: 1, bold: true }).opacity

    expect(oldest).toBeLessThan(middle)
    expect(middle).toBeLessThan(newest)
    // The faintest bold arc is about as visible as a plain one used to be, so
    // switching Age on with Bold lines on never loses an arc off the bottom.
    expect(oldest).toBeGreaterThanOrEqual(arcStroke({ current: true }).opacity - 0.01)
  })

  it('keeps an ended connection quieter than a current one, and dashed', () => {
    for (const bold of [false, true]) {
      expect(arcStroke({ current: false, bold }).opacity).toBeLessThan(
        arcStroke({ current: true, bold }).opacity
      )
      expect(arcStroke({ current: false, bold }).strokeDasharray).toBeDefined()
      expect(arcStroke({ current: true, bold }).strokeDasharray).toBeUndefined()
    }
  })
})

describe('the Show connections button', () => {
  const available = ['owns', 'resides_at', 'member_of']

  it('switches every kind on from nothing', () => {
    expect([...toggleAllArcKeys(new Set(), available)]).toEqual(available)
  })

  it('switches everything off again, including a part-selected row', () => {
    expect(toggleAllArcKeys(new Set(available), available).size).toBe(0)
    // One chip on is still "shown", so the button reads Hide and clears it.
    expect(toggleAllArcKeys(new Set(['owns']), available).size).toBe(0)
  })

  it('has nothing to switch on when no connection has both ends placed', () => {
    expect(toggleAllArcKeys(new Set(), []).size).toBe(0)
  })
})

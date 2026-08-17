import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  /*
    Work is saved to localStorage now, so a test that creates a record would
    otherwise leave it behind for the next one. Cleared here rather than in each
    test, because the leak is invisible until something unrelated fails.
  */
  localStorage.clear()
})

/*
  jsdom implements neither of these, and both are load-bearing: the Connection
  Map measures its container with a ResizeObserver, and the theme provider asks
  the operating system what it prefers.
*/

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub
}

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn() as typeof Element.prototype.scrollTo
}

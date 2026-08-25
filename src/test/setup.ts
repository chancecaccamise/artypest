import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

/*
  This file is the setup for every test, and not every test runs in a browser.
  The schema suite runs the migrations against Postgres and declares
  `@vitest-environment node`, where `window` and `localStorage` do not exist, so
  everything below is guarded rather than assumed. Without the guard the node
  tests fail during setup, before a single assertion runs.
*/
const inBrowser = typeof window !== 'undefined'

afterEach(() => {
  if (!inBrowser) return
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

if (inBrowser && !('ResizeObserver' in globalThis)) {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub
}

if (inBrowser && !window.matchMedia) {
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

if (inBrowser && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn() as typeof Element.prototype.scrollTo
}

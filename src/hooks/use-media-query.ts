import { useCallback, useSyncExternalStore } from 'react'

/*
  A CSS media query, as a value.

  Almost everything responsive in this app is done in CSS, which is the right
  default. This exists for the case CSS cannot express: rendering a component
  once, in one of two places in the tree. Two copies behind `hidden` and
  `lg:hidden` would both mount, both run their queries, and both land in the
  accessibility tree as the same landmark.

  useSyncExternalStore rather than an effect that calls setState. The match is
  something the browser already knows: reading it is a subscription, not a
  render that then corrects itself.
*/
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    [query]
  )

  const read = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }, [query])

  // Server snapshot: nothing is rendered on a server here, and false is the
  // narrow layout, which is the one that works everywhere.
  return useSyncExternalStore(subscribe, read, () => false)
}

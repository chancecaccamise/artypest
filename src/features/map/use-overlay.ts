import { useEffect, useState } from 'react'

import {
  loadOverlay,
  loadOverlayIndex,
  type OverlayCollection,
  type OverlayDefinition,
} from '@/lib/overlays'

/*
  Which district boundaries are available, and the one currently chosen.

  Both halves are fetched rather than bundled. The index is small and arrives
  once; a boundary set is fetched the first time it is picked and cached for the
  life of the page, so switching back to one already seen is instant.
*/
export interface OverlayState {
  available: OverlayDefinition[]
  active: string
  setActive: (id: string) => void
  collection: OverlayCollection | null
  loading: boolean
}

export function useOverlay(): OverlayState {
  const [available, setAvailable] = useState<OverlayDefinition[]>([])
  const [active, setActive] = useState('')
  /*
    What has landed, and which overlay it belongs to.

    Kept as one value rather than as a collection plus a loading flag. Two
    pieces of state describing one thing drift: a reader who switches overlay
    twice quickly gets the first fetch landing after the second, and a separate
    flag has no way to know that. Holding the id alongside the data makes
    "loading" and "showing the wrong one" both derivable instead of tracked.
  */
  const [loaded, setLoaded] = useState<{ id: string; collection: OverlayCollection | null } | null>(
    null
  )

  useEffect(() => {
    let cancelled = false
    void loadOverlayIndex().then((rows) => {
      if (!cancelled) setAvailable(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (active === '') return

    let cancelled = false
    void loadOverlay(active).then((collection) => {
      if (!cancelled) setLoaded({ id: active, collection })
    })
    return () => {
      cancelled = true
    }
  }, [active])

  // Nothing chosen is not loading, and a stale result is not this overlay's.
  const settled = loaded?.id === active
  return {
    available,
    active,
    setActive,
    collection: settled ? (loaded?.collection ?? null) : null,
    loading: active !== '' && !settled,
  }
}

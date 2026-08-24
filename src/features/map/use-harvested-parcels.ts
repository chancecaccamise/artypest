import type { FeatureCollection, LineString, MultiPolygon, Polygon } from 'geojson'
import { useEffect, useState } from 'react'

import type { ParcelProperties, StreetProperties } from '@/lib/geo'
import { loadParcelGeometry, loadParcelStreets } from '@/lib/parcels/parcel-layer'

/*
  The harvested layer's geometry, fetched on demand.

  It is the larger half of the parcel layer and most sessions never open the
  map, so it is not fetched at boot with the attributes. Until it resolves, and
  for good on a clone where `pnpm sagis:harvest` has not been run, the plat
  draws the committed 40-lot fixture instead. That is a smaller map, not a
  broken one.
*/
export interface HarvestedParcels {
  collection: FeatureCollection<Polygon | MultiPolygon, ParcelProperties> | null
  streets: FeatureCollection<LineString, StreetProperties> | null
  loading: boolean
}

export function useHarvestedParcels(enabled = true): HarvestedParcels {
  const [collection, setCollection] = useState<FeatureCollection<
    Polygon | MultiPolygon,
    ParcelProperties
  > | null>(null)
  const [streets, setStreets] = useState<FeatureCollection<
    LineString,
    StreetProperties
  > | null>(null)
  /*
    Starts true when enabled, rather than being set true inside the effect,
    which would be a synchronous setState during an effect and a cascading
    render. The fetch is cached, so this only ever runs down to false.
  */
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    void Promise.all([loadParcelGeometry(), loadParcelStreets()])
      .then(([geometry, streetData]) => {
        if (cancelled) return
        setCollection(
          geometry === null
            ? null
            : (geometry as unknown as FeatureCollection<Polygon | MultiPolygon, ParcelProperties>)
        )
        setStreets(streetData as FeatureCollection<LineString, StreetProperties> | null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return { collection, streets, loading }
}

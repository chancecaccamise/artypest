import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { MapView, type InitialConnections } from '@/features/map/MapView'
import { PhaseTag } from '@/components/ui/phase-note'

/*
  Plat view.

  Parcel boundaries drawn from the county geometry, with no basemap. This is
  not a placeholder for a map: it is the drawing this audience already reads,
  it prints crisply for board packets and notification exhibits, and it stays
  as a view mode when satellite arrives beside it.
*/
export function PlatPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  /*
    `?connections=focus` is how the Connection Map hands a record over: draw
    this record's connections over the parcels and nothing else.

    A query parameter rather than router state, because the whole point of
    putting the selection in the route was that a view of one lot is a link. A
    view of one lot and its connections has to be one too, or it cannot be
    pasted into a board packet.
  */
  const requested = searchParams.get('connections')
  const initialConnections: InitialConnections | null =
    requested === 'focus' || requested === 'all' ? requested : null

  return (
    <>
      <PageHeader
        title="Plat View"
        subtitle="Every platted lot as the county recorded it, with the association's own records drawn on top."
        meta={<PhaseTag>no basemap</PhaseTag>}
      />

      <MapView
        initialEntityId={id ?? null}
        initialConnections={initialConnections}
        onSelectionChange={(entityId) => {
          // The selection is in the route, so a view of one lot is a link.
          navigate(entityId ? `/plat/${entityId}` : '/plat', { replace: true })
        }}
      />
    </>
  )
}

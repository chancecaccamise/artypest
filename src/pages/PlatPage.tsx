import { useNavigate, useParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { MapView } from '@/features/map/MapView'
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

  return (
    <>
      <PageHeader
        title="Plat View"
        subtitle="Every platted lot as the county recorded it, with the association's own records drawn on top."
        meta={<PhaseTag>no basemap</PhaseTag>}
      />

      <MapView
        initialEntityId={id ?? null}
        onSelectionChange={(entityId) => {
          // The selection is in the route, so a view of one lot is a link.
          navigate(entityId ? `/plat/${entityId}` : '/plat', { replace: true })
        }}
      />
    </>
  )
}

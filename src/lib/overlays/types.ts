import type { MultiPolygon, Polygon } from 'geojson'

/*
  District overlays: the boundaries the plat can draw under the lots.

  One at a time, on purpose. A lot sits inside a commission district and a
  voting precinct and a sanitation route simultaneously, and drawing three sets
  of boundaries over a plat produces something nobody can read.
*/

export interface OverlayArea {
  /** What the area is called. "District 3", "7-3 C", "Monday". */
  name: string
  /** The second line. Who represents it, where you vote, when it is collected. */
  detail: string
}

export interface OverlayCollection {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    properties: OverlayArea
    geometry: Polygon | MultiPolygon | null
  }[]
}

/** One row of public/overlays/index.json, written by the harvest. */
export interface OverlayDefinition {
  id: string
  /** Board-readable. Shown in the picker. */
  label: string
  /** Why this boundary is worth looking at. Empty when it speaks for itself. */
  note: string
  /** How many areas it holds, so the picker can say before anything is fetched. */
  areas: number
}

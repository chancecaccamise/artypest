import { createFixtureParcelService } from './FixtureParcelService'
import type { ParcelService } from './types'

/*
  The single swap point.

  When the SAGIS connection is configured, SagisParcelService lands next to
  FixtureParcelService and this one line changes. Nothing else in the app names
  a parcel data source.
*/
export const parcelService: ParcelService = createFixtureParcelService()

export type { ParcelRecord, ParcelService } from './types'
export {
  buildParcelViewerUrl,
  checkJurisdiction,
  deriveJurisdiction,
  isValidPin,
  normalizePin,
  validatePin,
} from './pin'
export type { Jurisdiction, JurisdictionCheck, PinFormat, PinValidation } from './pin'

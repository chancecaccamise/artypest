import { createFixtureParcelService } from './FixtureParcelService'
import { createSagisParcelService } from './SagisParcelService'
import type { ParcelService } from './types'

/*
  The single swap point. Nothing else in the app names a parcel data source.

  SAGIS needs no key and no proxy, so the live service is genuinely available.
  It is still opt-in rather than the default, for two reasons: the demo has to
  run with no network, and every test in this repo has to stay deterministic and
  offline. Set VITE_SAGIS_LIVE=true in .env.local to use the county service.

  The base URL is overridable in the same breath, because municipal GIS gets
  replatformed. That is the same reason the outbound viewer URL is a template in
  organization settings rather than a constant.
*/
function createParcelService(): ParcelService {
  if (import.meta.env.VITE_SAGIS_LIVE !== 'true') return createFixtureParcelService()

  const baseUrl = import.meta.env.VITE_SAGIS_BASE_URL ?? ''
  return createSagisParcelService(baseUrl === '' ? {} : { baseUrl })
}

export const parcelService: ParcelService = createParcelService()

export type { MailingAddress, ParcelRecord, ParcelService } from './types'
export { formatMailingAddress } from './types'
export { createSagisParcelService } from './SagisParcelService'
export {
  buildParcelViewerUrl,
  checkJurisdiction,
  deriveJurisdiction,
  isValidPin,
  normalizePin,
  validatePin,
} from './pin'
export type { Jurisdiction, JurisdictionCheck, PinFormat, PinValidation } from './pin'

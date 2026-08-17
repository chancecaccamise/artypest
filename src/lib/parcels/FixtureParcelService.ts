import sample from './fixtures/chatham-sample.json'
import { normalizePin } from './pin'
import type { ParcelRecord, ParcelService } from './types'

/*
  Reads src/lib/parcels/fixtures/chatham-sample.json. No network, no
  credentials, no endpoint.

  The fixture carries underscore-prefixed keys used to seed the demo people and
  businesses. Those are generation metadata, not parcel data, so they are
  stripped here and never reach the rest of the app.
*/

interface RawParcel extends ParcelRecord {
  _seedReadableName?: string
  _seedOwnerKind?: string
}

function toParcelRecord(raw: RawParcel): ParcelRecord {
  return {
    pin: raw.pin,
    situsAddress: raw.situsAddress,
    ownerName: raw.ownerName,
    ownerMailingAddress: raw.ownerMailingAddress,
    acreage: raw.acreage,
    zoningDistrict: raw.zoningDistrict,
    assessedValue: raw.assessedValue,
    assessedYear: raw.assessedYear,
  }
}

const RECORDS: ParcelRecord[] = (sample as RawParcel[]).map(toParcelRecord)

const BY_PIN = new Map(RECORDS.map((record) => [normalizePin(record.pin), record]))

/** A short pause so loading states are exercised rather than flashing past. */
const LOOKUP_DELAY_MS = 220

function delay<T>(value: T, ms = LOOKUP_DELAY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

class FixtureParcelService implements ParcelService {
  readonly kind = 'fixture' as const

  /** Nothing is connected in this phase, and the user interface says so. */
  readonly connected = false

  getByPin(pin: string): Promise<ParcelRecord | null> {
    return delay(BY_PIN.get(normalizePin(pin)) ?? null)
  }

  getManyByPin(pins: string[]): Promise<{ found: ParcelRecord[]; missing: string[] }> {
    const found: ParcelRecord[] = []
    const missing: string[] = []
    const seen = new Set<string>()

    for (const raw of pins) {
      const key = normalizePin(raw)
      if (key === '' || seen.has(key)) continue
      seen.add(key)

      const record = BY_PIN.get(key)
      if (record) {
        found.push(record)
      } else {
        missing.push(key)
      }
    }

    return delay({ found, missing })
  }

  listAll(): Promise<ParcelRecord[]> {
    return delay(RECORDS.slice())
  }
}

export function createFixtureParcelService(): ParcelService {
  return new FixtureParcelService()
}

/** The raw fixture, for seeding the demo data only. Not for app code. */
export const RAW_PARCEL_FIXTURE = sample as RawParcel[]

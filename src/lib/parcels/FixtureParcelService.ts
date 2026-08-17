import sample from './fixtures/chatham-sample.json'
import { normalizePin } from './pin'
import type { ParcelRecord, ParcelService } from './types'

/*
  Reads src/lib/parcels/fixtures/chatham-sample.json, which is 60 real parcels
  on E 49th St in Ardsley Park, pulled from the live service by
  scripts/fetch-sagis-fixture.mjs. No network, no credentials, no endpoint.

  The fixture is exactly the ParcelRecord shape, including the owner names as
  the county writes them. That is the point: the import's Match step has to face
  the real grammar rather than a tidied-up version of it.
*/

const RECORDS: ParcelRecord[] = sample

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
export const RAW_PARCEL_FIXTURE: ParcelRecord[] = sample

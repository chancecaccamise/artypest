import type { Entity } from '@/lib/data/types'
import { readString } from '@/lib/format'
import { normalizePin } from '@/lib/parcels/pin'

/*
  Two records for one lot.

  The county layer already holds every platted lot in the corridor, so "add a
  property" is almost always a lot that is on file. A second record for it
  splits the lot's connections between two rows and the plat draws whichever it
  finds first. This is the check that runs before one is made, and the one the
  record page uses to say it already happened.

  A parcel number is the lot's identity: two records with one PIN are the same
  lot, always. An address is weaker, because the county does give two parcels
  one situs address now and then, so a match on address alone is a question for
  the reader rather than a refusal.
*/

export type DuplicateReason = 'pin' | 'address'

export interface DuplicateMatch {
  entity: Entity
  by: DuplicateReason
}

const STREET_WORDS: readonly [RegExp, string][] = [
  [/\bSTREET\b/g, 'ST'],
  [/\bAVENUE\b/g, 'AVE'],
  [/\bDRIVE\b/g, 'DR'],
  [/\bROAD\b/g, 'RD'],
  [/\bLANE\b/g, 'LN'],
  [/\bPLACE\b/g, 'PL'],
  [/\bCOURT\b/g, 'CT'],
  [/\bBOULEVARD\b/g, 'BLVD'],
  [/\bEAST\b/g, 'E'],
  [/\bWEST\b/g, 'W'],
  [/\bNORTH\b/g, 'N'],
  [/\bSOUTH\b/g, 'S'],
]

/**
 * What an address reduces to for comparison. `104 E. 40th Street` and the
 * county's `104 E 40TH ST` both become `104E40THST`.
 */
export function addressKey(address: string): string {
  let key = address.toUpperCase()
  for (const [word, abbreviation] of STREET_WORDS) key = key.replace(word, abbreviation)
  return key.replace(/[^A-Z0-9]/g, '')
}

function addressKeysOf(entity: Entity): Set<string> {
  return new Set(
    [entity.name, readString(entity.data.situsAddress)]
      .map(addressKey)
      .filter((key) => key !== '')
  )
}

export interface PropertyCandidate {
  /** Present when editing, so a record is never its own duplicate. */
  id?: string
  name: string
  pin: string
}

/**
 * Properties already on file that `candidate` would duplicate, parcel number
 * matches first. Deleted records are not considered; archived ones are, since
 * an archived lot is still the lot.
 */
export function findDuplicateProperties(
  candidate: PropertyCandidate,
  entities: readonly Entity[]
): DuplicateMatch[] {
  const pin = candidate.pin.trim() === '' ? '' : normalizePin(candidate.pin)
  const address = addressKey(candidate.name)

  const byPin: DuplicateMatch[] = []
  const byAddress: DuplicateMatch[] = []

  for (const entity of entities) {
    if (entity.type !== 'property' || entity.deletedAt !== null) continue
    if (entity.id === candidate.id) continue

    const otherPin = readString(entity.data.pin)
    if (pin !== '' && otherPin !== '' && normalizePin(otherPin) === pin) {
      byPin.push({ entity, by: 'pin' })
    } else if (address !== '' && addressKeysOf(entity).has(address)) {
      byAddress.push({ entity, by: 'address' })
    }
  }

  return [...byPin, ...byAddress]
}

/**
 * Other properties with this one's parcel number: for the notice on a record
 * that is already duplicated.
 *
 * Parcel number only. Condominium units are separate parcels at one situs
 * address, so an address match here would flag every unit in a building.
 */
export function duplicatesOfProperty(property: Entity, entities: readonly Entity[]): Entity[] {
  if (property.type !== 'property' || readString(property.data.pin) === '') return []
  return findDuplicateProperties(
    { id: property.id, name: '', pin: readString(property.data.pin) },
    entities
  ).map((match) => match.entity)
}

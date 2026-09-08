/*
  How fresh a connection is, expressed as something a line can be drawn with.

  A board member looking at eight lots joined to an association wants to know
  which joined last week and which joined in 1998, without opening eight
  records. So the thread carries it: brighter means more recent.

  The ramp is linear in real time between the oldest and newest date in the set
  being drawn, not in rank order. That distinction matters and is the whole
  argument for this file. Ranking would spread eight lots evenly across the
  ramp whether they joined across twenty years or across one week, which invents
  a story about the data. Linear time says "these seven arrived together and
  that one is new", because that is what happened.

  Undated connections are the honest awkward case. They are drawn at a fixed
  middle strength rather than at either end, because putting them at the floor
  would read as "oldest" and at the ceiling as "newest", and neither is known.
  The count is reported so a reader can see how much of the picture is missing.
*/

/** The oldest thread is still legible, not a ghost. */
export const OLDEST_STRENGTH = 0.3

export const NEWEST_STRENGTH = 1

/** Neither old nor new, because nothing was recorded. */
export const UNDATED_STRENGTH = 0.55

/*
  The floor a bold drawing starts its ramp at.

  Bold lifts the ramp, it does not flatten it. Clamping every line to a minimum
  is the obvious version and the wrong one: in a fan of eight lots it makes the
  oldest four identical, and telling those apart is the whole reason the ramp
  exists. So the range is shifted instead, and still runs oldest to newest over
  a band that starts somewhere visible.

  It lives here, next to the ramp it shifts, because the plat and the Connection
  Map are two drawings of the same relationships. When they each had their own
  number, a connection drawn bold in one view was drawn faint in the other.
*/
export const BOLD_FLOOR = 0.5

/** A strength on the ramp, shifted into the band a bold drawing uses. */
export function boldStrength(strength: number): number {
  return BOLD_FLOOR + strength * (1 - BOLD_FLOOR)
}

/*
  Below this the ramp is not telling the truth: two dates a day apart would be
  drawn as far apart as two dates a decade apart. A set this tight is reported
  as having no spread and every thread is drawn at full strength.
*/
const MINIMUM_SPREAD_DAYS = 14

const MS_PER_DAY = 86_400_000

export interface RecencyScale {
  /** ISO date of the oldest dated connection, or null when none are dated. */
  oldest: string | null
  /** ISO date of the newest dated connection, or null when none are dated. */
  newest: string | null
  /** How many connections in the set carry no date at all. */
  undated: number
  /** How many carry one. */
  dated: number
  /**
   * False when every date is the same, when the range is too short to grade
   * honestly, or when nothing is dated. Callers use it to decide whether the
   * gradient is worth explaining.
   */
  hasSpread: boolean
  /** Days between the oldest and the newest. Zero when there is no spread. */
  spanDays: number
  /** 0 at the oldest, 1 at the newest. Null when the relation has no date. */
  positionOf: (relationId: string) => number | null
  /** What to draw the thread at. Always safe to call. */
  strengthOf: (relationId: string) => number
}

/**
 * The least a thing needs to be placed on the ramp.
 *
 * Deliberately narrower than `Relation`. The plat grades arcs, which are
 * geometry with a relation id attached, not relation rows. Asking for the whole
 * row would have meant carrying one around just to read one field off it.
 */
export interface Dated {
  id: string
  startDate: string | null
}

/** The date a connection began. Never falls back to createdAt: see below. */
export function relationDate(relation: Pick<Dated, 'startDate'>): string | null {
  /*
    `createdAt` is when somebody typed the record in, which is a fact about the
    office and not about the neighbourhood. A lot that joined in 1998 and was
    entered last Tuesday would be drawn as the newest thing on the map.
  */
  return relation.startDate
}

function timeOf(iso: string): number | null {
  const value = Date.parse(iso)
  return Number.isNaN(value) ? null : value
}

/**
 * Builds the ramp for one set of connections.
 *
 * Scoped to what is on screen on purpose. The reader is comparing these eight
 * threads to each other, so the contrast is spent on the range they can see
 * rather than on the whole history of the association.
 */
export function buildRecencyScale(relations: readonly Dated[]): RecencyScale {
  const times = new Map<string, number>()
  let min = Infinity
  let max = -Infinity
  let undated = 0

  for (const relation of relations) {
    const iso = relationDate(relation)
    const time = iso === null ? null : timeOf(iso)
    if (time === null) {
      undated += 1
      continue
    }
    times.set(relation.id, time)
    if (time < min) min = time
    if (time > max) max = time
  }

  const dated = times.size
  const spanDays = dated === 0 ? 0 : (max - min) / MS_PER_DAY
  const hasSpread = dated > 1 && spanDays >= MINIMUM_SPREAD_DAYS

  const positionOf = (relationId: string): number | null => {
    const time = times.get(relationId)
    if (time === undefined) return null
    if (!hasSpread) return 1
    return (time - min) / (max - min)
  }

  const strengthOf = (relationId: string): number => {
    const position = positionOf(relationId)
    if (position === null) return UNDATED_STRENGTH
    if (!hasSpread) return NEWEST_STRENGTH
    return OLDEST_STRENGTH + position * (NEWEST_STRENGTH - OLDEST_STRENGTH)
  }

  return {
    oldest: dated === 0 ? null : new Date(min).toISOString().slice(0, 10),
    newest: dated === 0 ? null : new Date(max).toISOString().slice(0, 10),
    undated,
    dated,
    hasSpread,
    spanDays: hasSpread ? Math.round(spanDays) : 0,
    positionOf,
    strengthOf,
  }
}

/**
 * Oldest first, undated last.
 *
 * "Which joined first" should be readable from the order things sit in as well
 * as from how bright they are, because position is the easier of the two to
 * compare across a wide row.
 */
export function compareByDate(a: Pick<Dated, 'startDate'>, b: Pick<Dated, 'startDate'>): number {
  const left = relationDate(a)
  const right = relationDate(b)
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left.localeCompare(right)
}

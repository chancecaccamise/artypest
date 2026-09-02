import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/*
  Where the work log starts counting.

  A session is a sitting, not a login. Somebody working down a printed owner
  list wants "what I have done since I sat down", and they want it to survive a
  reload, a crash, and the tab being closed at lunch and reopened after.

  So the boundary is a stored moment, defaulting to the start of today and
  resettable by hand. Today rather than an idle timeout because a reader can say
  when they sat down and a timer cannot: a twenty-minute phone call is not the
  end of a session, and a fixed window would decide that it was.

  Held in a context rather than read from storage wherever it is needed, because
  two readings of the same boundary can disagree. The count in the header and
  the list in the panel are the same claim, and starting a fresh session has to
  move both of them at once.
*/

const SESSION_KEY = 'artypest.work-log.started-at'

/** Midnight this morning, in the reader's own timezone. */
function startOfToday(now: Date): string {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  return midnight.toISOString()
}

/**
 * The moment the current session began.
 *
 * Rolls forward at midnight: a stored start from an earlier day would quietly
 * turn "this session" into "this week", which is a different question and a
 * much longer list. Storage failures fall back to today rather than throwing,
 * because a work log that cannot remember where it started is still worth more
 * than a page that will not load.
 */
export function readSessionStart(now: Date = new Date()): string {
  const today = startOfToday(now)

  try {
    const stored = window.localStorage.getItem(SESSION_KEY)
    if (stored !== null && stored >= today) return stored
    window.localStorage.setItem(SESSION_KEY, today)
  } catch {
    // Private browsing, or storage turned off. Today is a good answer.
  }

  return today
}

/** Starts a fresh session at `now`, which empties the log without touching data. */
export function writeSessionStart(now: Date = new Date()): string {
  const at = now.toISOString()
  try {
    window.localStorage.setItem(SESSION_KEY, at)
  } catch {
    // Nothing to do. The log falls back to today on the next read.
  }
  return at
}

interface SessionContextValue {
  /** Inclusive ISO timestamp. Everything the reader has done since. */
  since: string
  startFresh: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function WorkSessionProvider({ children }: { children: ReactNode }) {
  const [since, setSince] = useState(() => readSessionStart())

  const startFresh = useCallback(() => {
    setSince(writeSessionStart())
  }, [])

  const value = useMemo(() => ({ since, startFresh }), [since, startFresh])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useWorkSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useWorkSession must be used inside a WorkSessionProvider')
  return context
}

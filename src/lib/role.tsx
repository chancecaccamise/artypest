import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/*
  The role switcher.

  Real accounts arrive with the backend. Until then this is a client-side
  preview of what each role sees, which is enough to keep the resident view
  honest: notes are internal and a resident must never be shown them.
*/

export const ROLES = ['admin', 'manager', 'board', 'resident'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  manager: 'Property manager',
  board: 'Board member',
  resident: 'Resident',
}

interface RoleContextValue {
  role: Role
  setRole: (role: Role) => void
  /** Internal notes are hidden from residents. */
  canSeeNotes: boolean
  /** Residents read. Everyone else can change records. */
  canEdit: boolean
  canManageSettings: boolean
}

const RoleContext = createContext<RoleContextValue | null>(null)

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('admin')

  const value = useMemo<RoleContextValue>(
    () => ({
      role,
      setRole,
      canSeeNotes: role !== 'resident',
      canEdit: role !== 'resident',
      canManageSettings: role === 'admin' || role === 'manager',
    }),
    [role]
  )

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole(): RoleContextValue {
  const context = useContext(RoleContext)
  if (!context) throw new Error('useRole must be used inside a RoleProvider')
  return context
}

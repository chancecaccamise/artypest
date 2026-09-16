import { createContext, useContext, type ReactNode } from 'react'

/*
  Everyone admitted to the application is an administrator. Stored role labels
  remain available for existing member records, but they no longer change what
  somebody can see or do.
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
  canSeeNotes: boolean
  canEdit: boolean
  canManageSettings: boolean
}

const RoleContext = createContext<RoleContextValue | null>(null)

const ADMIN_ACCESS: RoleContextValue = {
  canSeeNotes: true,
  canEdit: true,
  canManageSettings: true,
}

export function RoleProvider({ children }: { children: ReactNode }) {
  return <RoleContext.Provider value={ADMIN_ACCESS}>{children}</RoleContext.Provider>
}

export function useRole(): RoleContextValue {
  const context = useContext(RoleContext)
  if (!context) throw new Error('useRole must be used inside a RoleProvider')
  return context
}

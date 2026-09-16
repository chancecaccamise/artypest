import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import type { SignInLocationState } from './sign-in'

/*
  Wraps every page except sign-in.

  While a saved sign-in is being read, or the account is being checked, this
  waits rather than redirecting: somebody who reloads a record page should stay
  on that record, not be bounced through a sign-in form they did not need.
*/
export function RequireSignIn() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'demo' || auth.status === 'signed-in') return <Outlet />

  if (auth.status === 'loading' || auth.status === 'checking') {
    return (
      <div className="bg-paper text-ink-muted grid h-svh place-items-center px-4 text-sm">
        <p role="status">Opening your records</p>
      </div>
    )
  }

  const state: SignInLocationState = {
    from: `${location.pathname}${location.search}${location.hash}`,
  }
  return <Navigate to="/sign-in" replace state={state} />
}

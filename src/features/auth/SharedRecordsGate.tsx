import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/empty-state'
import { useAuth } from '@/lib/auth'
import {
  connectSharedRecords,
  copyLocalWorkToShared,
  disconnectSharedRecords,
  hasLocalWork,
  refreshSharedRecords,
  remoteFor,
} from '@/lib/data'

/*
  Between signing in and the first page: loads the association's shared
  records, and keeps them current while the app is open.

  Everyone in the association reads and writes the same records. What another
  admin saves appears here within half a minute, or as soon as this tab is
  looked at again, without anybody reloading anything.
*/

/** How often to look for other people's changes while the tab is open. */
const REFRESH_MS = 30_000

export function SharedRecordsGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const queryClient = useQueryClient()

  const account = auth.status === 'signed-in' ? auth.account : null
  const client = auth.client

  const connection = useQuery({
    queryKey: ['shared-records', account?.userId ?? null, account?.orgId ?? null],
    queryFn: async () => {
      if (!client || !account) return false
      await connectSharedRecords(remoteFor(client, account.orgId))
      // Anything read before the switch was read from this browser's own copy.
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'shared-records' && query.queryKey[0] !== 'auth',
      })
      return true
    },
    enabled: client !== null && account !== null,
    staleTime: Infinity,
    retry: 1,
  })

  const connected = connection.data === true

  // Back to this browser's store when the account goes, so nothing shared lingers.
  useEffect(() => {
    if (!account) disconnectSharedRecords()
  }, [account])

  useEffect(() => {
    if (!connected) return

    let running = false
    const refresh = async () => {
      if (running || document.visibilityState === 'hidden') return
      running = true
      try {
        if (await refreshSharedRecords()) {
          await queryClient.invalidateQueries({
            predicate: (query) =>
              query.queryKey[0] !== 'shared-records' && query.queryKey[0] !== 'auth',
          })
        }
      } catch {
        // A dropped connection is retried on the next tick; the records on screen stay put.
      } finally {
        running = false
      }
    }

    const timer = setInterval(() => void refresh(), REFRESH_MS)
    const onVisible = () => void refresh()
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [connected, queryClient])

  // The demo and the test suite have no database, and nothing to connect.
  if (!client || !account) return <>{children}</>

  if (connection.isError) {
    return (
      <div className="bg-paper grid h-svh place-items-center px-4">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-ink text-sm font-semibold">The association&rsquo;s records could not be loaded</p>
          <p className="text-ink-muted text-13">
            {connection.error instanceof Error ? connection.error.message : 'The database did not answer.'}
          </p>
          <Button onClick={() => void connection.refetch()}>Try again</Button>
        </div>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="bg-paper text-ink-muted grid h-svh place-items-center px-4 text-sm">
        <p role="status">Loading the association&rsquo;s records</p>
      </div>
    )
  }

  return (
    <>
      <LocalWorkNotice />
      {children}
    </>
  )
}

/*
  Work typed into this browser before the records were shared. Offered once,
  at the top of every page, until it is copied in.
*/
function LocalWorkNotice() {
  const queryClient = useQueryClient()
  const [present, setPresent] = useState(hasLocalWork)

  const copy = useMutation({
    mutationFn: copyLocalWorkToShared,
    onSuccess: async () => {
      setPresent(false)
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'shared-records' && query.queryKey[0] !== 'auth',
      })
    },
  })

  if (copy.isSuccess) {
    const { records, connections } = copy.data
    return (
      <Notice tone="info" className="m-3">
        Copied {records} {records === 1 ? 'record' : 'records'} and {connections}{' '}
        {connections === 1 ? 'connection' : 'connections'} from this browser. Everyone in the
        association can see them now.
      </Notice>
    )
  }

  if (!present) return null

  return (
    <Notice tone="warning" className="m-3">
      <span className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1">
          This browser has work saved from before the records were shared. Copy it in so
          everyone in the association can see it. Where someone else has changed the same record
          since, this copy replaces their version.
          {copy.isError ? (
            <span className="text-oxblood mt-1 block">
              {copy.error instanceof Error ? copy.error.message : 'The copy did not finish.'} Nothing
              is lost: try again.
            </span>
          ) : null}
        </span>
        <Button size="sm" variant="primary" onClick={() => copy.mutate()} disabled={copy.isPending}>
          {copy.isPending ? 'Copying' : 'Copy to shared records'}
        </Button>
      </span>
    </Notice>
  )
}

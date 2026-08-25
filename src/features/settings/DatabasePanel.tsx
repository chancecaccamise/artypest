import { useCallback, useEffect, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'

import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { checkConnection, isSupabaseConfigured, type ConnectionCheck } from '@/lib/supabase'

/*
  Whether the app can reach the database, said out loud.

  "Is it connected?" is the first question anybody asks after creating a
  database, and answering it by reading the browser console is not an answer for
  a board member. The check runs one cheap query, so it proves the URL, the key,
  and the row level security policy all work, rather than only that the address
  resolves.
*/
export function DatabasePanel() {
  const configured = isSupabaseConfigured()
  const [state, setState] = useState<ConnectionCheck | null>(null)
  const [checking, setChecking] = useState(true)

  const run = useCallback(() => {
    setChecking(true)
    void checkConnection()
      .then(setState)
      .finally(() => {
        setChecking(false)
      })
  }, [])

  /*
    Checked once on open, and the state is only ever set from the promise, never
    synchronously inside the effect: setting it synchronously here makes React
    render twice before painting for no reason.
  */
  useEffect(() => {
    let cancelled = false
    void checkConnection().then((result) => {
      if (cancelled) return
      setState(result)
      setChecking(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const tone = state === null ? 'neutral' : state.ok ? 'moss' : 'amber'
  const label = state === null ? 'Checking' : state.ok ? 'Connected' : 'Not connected'

  return (
    <Panel>
      <PanelHeader title="Database" action={<StatusBadge tone={tone}>{label}</StatusBadge>} />
      <PanelBody className="flex flex-col gap-4">
        <p className="text-ink-muted text-13 max-w-2xl">
          {configured
            ? 'The records on every screen still come from the built-in demo data. Connecting the database is the first half of the move, and the provider that reads from it is the second.'
            : 'No database is configured, so the app is running on its built-in demo data. That is a working state rather than a broken one: every fresh clone starts here.'}
        </p>

        <dl className="grid max-w-2xl gap-x-8 gap-y-2 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted text-13">Credentials</dt>
            <dd className="font-mono text-xs">{configured ? 'configured' : 'not set'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted text-13">Records read from</dt>
            <dd className="font-mono text-xs">demo data</dd>
          </div>
        </dl>

        {state ? (
          <p className="text-ink-muted text-13 max-w-2xl">
            <Database className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden="true" />
            {state.detail}
          </p>
        ) : null}
      </PanelBody>
      <PanelFooter className="flex-wrap gap-y-2">
        <span>
          Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, then restart the dev
          server. The anon key only: the service role key bypasses row level security and must
          never reach a browser.
        </span>
        <Button size="sm" variant="secondary" onClick={run} disabled={checking}>
          <RefreshCw className={checking ? 'animate-spin' : undefined} />
          {checking ? 'Checking' : 'Check again'}
        </Button>
      </PanelFooter>
    </Panel>
  )
}

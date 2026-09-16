/*
  The actor used by the temporary in-browser provider.

  Postgres reads this from the signed-in session inside its audit trigger. Until
  the Supabase data provider replaces the memory provider, authentication and
  the local audit trail need this small bridge so the work log asks for the same
  person the provider writes.
*/

export const DEMO_ACTOR = 'Demo User'

let activeActor = DEMO_ACTOR

export function getActiveActor(): string {
  return activeActor
}

export function setActiveActor(actor: string | null | undefined): void {
  const next = actor?.trim()
  activeActor = next ? next : DEMO_ACTOR
}

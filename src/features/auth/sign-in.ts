import { z } from 'zod'

/*
  The sign-in form. Deliberately no password rules: accounts are made by an
  administrator, so whatever rules apply were applied then, and telling
  somebody their existing password is "too short" only stops them signing in.
*/
export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a full email address, like name@example.com.')
    // Phones capitalise the first letter. Supabase stores addresses in lower case.
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1, 'Enter your password.'),
})

export type SignInValues = z.input<typeof signInSchema>

/** Router state carried to the sign-in page, so a reader lands where they were going. */
export interface SignInLocationState {
  from?: string
}

/**
 * Where to go after signing in.
 *
 * Only a path inside this application. `//host` is a path to a browser and a
 * different site to everyone else, and returning to the sign-in page would
 * loop.
 */
export function returnPathFrom(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('from' in state)) return '/'
  const from = state.from
  if (typeof from !== 'string') return '/'
  if (!from.startsWith('/') || from.startsWith('//')) return '/'
  if (from === '/sign-in' || from.startsWith('/sign-in?')) return '/'
  return from
}

import { createMemoryProvider } from './memory-provider'
import type { DataProvider } from './types'

/*
  The single place the app picks a data backend.

  Today: in-memory fixtures, because the Supabase stack is not set up yet.
  Later: swap this one line for the Supabase provider. Nothing that imports
  `data` needs to change, because both sides satisfy DataProvider.
*/
export const data: DataProvider = createMemoryProvider()

export * from './types'

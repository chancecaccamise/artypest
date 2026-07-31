/// <reference types="vite/client" />

/*
  No environment variables are required yet. The app runs entirely on the
  in-memory data provider in src/lib/data.

  When Supabase is wired up, add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
  here and to .env.example.
*/
interface ImportMetaEnv {
  readonly MODE: string
}

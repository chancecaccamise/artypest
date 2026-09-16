import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '@/App'
import { createFakeSupabase, type FakeAccount } from '@/test/fake-supabase'
import { renderWithProviders } from '@/test/render'
import { returnPathFrom } from './sign-in'

/*
  Sign-in, driven through the real application and a real Supabase client whose
  network is faked. See src/test/fake-supabase.ts for why it is the network and
  not the client that is faked.
*/

const ADMIN: FakeAccount = {
  id: 'user-admin',
  email: 'dana@ardsleypark.org',
  password: 'correct horse',
  member: { name: 'Dana Whitfield', role: 'admin' },
}

const BOARD: FakeAccount = {
  id: 'user-board',
  email: 'marcus@ardsleypark.org',
  password: 'battery staple',
  member: { name: 'Marcus Bell', role: 'board' },
}

/* A real account that nobody has added to the association. */
const OUTSIDER: FakeAccount = {
  id: 'user-outsider',
  email: 'temp@ardsleypark.org',
  password: 'no membership',
}

const UNCONFIRMED: FakeAccount = {
  id: 'user-unconfirmed',
  email: 'new@ardsleypark.org',
  password: 'not yet',
  member: { name: 'New Hire', role: 'manager' },
  confirmed: false,
}

const PASSWORD_GRANT = 'POST /auth/v1/token?grant_type=password'

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup()
  // The form replaces "checking for a saved sign-in" once the client has looked.
  const emailField = await screen.findByLabelText('Email address')
  if (email) await user.type(emailField, email)
  if (password) await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return user
}

describe('signing in', () => {
  it('sends a signed-out visitor to sign in, then on to the page they asked for', async () => {
    const fake = createFakeSupabase({ accounts: [ADMIN] })
    renderWithProviders(<App />, { route: '/settings', auth: { client: fake.client } })

    expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()

    // A phone capitalises the first letter. That must not stop anybody.
    await fillAndSubmit('Dana@ArdsleyPark.org', ADMIN.password)

    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('says the email and password do not match, and keeps the form', async () => {
    const fake = createFakeSupabase({ accounts: [ADMIN] })
    renderWithProviders(<App />, { auth: { client: fake.client } })

    await fillAndSubmit(ADMIN.email, 'wrong password')

    expect(await screen.findByText(/do not match an account/)).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveValue(ADMIN.email)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('asks for both fields before contacting the server', async () => {
    const fake = createFakeSupabase({ accounts: [ADMIN] })
    renderWithProviders(<App />, { auth: { client: fake.client } })

    await fillAndSubmit('', '')

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(fake.requests).not.toContain(PASSWORD_GRANT)
  })

  it('says so when the connection is down, rather than blaming the password', async () => {
    const fake = createFakeSupabase({ accounts: [ADMIN] })
    renderWithProviders(<App />, { auth: { client: fake.client } })
    await screen.findByLabelText('Email address')

    fake.setOffline(true)
    await fillAndSubmit(ADMIN.email, ADMIN.password)

    expect(await screen.findByText(/Could not reach the sign-in service/)).toBeInTheDocument()
    expect(screen.queryByText(/do not match/)).not.toBeInTheDocument()
  })

  it('tells an unconfirmed account who to ask', async () => {
    const fake = createFakeSupabase({ accounts: [UNCONFIRMED] })
    renderWithProviders(<App />, { auth: { client: fake.client } })

    await fillAndSubmit(UNCONFIRMED.email, UNCONFIRMED.password)

    expect(await screen.findByText(/has not been confirmed yet/)).toBeInTheDocument()
  })

  it('keeps out a correct password on an account the association has not added', async () => {
    const fake = createFakeSupabase({ accounts: [OUTSIDER, ADMIN] })
    renderWithProviders(<App />, { route: '/people', auth: { client: fake.client } })

    const user = await fillAndSubmit(OUTSIDER.email, OUTSIDER.password)

    expect(
      await screen.findByText(/has not been given access to the association/)
    ).toBeInTheDocument()
    expect(screen.getByText(OUTSIDER.email)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()

    // Offered a way out that is not "reload and hope".
    await user.click(screen.getByRole('button', { name: 'Sign in with a different account' }))
    await fillAndSubmit(ADMIN.email, ADMIN.password)

    expect(await screen.findByRole('heading', { name: /People/, level: 1 })).toBeInTheDocument()
  })

  it('reopens a saved sign-in without asking again', async () => {
    const fake = createFakeSupabase({ accounts: [ADMIN], savedSignIn: ADMIN.email })
    renderWithProviders(<App />, { route: '/settings', auth: { client: fake.client } })

    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(fake.requests).not.toContain(PASSWORD_GRANT)
  })

  it('signs out from the header, and the pages are guarded again', async () => {
    const fake = createFakeSupabase({ accounts: [ADMIN], savedSignIn: ADMIN.email })
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/settings', auth: { client: fake.client } })

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(fake.requests).toContain('POST /auth/v1/logout?scope=local')
  })
})

describe('administrator access', () => {
  it('gives every admitted account full access without a role selector', async () => {
    const fake = createFakeSupabase({ accounts: [BOARD], savedSignIn: BOARD.email })
    renderWithProviders(<App />, { route: '/people', auth: { client: fake.client } })

    expect(await screen.findByRole('button', { name: /Add person/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Preview as role')).not.toBeInTheDocument()
  })
})

describe('without a database', () => {
  it('refuses to open a production site that lost its database settings', async () => {
    renderWithProviders(<App />, { route: '/people', auth: { client: null, requireSignIn: true } })

    expect(await screen.findByText(/Sign-in is not available/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('runs the demo with no sign-in everywhere else, and skips the sign-in page', async () => {
    renderWithProviders(<App />, { route: '/sign-in' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    })
  })
})

describe('where signing in returns to', () => {
  it('returns to a page inside the application', () => {
    expect(returnPathFrom({ from: '/properties?propertyUse=commercial#top' })).toBe(
      '/properties?propertyUse=commercial#top'
    )
  })

  it('goes to the dashboard for anything else', () => {
    expect(returnPathFrom(undefined)).toBe('/')
    expect(returnPathFrom(null)).toBe('/')
    expect(returnPathFrom({ from: 42 })).toBe('/')
    expect(returnPathFrom({ from: 'https://example.com' })).toBe('/')
    // A path to the browser, another site to everyone else.
    expect(returnPathFrom({ from: '//example.com/phish' })).toBe('/')
    // Would loop.
    expect(returnPathFrom({ from: '/sign-in' })).toBe('/')
  })
})

import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useMemberName } from '@/lib/auth'
import { createFakeSupabase, type FakeAccount } from '@/test/fake-supabase'
import { renderWithProviders } from '@/test/render'

/*
  Changes are recorded under an email and shown under a name. These check the
  lookup between the two, through a real client whose network is faked.
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

function Names({ actors }: { actors: string[] }) {
  const nameFor = useMemberName()
  return (
    <ul>
      {actors.map((actor) => (
        <li key={actor}>{nameFor(actor)}</li>
      ))}
    </ul>
  )
}

describe('member names', () => {
  it('shows another member by name, whatever case their email was stored in', async () => {
    const fake = createFakeSupabase({ accounts: [ADMIN, BOARD], savedSignIn: ADMIN.email })
    renderWithProviders(<Names actors={['Marcus@ArdsleyPark.org']} />, {
      auth: { client: fake.client },
    })

    expect(await screen.findByText('Marcus Bell')).toBeInTheDocument()
  })

  it('leaves an email it does not recognise as it is', async () => {
    const fake = createFakeSupabase({ accounts: [ADMIN], savedSignIn: ADMIN.email })
    renderWithProviders(<Names actors={[ADMIN.email, 'former@ardsleypark.org']} />, {
      auth: { client: fake.client },
    })

    expect(await screen.findByText('Dana Whitfield')).toBeInTheDocument()
    expect(screen.getByText('former@ardsleypark.org')).toBeInTheDocument()
  })

  it('changes nothing in the demo, where nobody signs in', () => {
    renderWithProviders(<Names actors={['Demo User']} />)
    expect(screen.getByText('Demo User')).toBeInTheDocument()
  })
})

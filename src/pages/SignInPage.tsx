import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/empty-state'
import { Field, Input } from '@/components/ui/field'
import { Panel, PanelBody } from '@/components/ui/panel'
import { returnPathFrom, signInSchema, type SignInValues } from '@/features/auth/sign-in'
import { useAuth } from '@/lib/auth'

/*
  The one page outside the shell. There is no sign-up link and no reset flow on
  purpose: accounts are made by an administrator, so the useful thing to tell
  somebody who is stuck is who to ask.
*/
export function SignInPage() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'demo' || auth.status === 'signed-in') {
    return <Navigate to={returnPathFrom(location.state)} replace />
  }

  switch (auth.status) {
    case 'unavailable':
      return (
        <SignInLayout>
          <div role="alert">
            <Notice tone="error">
              Sign-in is not available. This site is not connected to its database, so nobody can
              sign in yet. Tell your administrator.
            </Notice>
          </div>
        </SignInLayout>
      )

    case 'loading':
      return (
        <SignInLayout>
          <p role="status" className="text-ink-muted text-sm">
            Checking for a saved sign-in
          </p>
        </SignInLayout>
      )

    case 'no-access':
      return (
        <SignInLayout>
          <div className="flex flex-col gap-4">
            <div role="alert">
              <Notice tone="warning">
                <p>
                  You signed in as <strong className="font-semibold">{auth.email}</strong>, but that
                  account has not been given access to the association yet. Ask your administrator
                  to add it.
                </p>
              </Notice>
            </div>
            <Button variant="secondary" className="w-full" onClick={() => void auth.signOut()}>
              Sign in with a different account
            </Button>
          </div>
        </SignInLayout>
      )

    case 'check-failed':
      return (
        <SignInLayout>
          <div className="flex flex-col gap-4">
            <div role="alert">
              <Notice tone="error">{auth.message}</Notice>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="primary"
                className="flex-1"
                onClick={auth.retryCheck}
                disabled={auth.retrying}
              >
                {auth.retrying ? 'Trying again' : 'Try again'}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => void auth.signOut()}>
                Sign out
              </Button>
            </div>
          </div>
        </SignInLayout>
      )

    case 'signed-out':
    case 'checking':
      return (
        <SignInLayout>
          <SignInForm checking={auth.status === 'checking'} />
        </SignInLayout>
      )
  }
}

function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper min-h-svh lg:grid lg:grid-cols-[minmax(23rem,0.9fr)_minmax(34rem,1.1fr)]">
      <BrandPanel />

      <main className="relative flex min-h-[calc(100svh-10rem)] items-center px-5 py-10 sm:px-10 lg:min-h-svh lg:px-16 xl:px-24">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          <header className="flex flex-col gap-2">
            <p className="label-caps text-moss">Association workspace</p>
            <h1 className="font-display text-ink text-2xl leading-none font-bold tracking-[-0.035em]">
              Sign in
            </h1>
            <p className="text-ink-muted max-w-sm text-sm leading-relaxed">
              Use the account provided by your association administrator.
            </p>
          </header>

          <Panel className="panel-enter overflow-hidden">
            <div className="border-rule flex items-center justify-between border-b px-5 py-3">
              <span className="text-ink-muted text-xs font-medium">Secure staff access</span>
              <ShieldCheck className="text-moss size-4" aria-hidden="true" />
            </div>
            <PanelBody className="p-5 sm:p-6">{children}</PanelBody>
          </Panel>

          <div className="border-rule flex items-start gap-3 border-t pt-4">
            <span className="bg-paper-sunken text-ink-muted flex size-7 shrink-0 items-center justify-center rounded-[3px] font-mono text-xs">
              ?
            </span>
            <p className="text-ink-muted text-xs leading-relaxed">
              Accounts are managed by your administrator. If you have forgotten your password, ask
              them to reset it.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

function BrandPanel() {
  return (
    <aside className="bg-moss text-on-accent relative isolate min-h-40 overflow-hidden px-5 py-5 sm:px-10 sm:py-7 lg:flex lg:min-h-svh lg:flex-col lg:justify-between lg:px-12 lg:py-10">
      <PlatDrawing />

      <div className="relative z-10 flex items-center gap-3">
        <span className="border-on-accent/35 flex size-9 items-center justify-center rounded-[3px] border">
          <BrandMark />
        </span>
        <span className="font-display text-lg font-bold tracking-[-0.025em]">Artypest</span>
      </div>

      <div className="relative z-10 mt-14 hidden max-w-lg lg:block">
        <p className="font-display text-3xl leading-[1.04] font-bold tracking-[-0.045em]">
          Know the people.
          <br />
          Understand the place.
        </p>
        <p className="mt-5 max-w-md text-sm leading-relaxed opacity-75">
          One clear view of the residents, properties, organizations, and relationships that shape
          your community.
        </p>
      </div>

      <div className="relative z-10 mt-10 hidden items-center justify-between font-mono text-[0.6875rem] tracking-[0.08em] uppercase opacity-55 lg:flex">
        <span>Savannah, Georgia</span>
        <span>Association intelligence</span>
      </div>
    </aside>
  )
}

function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
      <path d="M4 19V6.5L11.5 4 20 7v12H4Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m4 12 7.5-2.5L20 12M11.5 4v15" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11.5" cy="9.5" r="1.5" fill="currentColor" />
    </svg>
  )
}

/*
  A survey drawing rather than a generic marketing illustration. It uses only
  currentColor, so the same mark stays legible when the dark palette swaps the
  moss and on-accent values.
*/
function PlatDrawing() {
  return (
    <svg
      viewBox="0 0 760 860"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.15">
        <path d="M-30 88 146 18l116 84-35 155-171 40L-30 88Z" />
        <path d="m146 18 8 163 73 76M154 181 56 297" />
        <path d="m262 102 176-68 94 101-48 142-174 26-83-46 35-155Z" />
        <path d="m438 34-31 154 77 89M407 188l-145-86M407 188l125-53" />
        <path d="m532 135 174-58 88 133-79 123-183-28-48-28 48-142Z" />
        <path d="m706 77-45 135 54 121M661 212l-129-77" />
        <path d="M56 297 227 257l83 46-21 168-190 23L8 387l48-90Z" />
        <path d="m99 494 58-116-101-81M157 378l132 93M157 378l70-121" />
        <path d="m310 303 174-26 48 28 14 151-121 88-136-73 21-168Z" />
        <path d="m425 544 5-145-120-96M430 399l102-94M430 399l116 57" />
        <path d="m532 305 183 28 54 112-89 128-134-117-14-151Z" />
        <path d="m680 573 1-137-149-131M681 436l88 9" />
        <path d="M99 494 289 471l136 73-45 161-179 36L52 628l47-134Z" />
        <path d="m201 741 46-137L99 494M247 604l133 101M247 604l42-133" />
        <path d="m425 544 121-88 134 117-27 161-166 47-107-76 45-161Z" />
        <path d="m487 781 33-162-95-75M520 619l133 115M520 619l160-46" />
        <path d="m680 573 89-128 96 107-25 176-187 6 27-161Z" />
        <path d="M653 734 840 728M769 445l-5 181 76 102" />
      </g>
      <g fill="currentColor">
        <circle cx="157" cy="378" r="4" />
        <circle cx="430" cy="399" r="4" />
        <circle cx="681" cy="436" r="4" />
        <circle cx="247" cy="604" r="4" />
        <circle cx="520" cy="619" r="4" />
      </g>
    </svg>
  )
}

function SignInForm({ checking }: { checking: boolean }) {
  const { signIn } = useAuth()
  const [failure, setFailure] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const submit = handleSubmit(async (values) => {
    setFailure(null)
    setFailure(await signIn(values.email, values.password))
  })

  // Still pending after the password is accepted, while the account is checked.
  const pending = isSubmitting || checking

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      {failure ? (
        <div role="alert">
          <Notice tone="error">{failure}</Notice>
        </div>
      ) : null}

      <Field label="Email address" error={errors.email?.message}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          {...register('email')}
        />
      </Field>

      <Field label="Password" error={errors.password?.message}>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-10"
            {...register('password')}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-1 right-1"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </Field>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          'Signing in'
        ) : (
          <>
            Sign in
            <ArrowRight aria-hidden="true" />
          </>
        )}
      </Button>
    </form>
  )
}

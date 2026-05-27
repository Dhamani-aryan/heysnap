import { useState, type FormEvent } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useLoginMutation } from '../hooks/auth/use-auth-mutations.ts'
import { ApiError } from '../lib/api-client.ts'
import { ThemeToggle } from '../components/theme-toggle.tsx'

export function LoginPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/login' })
  const loginMutation = useLoginMutation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    loginMutation.mutate(
      { email, password },
      {
        onSuccess: () => {
          navigate({ to: search.redirect ?? '/machines' })
        },
      },
    )
  }

  const errorMessage =
    loginMutation.error instanceof ApiError
      ? loginMutation.error.message
      : loginMutation.error
        ? 'Something went wrong. Try again.'
        : null

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-md">
      <div className="absolute right-sm top-sm">
        <ThemeToggle />
      </div>

      <form
        onSubmit={onSubmit}
        className="w-full max-w-[360px] rounded-2xl border border-border bg-card p-2xl shadow-sm"
      >
        <header className="mb-xl">
          <h1 className="text-[22px] font-[550] leading-[30px] tracking-[-0.035em] text-heading">
            Sign in to HeySnap
          </h1>
          <p className="mt-2xs text-[13px] leading-[20px] text-subheading">
            Use your email and password to continue.
          </p>
        </header>

        <div className="flex flex-col gap-md">
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={setEmail}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
          />
        </div>

        {errorMessage && (
          <p className="mt-md text-[13px] leading-[20px] text-failure">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={loginMutation.isPending}
          className="mt-xl inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-[13px] font-[520] text-white transition-[transform,background-color] duration-150 ease-out hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

type FieldProps = {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  autoComplete?: string
}

function Field({
  label,
  type,
  value,
  onChange,
  required,
  autoComplete,
}: FieldProps) {
  return (
    <label className="flex flex-col gap-2xs">
      <span className="text-[13px] leading-[20px] text-subheading">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        autoComplete={autoComplete}
        className="h-10 rounded-lg border border-border bg-input px-sm text-[14px] leading-[22px] text-input-foreground placeholder:text-placeholder transition-colors duration-150 ease-out focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost"
      />
    </label>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { AnimatePresence, motion, type Transition } from 'motion/react'
import {
  applyAuthSession,
  useLoginMutation,
} from '../hooks/auth/use-auth-mutations.ts'
import type { AuthResponse } from '../lib/auth/auth-api.ts'
import { ApiError } from '../lib/api-client.ts'
import { ThemeToggle } from '../components/theme-toggle.tsx'

type SuccessPhase = 'idle' | 'welcome' | 'tagline' | 'exiting'

const TAGLINE_PHASE_DELAY_MS = 1700
const EXIT_PHASE_DELAY_MS = 5000
const EXIT_DURATION_MS = 900

const SMOOTH_EASE = [0.22, 1, 0.36, 1] as const
const PANEL_TRANSITION: Transition = { duration: 0.85, ease: SMOOTH_EASE }
const SHELL_EXIT_TRANSITION: Transition = { duration: 0.9, ease: SMOOTH_EASE }
const BRAND_SPRING: Transition = {
  type: 'spring',
  stiffness: 140,
  damping: 22,
  mass: 1,
}
const TEXT_SPRING: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 26,
  mass: 0.85,
}

export function LoginPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/login' })
  const loginMutation = useLoginMutation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isInvalidFeedbackVisible, setIsInvalidFeedbackVisible] =
    useState(false)
  const [successPhase, setSuccessPhase] = useState<SuccessPhase>('idle')
  const pendingAuthRef = useRef<AuthResponse | null>(null)

  const isSuccessAnimating = successPhase !== 'idle'
  const isExpanded = isSuccessAnimating
  const successCopy =
    successPhase === 'tagline' || successPhase === 'exiting'
      ? 'Get your work done in a snap!'
      : 'Welcome to Snap!'
  const successCopyKey =
    successPhase === 'tagline' || successPhase === 'exiting'
      ? 'tagline'
      : 'welcome'

  const errorMessage =
    loginMutation.error instanceof ApiError
      ? loginMutation.error.message
      : loginMutation.error
        ? 'Something went wrong. Try again.'
        : null

  // Trigger input shake whenever a new error arrives.
  useEffect(() => {
    let resetFrame: number | undefined
    let showFrame: number | undefined

    if (!errorMessage) {
      resetFrame = window.requestAnimationFrame(() =>
        setIsInvalidFeedbackVisible(false),
      )
      return () => {
        if (resetFrame !== undefined) window.cancelAnimationFrame(resetFrame)
      }
    }

    resetFrame = window.requestAnimationFrame(() => {
      setIsInvalidFeedbackVisible(false)
      showFrame = window.requestAnimationFrame(() =>
        setIsInvalidFeedbackVisible(true),
      )
    })
    const timeout = window.setTimeout(
      () => setIsInvalidFeedbackVisible(false),
      2200,
    )
    return () => {
      if (resetFrame !== undefined) window.cancelAnimationFrame(resetFrame)
      if (showFrame !== undefined) window.cancelAnimationFrame(showFrame)
      window.clearTimeout(timeout)
    }
  }, [errorMessage])

  // Drive the success phase sequence and navigate when the exit completes.
  useEffect(() => {
    if (!isSuccessAnimating) return

    const taglineTimeout = window.setTimeout(
      () => setSuccessPhase('tagline'),
      TAGLINE_PHASE_DELAY_MS,
    )
    const exitTimeout = window.setTimeout(
      () => setSuccessPhase('exiting'),
      EXIT_PHASE_DELAY_MS,
    )
    const completeTimeout = window.setTimeout(() => {
      const pending = pendingAuthRef.current
      pendingAuthRef.current = null
      if (pending) applyAuthSession(pending)
      navigate({ to: search.redirect ?? '/machines' })
    }, EXIT_PHASE_DELAY_MS + EXIT_DURATION_MS)

    return () => {
      window.clearTimeout(taglineTimeout)
      window.clearTimeout(exitTimeout)
      window.clearTimeout(completeTimeout)
    }
  }, [isSuccessAnimating, navigate, search.redirect])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSuccessAnimating) return
    try {
      const data = await loginMutation.mutateAsync({ email, password })
      pendingAuthRef.current = data
      setIsInvalidFeedbackVisible(false)
      setSuccessPhase('welcome')
    } catch {
      // Error handled via mutation state → triggers shake effect.
    }
  }

  return (
    <motion.main
      className="relative flex min-h-screen items-center justify-center bg-background px-xl font-sans"
      initial={false}
      animate={{ opacity: successPhase === 'exiting' ? 0 : 1 }}
      transition={SHELL_EXIT_TRANSITION}
    >
      <div
        className={`absolute right-sm top-sm transition-opacity duration-[420ms] ${
          isSuccessAnimating ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <ThemeToggle />
      </div>

      <motion.form
        onSubmit={onSubmit}
        className="grid gap-[28px] transition-[width] duration-[720ms]"
        style={{
          width: `min(100%, ${isExpanded ? 640 : 380}px)`,
          transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
        initial={false}
        animate={{ y: isSuccessAnimating ? 32 : -48 }}
        transition={PANEL_TRANSITION}
      >
        <motion.div
          aria-label="HeySnap"
          className="grid justify-items-center"
          style={{
            gap: isExpanded ? '24px' : '20px',
            marginBottom: isExpanded ? '0px' : '40px',
            transition:
              'gap 720ms cubic-bezier(0.2, 0.8, 0.2, 1), margin-bottom 720ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
          initial={false}
          animate={{ scale: isSuccessAnimating ? 1.08 : 1 }}
          transition={BRAND_SPRING}
        >
          <img
            src="/logo/light/animated.gif"
            alt=""
            className="block h-auto dark:hidden"
            style={{
              width: `min(${isExpanded ? 96 : 78}px, ${isExpanded ? 30 : 25}vw)`,
              transition: 'width 720ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          />
          <img
            src="/logo/dark/animated.gif"
            alt=""
            className="hidden h-auto dark:block"
            style={{
              width: `min(${isExpanded ? 96 : 78}px, ${isExpanded ? 30 : 25}vw)`,
              transition: 'width 720ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          />

          <div
            aria-live="polite"
            className="grid text-center font-normal text-heading"
            style={{
              fontSize: isExpanded ? '28px' : '32px',
              lineHeight: 1,
              letterSpacing: 0,
              whiteSpace: 'nowrap',
              transition: 'font-size 720ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={successCopyKey}
                className="col-start-1 row-start-1"
                initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
                transition={{
                  ...TEXT_SPRING,
                  delay: successCopyKey === 'tagline' ? 0.22 : 0,
                }}
              >
                {successCopy}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>

        <div
          aria-hidden={isSuccessAnimating ? 'true' : undefined}
          className="grid gap-[28px] transition-[opacity,transform] duration-[280ms]"
          style={{
            opacity: isSuccessAnimating ? 0 : 1,
            transform: isSuccessAnimating ? 'translateY(14px)' : 'translateY(0)',
            visibility: isSuccessAnimating ? 'hidden' : 'visible',
            transitionDelay: isSuccessAnimating ? '0ms, 0ms' : '0ms, 0ms',
            pointerEvents: isSuccessAnimating ? 'none' : 'auto',
          }}
        >
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            name="email"
            required
            disabled={isSuccessAnimating}
            value={email}
            onChange={setEmail}
            isInvalid={isInvalidFeedbackVisible}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            name="password"
            required
            disabled={isSuccessAnimating}
            value={password}
            onChange={setPassword}
            isInvalid={isInvalidFeedbackVisible}
          />

          {errorMessage && (
            <div role="alert" className="sr-only">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loginMutation.isPending || isSuccessAnimating}
            className="flex h-[42px] cursor-pointer items-center justify-center rounded-pill border-0 bg-[#111111] px-[14px] text-[15px] font-normal text-white transition-colors duration-150 hover:bg-black disabled:cursor-not-allowed disabled:opacity-55 dark:bg-[#f5f5f5] dark:text-[#0f0f11] dark:hover:bg-white"
          >
            {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </motion.form>
    </motion.main>
  )
}

type FieldProps = {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  autoComplete?: string
  inputMode?: 'email' | 'text' | 'numeric'
  name?: string
  disabled?: boolean
  isInvalid?: boolean
}

function Field({
  label,
  type,
  value,
  onChange,
  required,
  autoComplete,
  inputMode,
  name,
  disabled,
  isInvalid,
}: FieldProps) {
  return (
    <label className="grid gap-[8px]">
      <span className="text-[13px] font-semibold text-subheading">{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        className={`h-[42px] w-full rounded-pill border border-[#e5e5e5] bg-background px-[18px] text-[15px] font-normal text-input-foreground placeholder:text-placeholder outline-none transition-colors duration-150 focus:border-[#d7d7d7] dark:border-[#242428] dark:focus:border-[#3b3b42] ${
          isInvalid ? 'animate-input-shake border-failure dark:border-failure' : ''
        }`}
      />
    </label>
  )
}

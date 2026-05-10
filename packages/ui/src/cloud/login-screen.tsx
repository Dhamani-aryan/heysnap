"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";

import darkLogoUrl from "../../../../apps/assets/heysnap-dark-logo.gif";
import lightLogoUrl from "../../../../apps/assets/heysnap-light-logo.gif";
import { ThemeToggle } from "../filesystem/theme-toggle";

type LogoAsset = string | { readonly src: string };
type SuccessPhase = "idle" | "welcome" | "tagline" | "exiting";

const TAGLINE_PHASE_DELAY_MS = 1700;
const EXIT_PHASE_DELAY_MS = 5000;
const EXIT_DURATION_MS = 900;
// easeOutExpo-style curve: confident takeoff, gentle settle. Used everywhere we
// don't reach for spring physics so the panel and text never fight each other.
const SMOOTH_EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_TRANSITION: Transition = { duration: 0.85, ease: SMOOTH_EASE };
const SHELL_EXIT_TRANSITION: Transition = { duration: 0.9, ease: SMOOTH_EASE };
const BRAND_SPRING: Transition = { type: "spring", stiffness: 140, damping: 22, mass: 1 };
const TEXT_SPRING: Transition = { type: "spring", stiffness: 200, damping: 26, mass: 0.85 };

const getLogoSrc = (asset: LogoAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export interface LoginScreenProps {
  readonly error: string | null;
  readonly isSubmitting: boolean;
  readonly onSuccessComplete: () => void;
  readonly onSubmit: (input: { readonly email: string; readonly password: string }) => Promise<boolean>;
}

export function LoginScreen({
  error,
  isSubmitting,
  onSuccessComplete,
  onSubmit,
}: LoginScreenProps): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isInvalidFeedbackVisible, setIsInvalidFeedbackVisible] = useState(false);
  const [successPhase, setSuccessPhase] = useState<SuccessPhase>("idle");
  const isSuccessAnimating = successPhase !== "idle";
  const successCopy = successPhase === "tagline" || successPhase === "exiting"
    ? "Get your work done in a snap!"
    : "Welcome to Snap!";
  const successCopyKey = successPhase === "tagline" || successPhase === "exiting" ? "tagline" : "welcome";

  useEffect(() => {
    if (error === null) {
      setIsInvalidFeedbackVisible(false);
      return;
    }

    setIsInvalidFeedbackVisible(false);

    const animationFrame = window.requestAnimationFrame(() => {
      setIsInvalidFeedbackVisible(true);
    });
    const timeout = window.setTimeout(() => {
      setIsInvalidFeedbackVisible(false);
    }, 2200);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [error]);

  useEffect(() => {
    if (!isSuccessAnimating) {
      return;
    }

    const taglineTimeout = window.setTimeout(() => {
      setSuccessPhase("tagline");
    }, TAGLINE_PHASE_DELAY_MS);
    const exitTimeout = window.setTimeout(() => {
      setSuccessPhase("exiting");
    }, EXIT_PHASE_DELAY_MS);
    const completeTimeout = window.setTimeout(() => {
      onSuccessComplete();
    }, EXIT_PHASE_DELAY_MS + EXIT_DURATION_MS);

    return () => {
      window.clearTimeout(taglineTimeout);
      window.clearTimeout(exitTimeout);
      window.clearTimeout(completeTimeout);
    };
  }, [isSuccessAnimating, onSuccessComplete]);

  return (
    <motion.main
      className="cloud-auth-shell"
      data-success-phase={successPhase}
      initial={false}
      animate={{ opacity: successPhase === "exiting" ? 0 : 1 }}
      transition={SHELL_EXIT_TRANSITION}
    >
      <div className="cloud-floating-actions">
        <ThemeToggle />
      </div>
      <motion.form
        className="cloud-auth-panel"
        data-invalid-feedback={isInvalidFeedbackVisible ? "true" : undefined}
        data-success-phase={successPhase}
        initial={false}
        animate={{ y: isSuccessAnimating ? 32 : -48 }}
        transition={PANEL_TRANSITION}
        onSubmit={(event) => {
          event.preventDefault();
          if (isSuccessAnimating) {
            return;
          }

          void onSubmit({ email, password }).then((didSucceed) => {
            if (didSucceed) {
              setIsInvalidFeedbackVisible(false);
              setSuccessPhase("welcome");
            }
          });
        }}
      >
        <motion.div
          className="cloud-auth-brand"
          aria-label="Heysnap"
          initial={false}
          animate={{ scale: isSuccessAnimating ? 1.08 : 1 }}
          transition={BRAND_SPRING}
        >
          <img
            className="cloud-auth-logo cloud-auth-logo-light"
            src={getLogoSrc(lightLogoUrl)}
            alt=""
          />
          <img
            className="cloud-auth-logo cloud-auth-logo-dark"
            src={getLogoSrc(darkLogoUrl)}
            alt=""
          />
          <div className="cloud-auth-wordmark" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={successCopyKey}
                className="cloud-auth-wordmark-text"
                initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                transition={{
                  ...TEXT_SPRING,
                  delay: successCopyKey === "tagline" ? 0.22 : 0,
                }}
              >
                {successCopy}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>

        <div className="cloud-auth-fields" aria-hidden={isSuccessAnimating ? "true" : undefined}>
          <label className="cloud-field">
            <span>Email</span>
            <input
              autoComplete="email"
              disabled={isSuccessAnimating}
              inputMode="email"
              name="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </label>

          <label className="cloud-field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              disabled={isSuccessAnimating}
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </label>

          {error !== null ? (
            <div className="cloud-auth-error cloud-auth-error-sr" role="alert">
              {error}
            </div>
          ) : null}

          <button className="cloud-primary-button" disabled={isSubmitting || isSuccessAnimating} type="submit">
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </motion.form>
    </motion.main>
  );
}

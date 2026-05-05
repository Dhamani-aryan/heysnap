"use client";

import { useEffect, useState } from "react";

import darkLogoUrl from "../../../../apps/assets/heysnap-dark-logo.gif";
import lightLogoUrl from "../../../../apps/assets/heysnap-light-logo.gif";
import { ThemeToggle } from "../filesystem/theme-toggle";

type LogoAsset = string | { readonly src: string };
type SuccessPhase = "idle" | "welcome" | "tagline";

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
    }, 1600);
    const completeTimeout = window.setTimeout(() => {
      onSuccessComplete();
    }, 5000);

    return () => {
      window.clearTimeout(taglineTimeout);
      window.clearTimeout(completeTimeout);
    };
  }, [isSuccessAnimating, onSuccessComplete]);

  return (
    <main className="cloud-auth-shell">
      <div className="cloud-floating-actions">
        <ThemeToggle />
      </div>
      <form
        className="cloud-auth-panel"
        data-invalid-feedback={isInvalidFeedbackVisible ? "true" : undefined}
        data-success-phase={successPhase}
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
        <div className="cloud-auth-brand" aria-label="Heysnap">
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
            <span className="cloud-auth-wordmark-text cloud-auth-wordmark-welcome">
              Welcome to Heysnap!
            </span>
            <span className="cloud-auth-wordmark-text cloud-auth-wordmark-tagline">
              Get your work done in a snap!
            </span>
          </div>
        </div>

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
      </form>
    </main>
  );
}

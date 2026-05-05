"use client";

import { useState } from "react";

import darkLogoUrl from "../../../../apps/assets/heysnap-dark-logo.gif";
import lightLogoUrl from "../../../../apps/assets/heysnap-light-logo.gif";
import { ThemeToggle } from "../filesystem/theme-toggle";

type LogoAsset = string | { readonly src: string };

const getLogoSrc = (asset: LogoAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export interface LoginScreenProps {
  readonly error: string | null;
  readonly isSubmitting: boolean;
  readonly onSubmit: (input: { readonly email: string; readonly password: string }) => Promise<void>;
}

export function LoginScreen({
  error,
  isSubmitting,
  onSubmit,
}: LoginScreenProps): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main className="cloud-auth-shell">
      <div className="cloud-floating-actions">
        <ThemeToggle />
      </div>
      <form
        className="cloud-auth-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ email, password });
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
          <div className="cloud-auth-wordmark">Welcome to Heysnap!</div>
        </div>

        <label className="cloud-field">
          <span>Email</span>
          <input
            autoComplete="email"
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
            name="password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </label>

        {error !== null ? <div className="cloud-auth-error" role="alert">{error}</div> : null}

        <button className="cloud-primary-button" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

"use client";

import { Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";
type DesktopWindowBridge = {
  readonly setTitleBarTheme?: (theme: Theme) => Promise<void>;
  readonly setTitleBarColor?: (color: string) => Promise<void>;
};

const getInitialTheme = (): Theme => {
  if (typeof window === "undefined") {
    return "dark";
  }

  // const stored = window.localStorage.getItem("theme");

  // if (stored === "light" || stored === "dark") {
  //   return stored;
  // }

  // return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return "dark";
};

export function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const icon = theme === "light" ? Moon02Icon : Sun01Icon;
  const nextThemeLabel = theme === "light" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("theme", theme);
    const desktopWindow = (window as Window & { readonly ank1015DesktopWindow?: DesktopWindowBridge })
      .ank1015DesktopWindow;
    const cloudBackground = getComputedStyle(document.documentElement)
      .getPropertyValue("--cloud-bg")
      .trim();

    void desktopWindow?.setTitleBarTheme?.(theme);

    if (cloudBackground.length > 0) {
      void desktopWindow?.setTitleBarColor?.(cloudBackground);
    }
  }, [theme]);

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${nextThemeLabel} theme`}
      title="Toggle theme"
      onClick={() => {
        // setTheme((current) => (current === "dark" ? "light" : "dark"));
        setTheme("dark");
      }}
    >
      <HugeiconsIcon
        icon={icon}
        size={theme === "dark" ? 20 : 18}
        color="currentColor"
        strokeWidth={1.8}
      />
    </button>
  );
}

"use client";

import { Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const getInitialTheme = (): Theme => {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem("theme");

  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const icon = theme === "light" ? Moon02Icon : Sun01Icon;
  const nextThemeLabel = theme === "light" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${nextThemeLabel} theme`}
      title="Toggle theme"
      onClick={() => {
        setTheme((current) => (current === "dark" ? "light" : "dark"));
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

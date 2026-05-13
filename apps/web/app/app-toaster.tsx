"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

type ToastTheme = "light" | "dark";

export function AppToaster(): React.ReactElement {
  const [theme, setTheme] = useState<ToastTheme>(() => getResolvedTheme());

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = (): void => setTheme(getResolvedTheme());
    const observer = new MutationObserver(updateTheme);

    updateTheme();
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <Toaster
      position="bottom-right"
      theme={theme}
      toastOptions={{
        duration: 8000,
      }}
    />
  );
}

const getResolvedTheme = (): ToastTheme => {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.classList.contains("dark") ? "dark" : "light";
};

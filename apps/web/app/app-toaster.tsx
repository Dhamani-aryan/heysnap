"use client";

import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";

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

  useEffect(() => {
    const handleAgentRunError = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail as { readonly message?: unknown } : undefined;
      const message = typeof detail?.message === "string" && detail.message.length > 0
        ? detail.message
        : "Agent run failed.";
      toast.error(message);
    };

    window.addEventListener("heysnap:agent-run-error", handleAgentRunError);
    return () => {
      window.removeEventListener("heysnap:agent-run-error", handleAgentRunError);
    };
  }, []);

  useEffect(() => {
    const handleToast = (event: Event): void => {
      const detail = event instanceof CustomEvent
        ? event.detail as {
          readonly type?: unknown;
          readonly message?: unknown;
          readonly description?: unknown;
        }
        : undefined;
      const message = typeof detail?.message === "string" && detail.message.length > 0
        ? detail.message
        : "Done";
      const description = typeof detail?.description === "string" && detail.description.length > 0
        ? detail.description
        : undefined;

      if (detail?.type === "error") {
        toast.error(message, { description });
        return;
      }

      if (detail?.type === "success") {
        toast.success(message, { description });
        return;
      }

      toast(message, { description });
    };

    window.addEventListener("heysnap:toast", handleToast);
    return () => {
      window.removeEventListener("heysnap:toast", handleToast);
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

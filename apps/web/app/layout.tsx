import "./globals.css";
import "@ank1015-app/ui/filesystem.css";
import "@ank1015-app/ui/cloud.css";

import heysnapIcon from "../../assets/heysnap.ico";
import { WebCloudRuntimeProvider } from "./cloud-runtime-provider";

const cloudServerUrl = process.env.NEXT_PUBLIC_CLOUD_SERVER_URL?.trim() || "https://api.heysnap.xyz";

const getIconSrc = (icon: string | { readonly src: string }): string => {
  return typeof icon === "string" ? icon : icon.src;
};

export const metadata = {
  title: "HeySnap",
  description: "Shared UI monorepo web app",
  icons: {
    icon: getIconSrc(heysnapIcon),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(() => {
  try {
    const stored = window.localStorage.getItem("theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  } catch {
  }
})();
`,
          }}
        />
      </head>
      <body>
        <WebCloudRuntimeProvider cloudServerUrl={cloudServerUrl}>
          {children}
        </WebCloudRuntimeProvider>
      </body>
    </html>
  );
}

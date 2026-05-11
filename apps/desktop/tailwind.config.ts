import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/renderer/src/**/*.{js,jsx,ts,tsx}",
    "../../packages/ui/src/**/*.{js,jsx,ts,tsx}",
    "../../node_modules/streamdown/dist/*.js",
    "../../node_modules/@streamdown/code/dist/*.js",
    "../../node_modules/@streamdown/cjk/dist/*.js",
    "../../node_modules/@streamdown/math/dist/*.js",
    "../../node_modules/@streamdown/mermaid/dist/*.js",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--sd-background) / <alpha-value>)",
        border: "hsl(var(--sd-border) / <alpha-value>)",
        foreground: "hsl(var(--sd-foreground) / <alpha-value>)",
        muted: {
          DEFAULT: "hsl(var(--sd-muted) / <alpha-value>)",
          foreground: "hsl(var(--sd-muted-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--sd-primary) / <alpha-value>)",
          foreground: "hsl(var(--sd-primary-foreground) / <alpha-value>)",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sd-sidebar) / <alpha-value>)",
        },
      },
    },
  },
};

export default config;

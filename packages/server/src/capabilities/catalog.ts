import type { CapabilitiesCatalog } from "./types.js";

const CODEX_VERSION = process.env.ANK1015_CODEX_VERSION?.trim() || "0.128.0";

export const defaultCapabilitiesCatalog: CapabilitiesCatalog = {
  version: "2026.05.08.3",
  codexToolId: "codex",
  tools: [
    {
      id: "codex",
      label: "Codex",
      command: "codex",
      desiredVersion: CODEX_VERSION,
      required: true,
      installStrategy: {
        type: "npm",
        packageName: "@openai/codex",
        binaryName: "codex",
      },
      versionCommand: { command: "codex", args: ["--version"] },
    },
    {
      id: "github",
      label: "GitHub CLI",
      logoUrl: "https://cdn.pixabay.com/photo/2022/01/30/13/33/github-6980894_960_720.png",
      command: "gh",
      desiredVersion: "ami",
      installStrategy: { type: "existing" },
      versionCommand: { command: "gh", args: ["--version"] },
      status: { command: "gh", args: ["auth", "status"] },
      connect: { command: "gh", args: ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"] },
      disconnect: { command: "gh", args: ["auth", "logout", "--hostname", "github.com"] },
    },
    {
      id: "vercel",
      label: "Vercel",
      logoUrl: "https://cdn.brandfetch.io/vercel.com/fallback/lettermark/theme/dark/h/256/w/256/icon?c=1bfwsmEH20zzEfSNTed",
      command: "vercel",
      desiredVersion: "53.2.0",
      installStrategy: {
        type: "npm",
        packageName: "vercel",
        binaryName: "vercel",
      },
      versionCommand: { command: "vercel", args: ["--version"] },
      status: { command: "vercel", args: ["whoami"] },
      connect: { command: "vercel", args: ["login", "--no-color"], env: { CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" } },
      disconnect: { command: "vercel", args: ["logout", "--non-interactive", "--no-color"], env: { CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" } },
    },
    {
      id: "supabase",
      label: "Supabase",
      logoUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSVs-3wFGo3YNa7pvF7s1gpGpEmsN5FLTUUUg&s",
      command: "supabase",
      desiredVersion: "ami",
      installStrategy: { type: "existing" },
      versionCommand: { command: "supabase", args: ["--version"] },
      status: { command: "supabase", args: ["projects", "list"] },
      connect: { command: "supabase", args: ["login", "--no-browser"], interactive: "tty" },
      disconnect: { command: "supabase", args: ["logout", "--yes"] },
    },
  ],
  skills: [],
};

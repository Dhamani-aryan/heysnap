import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentSkillDefinition, CapabilitiesCatalog } from "./types.js";

const CODEX_VERSION = process.env.ANK1015_CODEX_VERSION?.trim() || "0.128.0";
const BUNDLED_SKILLS_DIR = resolveBundledSkillsDir();

export const defaultCapabilitiesCatalog: CapabilitiesCatalog = {
  version: "2026.05.09.2",
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
  skills: loadBundledSkills(),
};

interface BundledSkillMetadata {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly description: string;
  readonly activeByDefault?: boolean;
}

function resolveBundledSkillsDir(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const configured = process.env.ANK1015_BUNDLED_SKILLS_DIR?.trim();
  const candidates = [
    configured,
    resolve(moduleDir, "..", "..", "skills"),
    resolve(process.cwd(), "skills"),
    resolve(process.cwd(), "packages", "server", "skills"),
    resolve(process.cwd(), "..", "..", "packages", "server", "skills"),
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function loadBundledSkills(): readonly AgentSkillDefinition[] {
  if (BUNDLED_SKILLS_DIR === null) {
    return [];
  }

  return readdirSync(BUNDLED_SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sourcePath = resolve(BUNDLED_SKILLS_DIR, entry.name);
      const metadataPath = resolve(sourcePath, "skill.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Partial<BundledSkillMetadata>;

      if (
        typeof metadata.id !== "string" ||
        typeof metadata.label !== "string" ||
        typeof metadata.version !== "string" ||
        typeof metadata.description !== "string"
      ) {
        throw new Error(`Invalid bundled skill metadata: ${metadataPath}`);
      }

      return {
        id: metadata.id,
        label: metadata.label,
        version: metadata.version,
        description: metadata.description,
        activeByDefault: metadata.activeByDefault === true,
        sourcePath,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

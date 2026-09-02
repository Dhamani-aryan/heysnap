import { useEffect, useState } from "react";

/**
 * Anything we accept on the `src` prop. URLs are fetched as text; `File` /
 * `Blob` go through `.text()` (which handles the encoding sniff for us);
 * `ArrayBuffer` / `Uint8Array` are decoded as UTF-8. Polymorphism here keeps
 * the contract aligned with the rest of the viewer family.
 */
export type HeySnapCodeSrc = string | File | Blob | ArrayBuffer | Uint8Array;

export interface ResolvedCodeSource {
  /** Decoded text content fed to Monaco. */
  text: string;
  /** Filename used by the toolbar title and the download button. */
  name: string;
  /**
   * Monaco language id inferred from the filename extension. Falls back to
   * `"plaintext"` when the extension is missing or unknown. Consumers can
   * override via the viewer's `language` prop.
   */
  language: string;
}

interface State {
  resolved: ResolvedCodeSource | null;
  error: Error | null;
  /** Increments on every `src` change so callers can react to fresh content. */
  version: number;
}

/**
 * Normalizes the polymorphic `src` prop into `{ text, name, language }`.
 * Fetches URLs, decodes buffers, and infers the language from the filename
 * extension. `version` bumps on every `src` change without clearing the
 * previous source while the new content resolves.
 */
export function useResolvedCodeSource(src: HeySnapCodeSrc): State {
  const [state, setState] = useState<State>({ resolved: null, error: null, version: 0 });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, error: null, version: prev.version + 1 }));

    (async () => {
      try {
        const resolved = await resolve(src);
        if (!cancelled) {
          setState((prev) => ({ resolved, error: null, version: prev.version }));
        }
      } catch (err) {
        if (!cancelled) {
          const error = err instanceof Error ? err : new Error(String(err));
          setState((prev) => ({ resolved: null, error, version: prev.version }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return state;
}

async function resolve(src: HeySnapCodeSrc): Promise<ResolvedCodeSource> {
  if (typeof src === "string") {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch source (${response.status} ${response.statusText}).`);
    }
    const text = await response.text();
    const name = filenameFromUrl(src);
    return { text, name, language: languageFromName(name) };
  }
  if (typeof File !== "undefined" && src instanceof File) {
    const text = await src.text();
    const name = src.name || "snippet.txt";
    return { text, name, language: languageFromName(name) };
  }
  if (typeof Blob !== "undefined" && src instanceof Blob) {
    const text = await src.text();
    const name = "snippet.txt";
    return { text, name, language: languageFromName(name) };
  }
  if (src instanceof ArrayBuffer) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(src);
    const name = "snippet.txt";
    return { text, name, language: languageFromName(name) };
  }
  if (src instanceof Uint8Array) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(src);
    const name = "snippet.txt";
    return { text, name, language: languageFromName(name) };
  }
  throw new Error(
    "HeySnapCodeViewer: `src` must be a URL string, File, Blob, ArrayBuffer, or Uint8Array.",
  );
}

function filenameFromUrl(src: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location?.href : "https://localhost/";
    const url = new URL(src, base);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "snippet.txt";
  } catch {
    const last = src.split(/[\\/]/).filter(Boolean).pop();
    return last ?? "snippet.txt";
  }
}

/**
 * Maps a filename's extension to a Monaco language id. The id list comes from
 * Monaco's built-in language registry (the ones loaded by default in the
 * `@monaco-editor/react` CDN bundle). Unknown extensions fall back to
 * `"plaintext"` so the editor still renders without highlighting.
 */
export function languageFromName(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "plaintext";
  const ext = lower.slice(dot + 1);
  return EXTENSION_TO_LANGUAGE[ext] ?? "plaintext";
}

/**
 * Lowercase extension → Monaco language id. Curated to cover the common cases
 * a viewer encounters; less common extensions fall through to plaintext.
 */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // JS / TS family
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",

  // Web
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  vue: "html",
  svelte: "html",

  // Data / config
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  svg: "xml",
  csv: "plaintext",
  env: "ini",

  // Markup
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",

  // Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",

  // Languages
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  fs: "fsharp",
  php: "php",
  pl: "perl",
  lua: "lua",
  r: "r",
  scala: "scala",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  cljs: "clojure",

  // Database / templates
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  hbs: "handlebars",
  handlebars: "handlebars",

  // Build / misc
  dockerfile: "dockerfile",
  makefile: "plaintext",
  proto: "proto",
};

"use client";

import { DiffsHighlighter, getSharedHighlighter, SupportedLanguages } from "@pierre/diffs";
import {
  Children,
  Suspense,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { resolveDiffThemeName } from "./diff-rendering";
import { fnv1a32 } from "./diff-rendering";
import { LruCache } from "./lru-cache";
import { resolveMarkdownFileLinkMeta, rewriteMarkdownFileUriHref, type MarkdownFileLinkMeta } from "./markdown-links";

export interface ChatMarkdownProps {
  readonly text: string;
  readonly cwd: string | undefined;
  readonly workspaceRoot?: string;
  readonly isStreaming?: boolean;
  readonly onOpenFilePath?: (path: string) => void;
}

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/u;
const highlightedCodeCache = new LruCache<string>(500, 50 * 1024 * 1024);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();
const MARKDOWN_LINK_HREF_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu;

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  cwd,
  workspaceRoot,
  isStreaming = false,
  onOpenFilePath,
}: ChatMarkdownProps) {
  const theme = useResolvedTheme();
  const fileLinkMetaByHref = useMemo(() => {
    const result = new Map<string, MarkdownFileLinkMeta>();
    for (const href of extractMarkdownLinkHrefs(text)) {
      const normalizedHref = rewriteMarkdownFileUriHref(href) ?? href;
      if (result.has(normalizedHref)) continue;
      const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd, workspaceRoot);
      if (meta !== null) {
        result.set(normalizedHref, meta);
      }
    }
    return result;
  }, [cwd, text, workspaceRoot]);

  const urlTransform = useCallback((href: string) => rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href), []);
  const components = useMemo<Components>(
    () => ({
      a({ node: _node, href, ...props }) {
        const normalizedHref = href ? rewriteMarkdownFileUriHref(href) ?? href : "";
        const meta = normalizedHref.length > 0 ? fileLinkMetaByHref.get(normalizedHref) : undefined;
        if (meta === undefined) {
          return (
            <a href={href} className={props.className} target="_blank" rel="noopener noreferrer">
              {props.children}
            </a>
          );
        }

        return (
          <MarkdownFileLink
            href={href ?? meta.targetPath}
            meta={meta}
            onOpenFilePath={onOpenFilePath}
          />
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (codeBlock === null) {
          return <pre>{children}</pre>;
        }

        return (
          <MarkdownCodeBlock code={codeBlock.code}>
            <Suspense fallback={<pre>{children}</pre>}>
              <HighlightedCodeBlock
                className={codeBlock.className}
                code={codeBlock.code}
                isStreaming={isStreaming}
                theme={theme}
              />
            </Suspense>
          </MarkdownCodeBlock>
        );
      },
    }),
    [fileLinkMetaByHref, isStreaming, onOpenFilePath, theme],
  );

  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

const MarkdownCodeBlock = ({ code, children }: { readonly code: string; readonly children: ReactNode }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => setCopied(false), 1200);
    });
  }, [code]);

  return (
    <div className="chat-markdown-codeblock">
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy code"}
        title={copied ? "Copied" : "Copy code"}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {children}
    </div>
  );
};

const HighlightedCodeBlock = ({
  className,
  code,
  isStreaming,
  theme,
}: {
  readonly className?: string;
  readonly code: string;
  readonly isStreaming: boolean;
  readonly theme: "light" | "dark";
}) => {
  const language = extractFenceLanguage(className);
  const themeName = resolveDiffThemeName(theme);
  const cacheKey = `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
  const [html, setHtml] = useState<string | null>(() => isStreaming ? null : highlightedCodeCache.get(cacheKey));

  useEffect(() => {
    let cancelled = false;
    if (isStreaming) {
      setHtml(null);
      return () => {
        cancelled = true;
      };
    }

    const cached = highlightedCodeCache.get(cacheKey);
    if (cached !== null) {
      setHtml(cached);
      return () => {
        cancelled = true;
      };
    }

    void getHighlighterPromise(language)
      .then((highlighter) => {
        const nextHtml = highlighter.codeToHtml(code, { lang: language, theme: themeName });
        highlightedCodeCache.set(cacheKey, nextHtml, Math.max(nextHtml.length * 2, code.length * 3));
        if (!cancelled) {
          setHtml(nextHtml);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, isStreaming, language, themeName]);

  if (html === null) {
    return (
      <pre>
        <code className={className}>{code}</code>
      </pre>
    );
  }

  return <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: html }} />;
};

const MarkdownFileLink = memo(function MarkdownFileLink({
  href,
  meta,
  onOpenFilePath,
}: {
  readonly href: string;
  readonly meta: MarkdownFileLinkMeta;
  readonly onOpenFilePath?: (path: string) => void;
}) {
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number } | null>(null);

  useEffect(() => {
    if (menu === null) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  const open = useCallback(() => {
    onOpenFilePath?.(meta.targetPath);
  }, [meta.targetPath, onOpenFilePath]);
  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value);
    setMenu(null);
  }, []);

  return (
    <>
      <a
        href={href}
        className="chat-markdown-file-link"
        title={meta.displayPath}
        onClick={(event) => {
          event.preventDefault();
          open();
        }}
        onContextMenu={(event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <span className="chat-markdown-file-icon" aria-hidden="true" />
        <span className="chat-markdown-file-label">{formatFileLinkLabel(meta)}</span>
      </a>
      {menu === null ? null : (
        <div className="chat-markdown-file-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button type="button" onClick={open}>Open</button>
          <button type="button" onClick={() => copy(meta.displayPath)}>Copy relative path</button>
          <button type="button" onClick={() => copy(meta.fullPath)}>Copy full path</button>
        </div>
      )}
    </>
  );
});

const extractCodeBlock = (children: ReactNode): { readonly className?: string; readonly code: string } | null => {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) return null;
  const onlyChild = childNodes[0];
  if (!isValidElement<{ readonly className?: string; readonly children?: ReactNode }>(onlyChild) || onlyChild.type !== "code") {
    return null;
  }
  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
};

const nodeToPlainText = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (isValidElement<{ readonly children?: ReactNode }>(node)) return nodeToPlainText(node.props.children);
  return "";
};

const extractFenceLanguage = (className: string | undefined): string => {
  const raw = className?.match(CODE_FENCE_LANGUAGE_REGEX)?.[1] ?? "text";
  return raw === "gitignore" ? "ini" : raw;
};

const getHighlighterPromise = (language: string): Promise<DiffsHighlighter> => {
  const cached = highlighterPromiseCache.get(language);
  if (cached !== undefined) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("light"), resolveDiffThemeName("dark")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((error) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") throw error;
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
};

const extractMarkdownLinkHrefs = (text: string): string[] => {
  const hrefs: string[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = match[1]?.trim();
    if (href) hrefs.push(href);
  }
  return hrefs;
};

const formatFileLinkLabel = (meta: MarkdownFileLinkMeta): string => {
  const parts = [meta.basename];
  if (meta.line !== undefined) {
    parts.push(`L${String(meta.line)}${meta.column === undefined ? "" : `:C${String(meta.column)}`}`);
  }
  return parts.join(" - ");
};

const useResolvedTheme = (): "light" | "dark" => {
  const readTheme = () =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
};

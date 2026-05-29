import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import {
  Streamdown,
  defaultUrlTransform,
  type Components,
  type PluginConfig,
  type UrlTransform,
} from 'streamdown'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from 'react'

import {
  resolveMarkdownFileLinkMeta,
  rewriteMarkdownFileUriHref,
  type MarkdownFileLinkMeta,
} from '../../lib/agent/markdown-links.ts'

export type ChatMarkdownProps = {
  readonly text: string
  readonly cwd: string | undefined
  readonly workspaceRoot?: string
  readonly isStreaming?: boolean
  readonly onOpenFilePath?: (path: string) => void
}

const MARKDOWN_LINK_HREF_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu
const streamdownPlugins = {
  cjk,
  code,
  math: createMathPlugin({ errorColor: 'var(--sd-muted-foreground)' }),
  mermaid,
} satisfies PluginConfig
const streamdownAnimation = {
  animation: 'fadeIn',
  duration: 120,
  easing: 'ease-out',
  sep: 'word',
  stagger: 12,
} as const
const linkSafety = { enabled: false } as const

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  cwd,
  workspaceRoot,
  isStreaming = false,
  onOpenFilePath,
}: ChatMarkdownProps) {
  const fileLinkMetaByHref = useMemo(() => {
    const result = new Map<string, MarkdownFileLinkMeta>()
    for (const href of extractMarkdownLinkHrefs(text)) {
      const normalizedHref = rewriteMarkdownFileUriHref(href) ?? href
      if (result.has(normalizedHref)) continue
      const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd, workspaceRoot)
      if (meta !== null) {
        result.set(normalizedHref, meta)
      }
    }
    return result
  }, [cwd, text, workspaceRoot])

  const urlTransform = useCallback<UrlTransform>((href, key, node) => {
    const rewritten = rewriteMarkdownFileUriHref(href)
    return rewritten ?? defaultUrlTransform(href, key, node)
  }, [])
  const components = useMemo<Components>(
    () => ({
      a({ node, href, children, ...props }: ComponentProps<'a'> & { readonly node?: unknown }) {
        void node
        const normalizedHref = href ? rewriteMarkdownFileUriHref(href) ?? href : ''
        const meta = normalizedHref.length > 0
          ? fileLinkMetaByHref.get(normalizedHref) ?? resolveMarkdownFileLinkMeta(normalizedHref, cwd, workspaceRoot)
          : null
        if (meta === null) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          )
        }

        return (
          <MarkdownFileLink
            href={href ?? meta.targetPath}
            meta={meta}
            onOpenFilePath={onOpenFilePath}
            {...props}
          >
            {children}
          </MarkdownFileLink>
        )
      },
    }),
    [cwd, fileLinkMetaByHref, onOpenFilePath, workspaceRoot],
  )

  return (
    <Streamdown
      animated={streamdownAnimation}
      className="chat-markdown"
      components={components}
      controls={{
        code: { copy: true, download: true },
        mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
        table: { copy: true, download: true, fullscreen: true },
      }}
      isAnimating={isStreaming}
      lineNumbers
      linkSafety={linkSafety}
      mode={isStreaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={isStreaming}
      plugins={streamdownPlugins}
      skipHtml
      urlTransform={urlTransform}
    >
      {text}
    </Streamdown>
  )
})

const MarkdownFileLink = memo(function MarkdownFileLink({
  href,
  meta,
  onOpenFilePath,
  children,
  className,
  ...props
}: {
  readonly href: string
  readonly meta: MarkdownFileLinkMeta
  readonly onOpenFilePath?: (path: string) => void
  readonly children: ReactNode
} & Omit<ComponentProps<'a'>, 'children' | 'href' | 'onClick' | 'onContextMenu'>) {
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number } | null>(null)

  useEffect(() => {
    if (menu === null) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const open = useCallback(() => {
    onOpenFilePath?.(meta.targetPath)
  }, [meta.targetPath, onOpenFilePath])
  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value)
    setMenu(null)
  }, [])

  return (
    <>
      <a
        href={href}
        className={className === undefined ? 'chat-markdown-file-link' : `${className} chat-markdown-file-link`}
        {...props}
        title={meta.displayPath}
        onClick={(event) => {
          event.preventDefault()
          open()
        }}
        onContextMenu={(event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        {children}
      </a>
      {menu === null ? null : (
        <div className="chat-markdown-file-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button type="button" onClick={open}>Open</button>
          <button type="button" onClick={() => copy(meta.displayPath)}>Copy relative path</button>
          <button type="button" onClick={() => copy(meta.fullPath)}>Copy full path</button>
        </div>
      )}
    </>
  )
})

function extractMarkdownLinkHrefs(text: string): string[] {
  const hrefs: string[] = []
  for (const match of text.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = match[1]?.trim()
    if (href) hrefs.push(href)
  }
  return hrefs
}

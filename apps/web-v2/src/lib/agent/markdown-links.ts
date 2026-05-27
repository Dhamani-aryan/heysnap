export type MarkdownFileLinkMeta = {
  readonly href: string
  readonly targetPath: string
  readonly displayPath: string
  readonly filePath: string
  readonly fullPath: string
  readonly basename: string
  readonly line?: number
  readonly column?: number
}

const ABSOLUTE_PATH_PATTERN = /^\/[^#:]*/u
const FILE_URI_PREFIX = 'file://'

export function rewriteMarkdownFileUriHref(
  href: string | undefined,
): string | null {
  if (href === undefined || !href.startsWith(FILE_URI_PREFIX)) {
    return null
  }

  try {
    const url = new URL(href)
    return `${decodeURIComponent(url.pathname)}${url.hash}`
  } catch {
    return href.slice(FILE_URI_PREFIX.length)
  }
}

export function resolveMarkdownFileLinkMeta(
  href: string | undefined,
  cwd: string | undefined,
  workspaceRoot: string | undefined,
): MarkdownFileLinkMeta | null {
  if (href === undefined || href.length === 0 || isExternalHref(href)) {
    return null
  }

  const rewritten = toWorkspaceHref(href)
  const parsed = splitLineColumn(rewritten)
  const targetPath = toClientPath(parsed.path, cwd, workspaceRoot)

  if (targetPath === null) {
    return null
  }

  const fullPath = toFullPath(parsed.path, targetPath, workspaceRoot)
  const basename = targetPath.split('/').filter(Boolean).at(-1) ?? targetPath
  return {
    href,
    targetPath,
    displayPath: targetPath,
    filePath: fullPath,
    fullPath,
    basename,
    line: parsed.line,
    column: parsed.column,
  }
}

function isExternalHref(href: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/iu.test(href) &&
    !href.startsWith(FILE_URI_PREFIX) &&
    toWorkspaceUrlPath(href) === null
  )
}

function toWorkspaceHref(href: string): string {
  return rewriteMarkdownFileUriHref(href) ?? toWorkspaceUrlPath(href) ?? decodePath(href)
}

function toWorkspaceUrlPath(href: string): string | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    return url.pathname === '/workspace' || url.pathname.startsWith('/workspace/')
      ? `${decodePath(url.pathname)}${url.hash}`
      : null
  } catch {
    return null
  }
}

function decodePath(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function splitLineColumn(value: string): {
  readonly path: string
  readonly line?: number
  readonly column?: number
} {
  const hashMatch = value.match(/^(.*)#L(\d+)(?:C(\d+))?$/u)
  if (hashMatch) {
    return {
      path: hashMatch[1] ?? '',
      line: Number(hashMatch[2]),
      column: hashMatch[3] === undefined ? undefined : Number(hashMatch[3]),
    }
  }

  const colonMatch = value.match(/^(.*?):(\d+)(?::(\d+))?$/u)
  if (
    colonMatch &&
    (colonMatch[1]?.includes('/') === true || colonMatch[1]?.includes('.') === true)
  ) {
    return {
      path: colonMatch[1],
      line: Number(colonMatch[2]),
      column: colonMatch[3] === undefined ? undefined : Number(colonMatch[3]),
    }
  }

  return { path: value }
}

function toClientPath(
  rawPath: string,
  cwd: string | undefined,
  workspaceRoot: string | undefined,
): string | null {
  const path = rawPath.trim().replaceAll('\\', '/')
  if (path.length === 0 || path.startsWith('#')) {
    return null
  }

  if (ABSOLUTE_PATH_PATTERN.test(path)) {
    const normalizedRoot = workspaceRoot?.replaceAll('\\', '/').replace(/\/+$/u, '')
    if (normalizedRoot !== undefined && path === normalizedRoot) {
      return ''
    }
    if (normalizedRoot !== undefined && path.startsWith(`${normalizedRoot}/`)) {
      return normalizeRelativePath(path.slice(normalizedRoot.length + 1))
    }

    if (path === '/workspace') {
      return ''
    }
    if (path.startsWith('/workspace/')) {
      return normalizeRelativePath(path.slice('/workspace/'.length))
    }

    const desktopIndex = path.indexOf('/Desktop/')
    if (desktopIndex >= 0) {
      return normalizeRelativePath(path.slice(desktopIndex + '/Desktop/'.length))
    }

    return null
  }

  if (path.startsWith('./') || path.startsWith('../')) {
    return normalizeRelativePath(`${cwd ?? ''}/${path}`)
  }

  return normalizeRelativePath(path)
}

function normalizeRelativePath(value: string): string | null {
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (part.length === 0 || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function toFullPath(
  rawPath: string,
  targetPath: string,
  workspaceRoot: string | undefined,
): string {
  const path = rawPath.trim().replaceAll('\\', '/')
  if (ABSOLUTE_PATH_PATTERN.test(path)) {
    return path
  }

  const normalizedRoot = workspaceRoot?.replaceAll('\\', '/').replace(/\/+$/u, '')
  if (normalizedRoot === undefined || normalizedRoot.length === 0) {
    return targetPath
  }

  return targetPath.length === 0 ? normalizedRoot : `${normalizedRoot}/${targetPath}`
}

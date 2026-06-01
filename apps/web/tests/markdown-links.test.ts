import { describe, expect, it } from 'vitest'
import {
  resolveMarkdownChromeLinkMeta,
  resolveMarkdownFileLinkMeta,
} from '../src/lib/agent/markdown-links.ts'

describe('agent markdown links', () => {
  it('treats workspace links as in-app filesystem targets', () => {
    expect(
      resolveMarkdownFileLinkMeta('/workspace/src/App.tsx#L12', '', undefined),
    ).toMatchObject({
      targetPath: 'src/App.tsx',
      line: 12,
    })
  })

  it('does not treat ordinary links as filesystem targets', () => {
    expect(resolveMarkdownFileLinkMeta('src/App.tsx', 'src', undefined)).toBeNull()
    expect(resolveMarkdownFileLinkMeta('/docs/readme.md', '', undefined)).toBeNull()
    expect(
      resolveMarkdownFileLinkMeta('https://example.com/src/App.tsx', '', undefined),
    ).toBeNull()
    expect(
      resolveMarkdownFileLinkMeta('https://example.com/workspace/src/App.tsx', '', undefined),
    ).toBeNull()
  })

  it('resolves chrome tab links', () => {
    expect(resolveMarkdownChromeLinkMeta('/chrome/123')).toEqual({
      href: '/chrome/123',
      tabId: 123,
    })
    expect(resolveMarkdownChromeLinkMeta('/chrome/not-a-tab')).toBeNull()
    expect(resolveMarkdownChromeLinkMeta('https://example.com/chrome/123')).toBeNull()
  })
})

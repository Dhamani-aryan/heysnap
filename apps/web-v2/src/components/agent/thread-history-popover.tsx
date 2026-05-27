import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  ArrowRight01Icon,
  Folder01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useAgentThreadGroups } from '../../hooks/agent/use-agent-thread-groups.ts'
import {
  selectHasThreads,
  useAgentThreadListStore,
} from '../../stores/agent/agent-thread-list-store.ts'
import type {
  AgentThreadGroup,
  AgentThreadSummary,
} from '../../lib/agent/types.ts'

type Props = {
  agentBaseUrl: string
  selectedThreadId: string | null
  onClose: () => void
  onSelectThread: (thread: AgentThreadSummary) => void
  anchorRef: RefObject<HTMLElement | null>
}

export function ThreadHistoryPopover({
  agentBaseUrl,
  selectedThreadId,
  onClose,
  onSelectThread,
  anchorRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')

  useAgentThreadGroups({ agentBaseUrl, enabled: true })

  const groups = useAgentThreadListStore((s) => s.groups)
  const isLoading = useAgentThreadListStore((s) => s.isLoading)
  const hasLoaded = useAgentThreadListStore((s) => s.hasLoaded)
  const error = useAgentThreadListStore((s) => s.error)
  const hasThreads = useAgentThreadListStore(selectHasThreads)

  useEffect(() => {
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 40)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (containerRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose, anchorRef])

  const filteredGroups = useMemo(
    () => filterGroups(groups, query),
    [groups, query],
  )

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Thread history"
      className="absolute right-0 top-[calc(100%+8px)] z-[1100] flex h-[min(476px,calc(100dvh-76px))] w-[312px] flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-[var(--color-dialog)] shadow-[0_16px_42px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.04)] backdrop-blur dark:border-white/10 dark:shadow-[0_16px_42px_rgba(0,0,0,0.45),inset_0_0.5px_0_rgba(255,255,255,0.08)]"
    >
      <div className="flex items-center gap-[8px] border-b border-black/[0.06] px-[14px] py-[10px] dark:border-white/[0.06]">
        <HugeiconsIcon
          icon={Search01Icon}
          size={16}
          strokeWidth={1.8}
          className="text-subheading"
        />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-[24px] flex-1 border-0 bg-transparent text-[13.5px] leading-[1.4] text-heading outline-none placeholder:text-placeholder"
        />
        {isLoading ? <Spinner /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[8px] py-[8px]">
        {error !== null ? (
          <p className="px-[12px] py-[28px] text-center text-[13px] text-failure">
            {error}
          </p>
        ) : (!hasLoaded || isLoading) && !hasThreads ? (
          <p className="px-[12px] py-[28px] text-center text-[13px] text-subheading">
            Loading chats...
          </p>
        ) : !hasThreads ? (
          <p className="px-[12px] py-[28px] text-center text-[13px] text-subheading">
            No previous chats.
          </p>
        ) : filteredGroups.length === 0 ? (
          <p className="px-[12px] py-[28px] text-center text-[13px] text-subheading">
            No chats match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <div className="flex flex-col gap-[2px]">
            {filteredGroups.map((group) => (
              <ThreadHistoryGroup
                key={group.path}
                group={group}
                selectedThreadId={selectedThreadId}
                forceExpanded={query.trim().length > 0}
                onSelectThread={onSelectThread}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ThreadHistoryGroup({
  group,
  selectedThreadId,
  forceExpanded,
  onSelectThread,
}: {
  group: AgentThreadGroup
  selectedThreadId: string | null
  forceExpanded: boolean
  onSelectThread: (thread: AgentThreadSummary) => void
}) {
  const label = group.path.trim().length === 0 ? 'workspace' : group.path
  const hasSelected = group.threads.some((t) => t.id === selectedThreadId)
  const [isExpanded, setIsExpanded] = useState(hasSelected)
  const [prevHasSelected, setPrevHasSelected] = useState(hasSelected)
  if (hasSelected !== prevHasSelected) {
    setPrevHasSelected(hasSelected)
    if (hasSelected) setIsExpanded(true)
  }
  const expanded = forceExpanded || isExpanded

  return (
    <section className="grid gap-[2px]">
      <button
        type="button"
        aria-expanded={expanded}
        title={label}
        onClick={() => setIsExpanded((c) => !c)}
        className="group flex h-[32px] w-full min-w-0 items-center gap-[8px] rounded-md px-[8px] text-left text-[13px] font-normal text-subheading transition-colors duration-150 hover:bg-sidebar-hover hover:text-heading aria-expanded:text-heading"
      >
        <HugeiconsIcon
          icon={Folder01Icon}
          size={15}
          strokeWidth={1.8}
          className="flex-shrink-0 text-subheading group-hover:text-heading"
        />
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {getFolderLabel(label)}
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          strokeWidth={1.8}
          className={`ml-auto text-subheading transition-transform duration-200 ease-out ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      <div
        className="grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
        }}
        aria-hidden={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-[1px] py-[2px] pb-[6px]">
            {group.threads.map((thread) => (
              <ThreadHistoryItem
                key={thread.id}
                thread={thread}
                isSelected={thread.id === selectedThreadId}
                onSelectThread={onSelectThread}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ThreadHistoryItem({
  thread,
  isSelected,
  onSelectThread,
}: {
  thread: AgentThreadSummary
  isSelected: boolean
  onSelectThread: (thread: AgentThreadSummary) => void
}) {
  const updatedLabel = useMemo(
    () => formatHistoryDate(thread.updatedAt),
    [thread.updatedAt],
  )
  return (
    <button
      type="button"
      onClick={() => onSelectThread(thread)}
      title={thread.title}
      data-selected={isSelected ? 'true' : undefined}
      className="group flex w-full min-w-0 items-center gap-[10px] rounded-md py-[7px] pl-[8px] pr-[10px] text-left text-heading transition-colors duration-150 hover:bg-black/[0.04] data-[selected=true]:bg-black/[0.04] dark:hover:bg-white/[0.06] dark:data-[selected=true]:bg-white/[0.06]"
    >
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium leading-[18px]">
        {thread.title}
      </span>
      <span className="flex-shrink-0 text-[11px] leading-[16px] text-subheading">
        {thread.isStreaming ? (
          <span className="inline-block h-[10px] w-[10px] animate-spin rounded-full border-[1.5px] border-current border-t-transparent align-middle" />
        ) : (
          updatedLabel
        )}
      </span>
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-[12px] w-[12px] animate-spin rounded-full border-[1.5px] border-current border-t-transparent text-subheading"
    />
  )
}

function getFolderLabel(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0)
  return segments.at(-1) ?? path
}

function filterGroups(
  groups: readonly AgentThreadGroup[],
  query: string,
): AgentThreadGroup[] {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) {
    return groups.filter((group) => group.threads.length > 0).map((group) => ({
      path: group.path,
      threads: [...group.threads],
    }))
  }
  return groups
    .map((group) => {
      const matchesPath = group.path.toLowerCase().includes(normalized)
      const threads = matchesPath
        ? [...group.threads]
        : group.threads.filter((thread) =>
            thread.title.toLowerCase().includes(normalized),
          )
      return { path: group.path, threads }
    })
    .filter((group) => group.threads.length > 0)
}

function formatHistoryDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ''
  const elapsedMs = Date.now() - timestamp
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000))
  if (elapsedMinutes < 1) return 'now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h`
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return `${elapsedDays}d`
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

import type { ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  LayoutAlignRightIcon,
  PlusSignIcon,
  WorkHistoryIcon,
} from '@hugeicons/core-free-icons'
import { ThemeToggle } from '../../theme-toggle.tsx'
import { useWorkspaceLayout } from './use-workspace-layout.ts'

export function WorkspaceToolbar() {
  const router = useRouter()
  const { isRightSidebarOpen, toggleRightSidebar } = useWorkspaceLayout()
  const sidebarLabel = isRightSidebarOpen
    ? 'Close right sidebar'
    : 'Open right sidebar'

  return (
    <header className="relative z-[4] flex h-[44px] flex-shrink-0 items-center gap-[8px] px-sm">
      <NavPill
        onBack={() => router.history.back()}
        onForward={() => router.history.forward()}
      />
      <div className="flex-1" />
      <ThemeToggle compact />
      <ToolbarIconButton icon={WorkHistoryIcon} label="History" />
      <ToolbarIconButton icon={PlusSignIcon} label="New" />
      <ToolbarIconButton
        icon={LayoutAlignRightIcon}
        label={sidebarLabel}
        onClick={toggleRightSidebar}
        pressed={isRightSidebarOpen}
      />
    </header>
  )
}

function NavPill({
  onBack,
  onForward,
}: {
  onBack: () => void
  onForward: () => void
}) {
  return (
    <div className="flex h-[26px] w-[60px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f9f9f9] shadow-[0_4px_16px_rgba(0,0,0,0.08)] outline outline-1 outline-[rgba(0,0,0,0.035)] dark:bg-[#1a1a1a] dark:outline-[rgba(255,255,255,0.06)]">
      <NavPillButton onClick={onBack} label="Back" position="left">
        <ChevronGlyph direction="left" />
      </NavPillButton>
      <NavPillButton onClick={onForward} label="Forward" position="right">
        <ChevronGlyph direction="right" />
      </NavPillButton>
    </div>
  )
}

function NavPillButton({
  children,
  onClick,
  label,
  position,
}: {
  children: ReactNode
  onClick: () => void
  label: string
  position: 'left' | 'right'
}) {
  const radius =
    position === 'left'
      ? 'rounded-l-full rounded-r-none'
      : 'rounded-r-full rounded-l-none'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-[26px] w-[30px] items-center justify-center ${radius} text-black/50 transition-colors duration-150 hover:bg-[#f5f5f5] hover:text-[#111] dark:text-[#a3a3a3] dark:hover:bg-[#1a1a1a] dark:hover:text-[#f5f5f5]`}
    >
      {children}
    </button>
  )
}

function ChevronGlyph({ direction }: { direction: 'left' | 'right' }) {
  const rotate = direction === 'left' ? 90 : -90
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type ToolbarIconButtonProps = {
  icon: IconSvgElement
  label: string
  onClick?: () => void
  pressed?: boolean
}

function ToolbarIconButton({
  icon,
  label,
  onClick,
  pressed,
}: ToolbarIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-subheading transition-[transform,background-color,color] duration-150 ease-out hover:bg-secondary-hover hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.97]"
    >
      <HugeiconsIcon icon={icon} size={18} strokeWidth={1.75} />
    </button>
  )
}

import { useEffect, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { motion } from 'motion/react'

const HEYSNAP_CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/heysnap/mhbbmhbknbmnfogkmhbjnjmolglaljjn'

export function BrowserExtensionPromptDialog({
  onClose,
}: {
  readonly onClose: () => void
}): ReactElement | null {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[14] flex items-center justify-center bg-black/16 p-[18px] animate-[browser-extension-backdrop-enter_180ms_ease-out_both] dark:bg-black/38"
      role="presentation"
      onClick={onClose}
    >
      <section
        aria-label="Add Heysnap to chrome"
        aria-modal="true"
        className="relative grid w-[min(100%,500px)] justify-items-center gap-[18px] rounded-[8px] border border-border bg-card px-[24px] pb-[24px] pt-[26px] shadow-[0_18px_60px_rgba(0,0,0,0.14)] animate-[browser-extension-modal-enter_220ms_cubic-bezier(0.22,1,0.36,1)_both] dark:shadow-[0_18px_60px_rgba(0,0,0,0.42)]"
        role="dialog"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <h2 className="m-0 text-center text-[28px] font-[350] leading-[1.1] tracking-[0] text-[#252629] dark:text-[#e3e4e6]">
          Add Heysnap to chrome
        </h2>
        <div
          className="relative mt-[4px] grid h-[126px] w-[min(100%,260px)] place-items-center overflow-hidden"
          aria-hidden="true"
        >
          <motion.svg
            className="block h-[62px] w-[62px] origin-[25%_25%] drop-shadow-[0_12px_18px_rgba(59,131,246,0.24)] motion-reduce:transform-none"
            viewBox="0 0 100 100"
            initial={{ x: -16, y: 8, rotate: -10 }}
            animate={{
              x: [-16, 24, 4, -26, 18, -16],
              y: [8, -10, 18, 2, -16, 8],
              rotate: [-10, 8, -3, 11, -7, -10],
            }}
            transition={{
              duration: 8.5,
              ease: 'easeInOut',
              repeat: Infinity,
            }}
          >
            <path
              d="M 25 25 Q 48 30 75 42 Q 48 48 42 75 Q 30 48 25 25 Z"
              fill="#3B83F6"
              stroke="#3B83F6"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="12"
            />
          </motion.svg>
        </div>
        <p className="m-0 max-w-[390px] text-center text-[14px] font-normal leading-[1.5] tracking-[0] text-subheading">
          Add Snap to your chrome to give it more powers and let it do all your
          chrome work.
        </p>
        <a
          className="mt-[2px] flex h-[38px] min-w-[126px] items-center justify-center rounded-full bg-heading px-[18px] text-[14px] font-normal text-background no-underline hover:bg-black dark:bg-[#f5f5f5] dark:text-[#0f0f10] dark:hover:bg-white"
          href={HEYSNAP_CHROME_EXTENSION_URL}
          target="_blank"
          rel="noreferrer"
        >
          Add extension
        </a>
        <button
          aria-label="Close extension dialog"
          className="absolute right-[12px] top-[25px] inline-flex h-[32px] w-[32px] items-center justify-center rounded-[6px] border-0 bg-transparent text-subheading transition-colors duration-[120ms] hover:bg-secondary-hover hover:text-heading"
          title="Close"
          type="button"
          onClick={onClose}
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            size={18}
            color="currentColor"
            strokeWidth={1.8}
          />
        </button>
      </section>
    </div>,
    document.body,
  )
}

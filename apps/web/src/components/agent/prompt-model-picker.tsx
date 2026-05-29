import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import type { PromptModelChoice } from '../../lib/agent/model-selection.ts'

export type PromptModelPickerState = {
  readonly value: PromptModelChoice
  readonly disabled?: boolean
  readonly onChange: (value: PromptModelChoice) => void
}

const MODEL_OPTIONS: readonly {
  readonly value: PromptModelChoice
  readonly label: string
  readonly logoSrc: string
}[] = [
  {
    value: 'gpt',
    label: 'GPT',
    logoSrc: 'https://models.dev/logos/openai.svg',
  },
  {
    value: 'claude',
    label: 'Claude',
    logoSrc: 'https://models.dev/logos/anthropic.svg',
  },
]

export function PromptModelPicker({
  value,
  disabled = false,
  onChange,
}: PromptModelPickerState) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selectedOption =
    MODEL_OPTIONS.find((option) => option.value === value) ?? MODEL_OPTIONS[0]

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return
      setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div
      ref={rootRef}
      className="relative inline-flex shrink-0"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={`Model: ${selectedOption.label}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={
          disabled
            ? 'Model can only be changed before starting a new chat'
            : 'Choose model'
        }
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-[28px] items-center gap-[6px] rounded-[6px] bg-black/[0.04] px-[8px] text-[12px] font-semibold leading-[28px] text-black/65 transition-colors duration-[120ms] hover:enabled:bg-black/[0.07] hover:enabled:text-black/80 disabled:cursor-default disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:rgba(0,0,0,0.12)] dark:bg-white/[0.07] dark:text-white/70 dark:hover:enabled:bg-white/10 dark:hover:enabled:text-white/85 dark:focus-visible:[outline-color:rgba(255,255,255,0.12)]"
      >
        <ModelLogo src={selectedOption.logoSrc} />
        <span>{selectedOption.label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={12}
          color="currentColor"
          strokeWidth={2}
          className={`transition-transform duration-[120ms] ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && !disabled ? (
        <div className="absolute bottom-[34px] right-0 z-[40] min-w-[150px] overflow-hidden rounded-[10px] border border-black/[0.08] bg-white p-[4px] shadow-[0_16px_40px_rgba(0,0,0,0.16)] dark:border-white/[0.1] dark:bg-[#202021] dark:shadow-[0_18px_44px_rgba(0,0,0,0.42)]">
          <div role="listbox" aria-label="Model" className="grid gap-[2px]">
            {MODEL_OPTIONS.map((option) => {
              const isSelected = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setIsOpen(false)
                    onChange(option.value)
                  }}
                  className={`flex h-[34px] w-full items-center gap-[8px] rounded-[7px] px-[8px] text-left text-[13px] font-medium transition-colors duration-[120ms] ${
                    isSelected
                      ? 'bg-black/[0.05] text-black/75 hover:bg-black/[0.07] dark:bg-white/[0.08] dark:text-white/[0.78] dark:hover:bg-white/[0.1]'
                      : 'text-black/75 hover:bg-black/[0.05] dark:text-white/[0.78] dark:hover:bg-white/[0.08]'
                  }`}
                >
                  <ModelLogo src={option.logoSrc} />
                  <span className="min-w-0 flex-1">{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ModelLogo({ src }: { src: string }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)] dark:bg-white">
      <img src={src} alt="" className="h-[13px] w-[13px]" aria-hidden="true" />
    </span>
  )
}

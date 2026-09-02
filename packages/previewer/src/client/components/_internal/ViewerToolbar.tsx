import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Refresh01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { IconButton } from "./IconButton";

interface ViewerHeaderShellProps {
  background: string;
  foreground: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const headerBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  height: 40,
  flexShrink: 0,
  padding: "0 8px",
  position: "relative",
  zIndex: 2,
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

const headerControlColor = (foreground: string): string =>
  `color-mix(in srgb, ${foreground} 72%, transparent)`;

export function ViewerHeaderShell({
  background,
  foreground,
  style,
  children,
}: ViewerHeaderShellProps) {
  return (
    <header
      style={{
        ...headerBaseStyle,
        "--viewer-header-control-color": headerControlColor(foreground),
        background,
        color: foreground,
        ...style,
      } as CSSProperties}
    >
      {children}
    </header>
  );
}

export function ViewerHeaderGroup({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        gap: 6,
        flex: align === "right" ? "0 0 auto" : "1 1 auto",
        minWidth: 0,
        color: "var(--viewer-header-control-color, inherit)",
      }}
    >
      {children}
    </div>
  );
}

export function ViewerReloadButton({
  disabled = false,
  onReload,
}: {
  disabled?: boolean;
  onReload: () => void;
}) {
  return (
    <IconButton
      aria-label="Reload preview"
      title="Reload preview"
      disabled={disabled}
      onClick={onReload}
    >
      <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.9} />
    </IconButton>
  );
}

export function ViewerValuePicker({
  background,
  disabled = false,
  foreground,
  formatValue,
  label,
  onChange,
  options,
  value,
}: {
  background: string;
  disabled?: boolean;
  foreground: string;
  formatValue: (value: number) => string;
  label: string;
  onChange: (next: number) => void;
  options: readonly number[];
  value: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedIndex = nearestValueIndex(options, value);
  const selectedValue = options[selectedIndex] ?? value;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleWindowBlur = () => setIsOpen(false);

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isOpen]);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  const openMenu = (focusIndex = selectedIndex) => {
    if (disabled) return;
    setIsOpen(true);
    window.requestAnimationFrame(() => itemRefs.current[focusIndex]?.focus());
  };

  const selectValue = (nextValue: number) => {
    onChange(nextValue);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(selectedIndex);
    }
  };

  return (
    <div
      ref={rootRef}
      title={label}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && rootRef.current?.contains(nextTarget)) return;
        setIsOpen(false);
      }}
      style={{ position: "relative", flexShrink: 0 }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          minWidth: 70,
          height: 28,
          padding: "0 8px 0 10px",
          border: 0,
          borderRadius: 6,
          background: isOpen
            ? "color-mix(in srgb, currentColor 12%, transparent)"
            : "transparent",
          color: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          font: "inherit",
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          opacity: disabled ? 0.35 : 1,
          outline: "none",
        }}
      >
        <span>{formatValue(selectedValue)}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.1} />
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label={label}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 10,
            minWidth: 112,
            padding: 4,
            borderRadius: 8,
            background,
            color: foreground,
            boxShadow:
              "0 12px 30px color-mix(in srgb, #000 20%, transparent), 0 0 0 1px color-mix(in srgb, currentColor 12%, transparent)",
          }}
        >
          {options.map((option, index) => {
            const isSelected = option === selectedValue;
            const isHovered = option === hoveredValue;

            return (
              <button
                key={option}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => selectValue(option)}
                onFocus={() => setHoveredValue(option)}
                onMouseEnter={() => setHoveredValue(option)}
                onMouseLeave={() => setHoveredValue(null)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    const nextIndex = (index + direction + options.length) % options.length;
                    itemRefs.current[nextIndex]?.focus();
                    setHoveredValue(options[nextIndex] ?? null);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    itemRefs.current[0]?.focus();
                    setHoveredValue(options[0] ?? null);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    const lastIndex = options.length - 1;
                    itemRefs.current[lastIndex]?.focus();
                    setHoveredValue(options[lastIndex] ?? null);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  width: "100%",
                  minHeight: 28,
                  padding: "0 7px 0 9px",
                  border: 0,
                  borderRadius: 6,
                  background: isHovered || isSelected
                    ? "color-mix(in srgb, currentColor 9%, transparent)"
                    : "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "left",
                }}
              >
                <span>{formatValue(option)}</span>
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    opacity: isSelected ? 1 : 0,
                  }}
                >
                  <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2.2} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const nearestValueIndex = (options: readonly number[], value: number): number => {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  options.forEach((option, index) => {
    const distance = Math.abs(option - value);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return bestIndex;
};

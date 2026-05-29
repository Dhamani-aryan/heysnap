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
  Download01Icon,
  Refresh01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { IconButton } from "../../_internal/IconButton";
import type { ResolvedImageSource } from "./useResolvedImageSource";

// Familiar zoom ladder — same shape as the XLSX viewer's so the three
// document-style viewers feel like a family. The bounds are slightly wider
// because images get inspected at high magnifications more often than
// spreadsheets do.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8.0;
const ZOOM_PRESETS = [
  0.25,
  0.5,
  0.75,
  1.0,
  1.25,
  1.5,
  2.0,
  3.0,
  4.0,
  6.0,
  8.0,
] as const;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

interface HeaderShellProps {
  background: string;
  foreground: string;
  /** Escape-hatch styles merged on top of the default chrome. */
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

/**
 * Stateless visual shell. Renders before the image has loaded so the
 * chrome is identical across loading / error / ready states.
 */
export function ImageHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <header style={{ ...headerBaseStyle, background, color: foreground, ...style }}>
      {children}
    </header>
  );
}

interface ImageHeaderGroupProps {
  align?: "left" | "right";
  children?: ReactNode;
}

export function ImageHeaderGroup({ align = "left", children }: ImageHeaderGroupProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        gap: 6,
        flex: align === "right" ? "0 0 auto" : "1 1 auto",
        minWidth: 0,
        color: "color-mix(in srgb, currentColor 72%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

interface ImageReloadButtonProps {
  disabled?: boolean;
  onReload: () => void;
}

export function ImageReloadButton({ disabled = false, onReload }: ImageReloadButtonProps) {
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

interface ImageZoomPickerProps {
  background: string;
  foreground: string;
  /** Current zoom (1.0 == 100 %). */
  zoom: number;
  /** Called with the *next* clamped ratio. */
  onZoom: (next: number) => void;
  /** True when no image is mounted yet (loading / error states). */
  disabled?: boolean;
}

export function ImageZoomPicker({
  background,
  foreground,
  zoom,
  onZoom,
  disabled = false,
}: ImageZoomPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredLevel, setHoveredLevel] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedIndex = nearestZoomPresetIndex(zoom);
  const selectedZoom = ZOOM_PRESETS[selectedIndex] ?? 1;

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

  const selectZoom = (nextZoom: number) => {
    onZoom(clampZoom(nextZoom));
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
      title="Zoom level"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && rootRef.current?.contains(nextTarget)) return;
        setIsOpen(false);
      }}
      style={{
        position: "relative",
        flexShrink: 0,
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Zoom level"
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
        <span>{formatZoom(selectedZoom)}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.1} />
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label="Zoom level"
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
          {ZOOM_PRESETS.map((level, index) => {
            const isSelected = level === selectedZoom;
            const isHovered = level === hoveredLevel;

            return (
              <button
                key={level}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => selectZoom(level)}
                onFocus={() => setHoveredLevel(level)}
                onMouseEnter={() => setHoveredLevel(level)}
                onMouseLeave={() => setHoveredLevel(null)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    const nextIndex =
                      (index + direction + ZOOM_PRESETS.length) % ZOOM_PRESETS.length;
                    itemRefs.current[nextIndex]?.focus();
                    setHoveredLevel(ZOOM_PRESETS[nextIndex] ?? null);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    itemRefs.current[0]?.focus();
                    setHoveredLevel(ZOOM_PRESETS[0] ?? null);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    const lastIndex = ZOOM_PRESETS.length - 1;
                    itemRefs.current[lastIndex]?.focus();
                    setHoveredLevel(ZOOM_PRESETS[lastIndex] ?? null);
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
                <span>{formatZoom(level)}</span>
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

interface ImageDownloadButtonProps {
  resolved: ResolvedImageSource;
}

/**
 * Downloads the displayed image. Object-URL sources (File / Blob / buffer)
 * are written straight back to disk under their resolved name; remote URLs
 * are handed to the browser's native download attribute. The `download` hint
 * is best-effort on cross-origin URLs — that's a server-side limitation we
 * can't paper over.
 */
export function ImageDownloadButton({ resolved }: ImageDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" title="Download" onClick={() => downloadImage(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadImage(resolved: ResolvedImageSource) {
  const a = document.createElement("a");
  a.href = resolved.url;
  a.download = resolved.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function nearestZoomPresetIndex(zoom: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  ZOOM_PRESETS.forEach((preset, index) => {
    const distance = Math.abs(preset - zoom);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return bestIndex;
}

function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

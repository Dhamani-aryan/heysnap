import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
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

export type HtmlViewMode = "preview" | "code";
export const HTML_ZOOM_LEVELS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2] as const;
export type HtmlZoomLevel = typeof HTML_ZOOM_LEVELS[number];

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

const headerControlColor = (foreground: string): string =>
  `color-mix(in srgb, ${foreground} 70%, transparent)`;

/** Stateless header bar — renders identically across loading / error /
 *  ready states. */
export function HtmlHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
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

export function HtmlHeaderGroup({ align, children }: {
  readonly align: "left" | "right";
  readonly children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        gap: 6,
        minWidth: 0,
        flex: 1,
        color: "var(--viewer-header-control-color, inherit)",
      }}
    >
      {children}
    </div>
  );
}

interface HtmlReloadButtonProps {
  onReload: () => void;
  disabled?: boolean;
}

export function HtmlReloadButton({ onReload, disabled = false }: HtmlReloadButtonProps) {
  return (
    <IconButton
      aria-label="Reload preview"
      title="Reload preview"
      disabled={disabled}
      onClick={onReload}
    >
      <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={2} />
    </IconButton>
  );
}

interface HtmlDownloadButtonProps {
  name: string;
  url: string;
}

/** Downloads the current HTML document through the preview server URL. */
export function HtmlDownloadButton({ name, url }: HtmlDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" title="Download" onClick={() => downloadHtml(url, name)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

interface HtmlZoomPickerProps {
  zoom: number;
  onZoom: (next: number) => void;
  background: string;
  foreground: string;
  dismissVersion?: number;
  disabled?: boolean;
}

export function HtmlZoomPicker({
  zoom,
  onZoom,
  background,
  foreground,
  dismissVersion,
  disabled = false,
}: HtmlZoomPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredLevel, setHoveredLevel] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedIndex = selectedZoomIndex(zoom);
  const selectedZoom = HTML_ZOOM_LEVELS[selectedIndex] ?? 1;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleWindowBlur = () => {
      setIsOpen(false);
    };

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
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    setIsOpen(false);
  }, [dismissVersion]);

  const openMenu = (focusIndex = selectedIndex) => {
    if (disabled) {
      return;
    }

    setIsOpen(true);
    window.requestAnimationFrame(() => itemRefs.current[focusIndex]?.focus());
  };

  const selectZoom = (next: number) => {
    onZoom(next);
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
        if (nextTarget instanceof Node && rootRef.current?.contains(nextTarget)) {
          return;
        }
        setIsOpen(false);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        position: "relative",
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
          height: 28,
          minWidth: 78,
          border: 0,
          borderRadius: 6,
          background: disabled
            ? "transparent"
            : "color-mix(in srgb, currentColor 7%, transparent)",
          color: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          outline: "none",
          padding: "0 8px",
          font: "inherit",
          fontSize: 12,
          fontWeight: 600,
          lineHeight: "28px",
          opacity: disabled ? 0.35 : 1,
        }}
      >
        <span>{formatZoomLabel(selectedZoom)}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.1} />
      </button>
      {isOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label="Zoom level"
          aria-activedescendant={`${menuId}-${String(selectedZoom)}`}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 40,
            display: "flex",
            width: 112,
            flexDirection: "column",
            gap: 1,
            padding: 5,
            border: `1px solid color-mix(in srgb, ${foreground} 12%, transparent)`,
            borderRadius: 10,
            background: `color-mix(in srgb, ${background} 96%, ${foreground} 4%)`,
            boxShadow:
              "0 10px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)",
            color: foreground,
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {HTML_ZOOM_LEVELS.map((level, index) => (
            <ZoomMenuItem
              key={level}
              refCallback={(node) => {
                itemRefs.current[index] = node;
              }}
              id={`${menuId}-${String(level)}`}
              level={level}
              selected={level === selectedZoom}
              hovered={hoveredLevel === level}
              onHover={() => setHoveredLevel(level)}
              onHoverEnd={() => setHoveredLevel(null)}
              onSelect={() => selectZoom(level)}
              onKeyDown={(event) => {
                handleMenuItemKeyDown(event, index, itemRefs, triggerRef, () => setIsOpen(false));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ZoomMenuItem({
  refCallback,
  id,
  level,
  selected,
  hovered,
  onHover,
  onHoverEnd,
  onSelect,
  onKeyDown,
}: {
  refCallback: (node: HTMLButtonElement | null) => void;
  id: string;
  level: number;
  selected: boolean;
  hovered: boolean;
  onHover: () => void;
  onHoverEnd: () => void;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const active = hovered;

  return (
    <button
      ref={refCallback}
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      onPointerEnter={onHover}
      onPointerLeave={onHoverEnd}
      onFocus={onHover}
      onBlur={onHoverEnd}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 26,
        width: "100%",
        border: 0,
        borderRadius: 6,
        background: active
          ? "#0064e1"
          : selected
            ? "color-mix(in srgb, currentColor 10%, transparent)"
            : "transparent",
        color: active ? "#ffffff" : "inherit",
        cursor: "pointer",
        font: "inherit",
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1,
        outline: "none",
        padding: "0 8px",
        textAlign: "left",
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>{formatZoomLabel(level)}</span>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          width: 14,
          height: 14,
          alignItems: "center",
          justifyContent: "center",
          opacity: selected ? 0.95 : 0,
        }}
      >
        <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2.1} />
      </span>
    </button>
  );
}

const handleMenuItemKeyDown = (
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  itemRefs: MutableRefObject<Array<HTMLButtonElement | null>>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  close: () => void,
) => {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    triggerRef.current?.focus();
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (index + offset + HTML_ZOOM_LEVELS.length) % HTML_ZOOM_LEVELS.length;
    itemRefs.current[nextIndex]?.focus();
    return;
  }

  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : HTML_ZOOM_LEVELS.length - 1;
    itemRefs.current[nextIndex]?.focus();
  }
};

const selectedZoomIndex = (zoom: number): number => {
  const index = HTML_ZOOM_LEVELS.findIndex((level) => Math.abs(level - zoom) < 1e-3);
  return index >= 0 ? index : HTML_ZOOM_LEVELS.indexOf(1);
};

const formatZoomLabel = (zoom: number): string =>
  `${String(Math.round(zoom * 100))}%`;

function downloadHtml(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

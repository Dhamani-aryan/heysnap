import type { CSSProperties } from "react";

interface PPTSidebarProps {
  id: string;
  open: boolean;
  background: string;
  width: number;

  /** Total slide count. Thumbnails render as skeletons until urls arrive. */
  slideCount: number;
  /** Sparse map: slide index (1-based) → image URL. */
  slideUrls: ReadonlyMap<number, string>;

  /** 1-based index of the slide currently in view. Drives the active ring. */
  activeIndex: number;
  /** Natural slide dimensions; used for thumbnail aspect. */
  slideWidth: number;
  slideHeight: number;

  /** Fired when a thumbnail is clicked — parent scrolls to that slide. */
  onSelect: (index: number) => void;

  style?: CSSProperties;
}

const TRANSITION =
  "margin-left 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease";

const THUMB_WIDTH = 156;
const THUMB_GAP = 16;

/**
 * Vertical thumbnail rail. Renders `slideCount` slots from the moment the
 * meta event lands; each slot shows a skeleton placeholder until its image
 * URL arrives via the streaming conversion. The aside is always mounted at
 * its full width — open/closed is animated via a negative `margin-left`,
 * which slides the rail out of view and lets the adjacent flex sibling (the
 * main scroll area) reflow in the same transition.
 */
export function PPTSidebar({
  id,
  open,
  background,
  width,
  slideCount,
  slideUrls,
  activeIndex,
  slideWidth,
  slideHeight,
  onSelect,
  style,
}: PPTSidebarProps) {
  // `inert` is a standard HTML attribute but @types/react 18 hasn't added
  // it to JSX yet — pass through with a cast so screen readers and tab
  // navigation skip the hidden rail.
  const inertAttr = open ? {} : ({ inert: true } as { inert: boolean });

  // Keep thumbnails at a constant width and let height follow the deck's
  // native aspect. Works for both 4:3 and 16:9 decks without hardcoding.
  const aspect = slideHeight > 0 ? slideHeight / slideWidth : 9 / 16;
  const thumbHeight = Math.round(THUMB_WIDTH * aspect);

  // Build the index array once. `Array.from({ length: n }, (_, i) => i + 1)`
  // gives a 1-based sequence the rest of the code reads more naturally.
  const indices = Array.from({ length: slideCount }, (_, i) => i + 1);

  return (
    <aside
      id={id}
      aria-label="Slides"
      aria-hidden={!open}
      {...inertAttr}
      style={{
        width,
        flexShrink: 0,
        marginLeft: open ? 0 : -width,
        opacity: open ? 1 : 0,
        transition: TRANSITION,
        background,
        boxShadow:
          "inset -1px 0 0 color-mix(in srgb, currentColor 10%, transparent)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "12px 12px 20px",
          display: "flex",
          flexDirection: "column",
          gap: THUMB_GAP,
        }}
      >
        {indices.map((index) => {
          const isActive = index === activeIndex;
          const url = slideUrls.get(index);
          return (
            <div
              key={index}
              style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
            >
              <span
                style={{
                  // Fixed-width number column so thumbnails line up regardless
                  // of slide count (1-digit vs 3-digit numbers).
                  flexShrink: 0,
                  width: 18,
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: `${thumbHeight}px`,
                  textAlign: "right",
                  opacity: isActive ? 1 : 0.6,
                  userSelect: "none",
                }}
              >
                {index}
              </span>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-label={`Go to slide ${index}`}
                aria-current={isActive ? "true" : undefined}
                disabled={!url}
                style={{
                  appearance: "none",
                  border: 0,
                  padding: 0,
                  margin: 0,
                  background: "#ffffff",
                  cursor: url ? "pointer" : "default",
                  borderRadius: 4,
                  width: THUMB_WIDTH,
                  height: thumbHeight,
                  flexShrink: 0,
                  boxShadow: isActive
                    ? "0 0 0 2px color-mix(in srgb, currentColor 60%, transparent)"
                    : "0 0 0 1px color-mix(in srgb, currentColor 12%, transparent)",
                  transition: "box-shadow 120ms ease",
                  overflow: "hidden",
                  display: "block",
                }}
              >
                {url ? (
                  <img
                    src={url}
                    alt={`Slide ${index}`}
                    loading="lazy"
                    draggable={false}
                    style={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      pointerEvents: "none",
                    }}
                  />
                ) : (
                  <ThumbnailSkeleton />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/**
 * Idle gray placeholder shown while a thumbnail hasn't rasterized yet.
 * Static — slides typically arrive within milliseconds of each other once
 * the worker pool warms up, so a spinner would barely flicker on screen
 * before being replaced.
 */
function ThumbnailSkeleton() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "color-mix(in srgb, currentColor 6%, transparent)",
      }}
    />
  );
}

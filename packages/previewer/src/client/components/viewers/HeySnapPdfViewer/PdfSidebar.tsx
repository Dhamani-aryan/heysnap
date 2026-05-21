import type { CSSProperties } from "react";
import { ThumbImg, ThumbnailsPane } from "@embedpdf/plugin-thumbnail/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";

interface ThumbMetaLike {
  pageIndex: number;
  width: number;
  height: number;
  wrapperHeight: number;
  top: number;
  labelHeight: number;
}

interface PdfSidebarProps {
  documentId: string;
  id: string;
  open: boolean;
  background: string;
  width: number;
  style?: CSSProperties;
}

const TRANSITION = "margin-left 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease";

/**
 * Vertical thumbnail rail. Backed by the EmbedPDF thumbnail plugin's
 * virtualized `<ThumbnailsPane>`, so it scales to large documents without
 * mounting every page upfront. Clicking a thumbnail scrolls the main
 * viewport to that page; the currently-visible page is highlighted with
 * an outline that inherits the toolbar's foreground color.
 *
 * The aside is always mounted at its full width — the open/closed state
 * is animated via a negative `margin-left`, which both slides the rail
 * out of view AND lets the adjacent flex sibling (the viewport) reflow in
 * the same transition.
 */
export function PdfSidebar({ documentId, id, open, background, width, style }: PdfSidebarProps) {
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const currentPageIndex = (scrollState?.currentPage ?? 1) - 1;

  // `inert` is a standard HTML attribute (supported by all current browsers)
  // but @types/react 18 hasn't added it yet — pass through with a cast.
  const inertAttr = open ? {} : ({ inert: true } as { inert: boolean });

  return (
    <aside
      id={id}
      aria-label="Document pages"
      aria-hidden={!open}
      {...inertAttr}
      style={{
        width,
        flexShrink: 0,
        marginLeft: open ? 0 : -width,
        opacity: open ? 1 : 0,
        transition: TRANSITION,
        background,
        // Hairline divider on the right that respects the configured
        // foreground (currentColor inherits the header's color downward).
        boxShadow: "inset -1px 0 0 color-mix(in srgb, currentColor 10%, transparent)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...style,
      }}
    >
      <ThumbnailsPane
        documentId={documentId}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          // Reserve enough side padding to keep the active outline visible.
          padding: "8px 12px",
        }}
      >
        {(m: ThumbMetaLike) => {
          const isActive = m.pageIndex === currentPageIndex;
          const imageHeight = m.wrapperHeight - m.labelHeight;

          return (
            <div
              key={m.pageIndex}
              style={{
                position: "absolute",
                top: m.top,
                left: 0,
                right: 0,
                height: m.wrapperHeight,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  scroll?.scrollToPage({ pageNumber: m.pageIndex + 1, behavior: "smooth" })
                }
                aria-label={`Go to page ${m.pageIndex + 1}`}
                aria-current={isActive ? "page" : undefined}
                style={{
                  appearance: "none",
                  border: 0,
                  padding: 0,
                  margin: 0,
                  background: "transparent",
                  cursor: "pointer",
                  borderRadius: 4,
                  width: m.width,
                  height: imageHeight,
                  // The outline is a box-shadow so it doesn't affect layout
                  // and can use color-mix against the inherited foreground.
                  boxShadow: isActive
                    ? "0 0 0 2px color-mix(in srgb, currentColor 60%, transparent)"
                    : "0 0 0 1px color-mix(in srgb, currentColor 12%, transparent)",
                  transition: "box-shadow 120ms ease",
                  overflow: "hidden",
                  display: "block",
                }}
              >
                <ThumbImg
                  documentId={documentId}
                  meta={m as never}
                  style={{ display: "block", width: m.width, height: imageHeight }}
                />
              </button>
              <span
                style={{
                  fontSize: 11,
                  lineHeight: `${m.labelHeight}px`,
                  height: m.labelHeight,
                  opacity: isActive ? 1 : 0.6,
                  fontVariantNumeric: "tabular-nums",
                  userSelect: "none",
                }}
              >
                {m.pageIndex + 1}
              </span>
            </div>
          );
        }}
      </ThumbnailsPane>
    </aside>
  );
}

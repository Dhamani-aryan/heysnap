import type { CSSProperties } from "react";
import { usePan } from "@embedpdf/plugin-pan/react";
import { RenderLayer } from "@embedpdf/plugin-render/react";

interface PdfPageBoxProps {
  documentId: string;
  pageIndex: number;
  width: number;
  height: number;
}

/**
 * Wraps a single rendered page so pan / scroll work everywhere inside it.
 *
 * EmbedPDF renders pages as images. Browsers have native HTML5 drag on
 * `<img>` elements — when you mousedown on a page in pan mode, the browser
 * starts ghost-dragging the image and the pan plugin never gets the
 * mousemove events. Two fixes:
 *
 *   1. `onDragStart` cancels the native drag at the bubbled-up level, so
 *      the cancellation works regardless of which descendant img the
 *      browser picked as the drag source.
 *   2. While pan mode is active we also suppress text selection — the
 *      text layer otherwise competes for the same mousedown and the user
 *      ends up selecting page text instead of dragging.
 *
 * Outside of pan mode we leave selection enabled so users can still
 * highlight and copy text from the document normally.
 */
export function PdfPageBox({ documentId, pageIndex, width, height }: PdfPageBoxProps) {
  const { isPanning } = usePan(documentId);

  const style: CSSProperties = {
    width,
    height,
    cursor: isPanning ? "grab" : "auto",
    userSelect: isPanning ? "none" : "auto",
    WebkitUserSelect: isPanning ? "none" : "auto",
    // Suppress the iOS long-press save/share menu when pan-dragging.
    WebkitTouchCallout: "none",
  };

  return (
    <div style={style} onDragStart={(e) => e.preventDefault()}>
      <RenderLayer documentId={documentId} pageIndex={pageIndex} />
    </div>
  );
}

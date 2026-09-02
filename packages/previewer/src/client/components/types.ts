import type { CSSProperties } from "react";

/**
 * Base props shared by every HeySnap viewer.
 * Individual viewers may extend this with format-specific options.
 */
export interface BaseViewerProps {
  /** URL, path, or identifier of the document to render. */
  src: string;
  /** Extra class names appended to the viewer's root element. */
  className?: string;
  /** Inline styles applied to the viewer's root element. */
  style?: CSSProperties;
  /** Called after the viewer has rendered enough to be shown. */
  onReady?: () => void;
  /** Called when the viewer fails to resolve or render its source. */
  onError?: (error: Error) => void;
}

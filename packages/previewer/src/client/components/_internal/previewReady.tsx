import { useEffect } from "react";

export function ReadyAfterPaint({
  onReady,
  readyKey,
}: {
  readonly onReady?: () => void;
  readonly readyKey?: unknown;
}): null {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => onReady?.());
    return () => window.cancelAnimationFrame(frame);
  }, [onReady, readyKey]);

  return null;
}

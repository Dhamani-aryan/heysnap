import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

export const DesktopSplitPane = ({
  children,
  leftOverlay,
  leftPaneRatio,
  isRightWorkAreaOpen,
  isRightAgentAreaOpen,
  onLeftPaneRatioChange,
  rightPanel,
  rightPanelLabel,
}: {
  readonly children: ReactNode;
  readonly leftOverlay?: ReactNode;
  readonly leftPaneRatio: number;
  readonly isRightWorkAreaOpen: boolean;
  readonly isRightAgentAreaOpen: boolean;
  readonly onLeftPaneRatioChange: (ratio: number) => void;
  readonly rightPanel: ReactNode;
  readonly rightPanelLabel: string;
}): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent): void => {
      const container = containerRef.current;

      if (container === null) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const styles = window.getComputedStyle(container);
      const paddingRight = Number.parseFloat(styles.paddingRight);
      const resizableWidth = rect.width - (Number.isFinite(paddingRight) ? paddingRight : 0);
      const nextRatio = (event.clientX - rect.left) / resizableWidth;
      onLeftPaneRatioChange(nextRatio);
    };

    const handleMouseUp = (): void => {
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing, onLeftPaneRatioChange]);

  return (
    <div className="split-pane">
      <div
        ref={containerRef}
        className="split-main"
        data-resizing={isResizing ? "true" : undefined}
        data-right-work-area-open={isRightWorkAreaOpen ? "true" : "false"}
        data-right-agent-area-open={isRightAgentAreaOpen ? "true" : "false"}
      >
        <section className="split-left" style={{ flexBasis: `${leftPaneRatio * 100}%` }}>
          {children}
          {leftOverlay}
        </section>

        <div
          role="separator"
          aria-label="Resize desktop panels"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(leftPaneRatio * 100)}
          onMouseDown={(event) => {
            event.preventDefault();
            if (!isRightWorkAreaOpen) {
              return;
            }
            setIsResizing(true);
          }}
          className="split-resizer"
        >
          <div className="split-resizer-line" />
          <div className="split-resizer-handle" />
        </div>

        <aside
          className="split-preview"
          aria-hidden={!isRightWorkAreaOpen}
          aria-label={rightPanelLabel}
        >
          {rightPanel}
        </aside>
      </div>
    </div>
  );
};

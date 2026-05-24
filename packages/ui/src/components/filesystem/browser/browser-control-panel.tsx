import {
  Add01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Cancel01Icon,
  InternetIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactElement } from "react";

import type { BrowserControlStatus } from "../../../cloud/browser-control-bridge";
import {
  DEFAULT_BROWSER_WINDOW_URL,
  getBrowserViewportInputPoint,
  getBrowserViewportInputRatio,
  isBrowserNewTabUrl,
  readBrowserFrameAspectRatio,
  toBrowserViewportKeyboardInput,
} from "./browser-viewport";
import type {
  BrowserScreencastState,
  BrowserViewportClickInput,
  BrowserViewportKeyboardInput,
  BrowserViewportWheelInput,
  BrowserWindowTab,
} from "./browser-types";
import { isEditableKeyboardTarget } from "../finder/finder-body";

const BROWSER_TOP_PADDING = 8;
const BROWSER_TAB_BAR_HEIGHT = 36;
const BROWSER_TOOL_BAR_HEIGHT = 40;
const BROWSER_BOTTOM_PADDING = 8;
const DEFAULT_BROWSER_STREAM_ASPECT_RATIO = 16 / 10;

export const formatBrowserControlTitle = (status: BrowserControlStatus | undefined): string => {
  if (status === undefined) {
    return "Browser control unavailable";
  }

  return status.detail === undefined
    ? `Browser control: ${status.label}`
    : `Browser control: ${status.label} - ${status.detail}`;
};

const getBrowserControlStatusText = (status: BrowserControlStatus | undefined): string =>
  status === undefined ? "Unavailable" : status.label;

const getBrowserControlDetailText = (status: BrowserControlStatus | undefined): string => {
  if (status === undefined) {
    return "Browser control is not configured for this workspace.";
  }

  return status.detail ?? "Ready to report browser-control activity.";
};

const getBrowserWindowStatusText = (input: {
  readonly error: string | null;
  readonly isOpening: boolean;
  readonly windowId: number | null;
}): string => {
  if (input.error !== null) {
    return input.error;
  }

  if (input.isOpening) {
    return "Creating Chrome window.";
  }

  if (input.windowId !== null) {
    return `Chrome window ${input.windowId}`;
  }

  return "No Chrome window is attached.";
};

export const BrowserControlPanel = ({
  canGoBack,
  canGoForward,
  error,
  isOpening,
  onBack,
  onCloseTab,
  onForward,
  onGoTo,
  onNewTab,
  onRefresh,
  onSelectTab,
  onViewportClick,
  onViewportKey,
  onViewportWheel,
  screencastAspectRatio,
  screencastFrameUrl,
  screencastState,
  screencastTabId,
  status,
  tabs,
  windowId,
}: {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly error: string | null;
  readonly isOpening: boolean;
  readonly onBack?: () => Promise<void> | void;
  readonly onCloseTab?: (tabId: number) => Promise<void> | void;
  readonly onForward?: () => Promise<void> | void;
  readonly onGoTo?: (url: string) => Promise<void> | void;
  readonly onNewTab?: () => Promise<void> | void;
  readonly onRefresh?: () => Promise<void> | void;
  readonly onSelectTab?: (tabId: number) => Promise<void> | void;
  readonly onViewportClick?: (input: BrowserViewportClickInput) => Promise<void> | void;
  readonly onViewportKey?: (input: BrowserViewportKeyboardInput) => Promise<void> | void;
  readonly onViewportWheel?: (input: BrowserViewportWheelInput) => Promise<void> | void;
  readonly screencastAspectRatio: number | null;
  readonly screencastFrameUrl: string | null;
  readonly screencastState: BrowserScreencastState;
  readonly screencastTabId: number | null;
  readonly status?: BrowserControlStatus;
  readonly tabs: BrowserWindowTab[];
  readonly windowId: number | null;
}): ReactElement => {
  const panelRef = useRef<HTMLElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<BrowserViewportWheelInput | null>(null);
  const [addressValue, setAddressValue] = useState("");
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [isViewportKeyboardActive, setIsViewportKeyboardActive] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  const [frameAspectRatio, setFrameAspectRatio] = useState(DEFAULT_BROWSER_STREAM_ASPECT_RATIO);
  const screenAspectRatio = readBrowserFrameAspectRatio(screencastAspectRatio) ?? frameAspectRatio;
  const availableScreenHeight = Math.max(
    0,
    panelSize.height - BROWSER_TOP_PADDING - BROWSER_TAB_BAR_HEIGHT - BROWSER_TOOL_BAR_HEIGHT - BROWSER_BOTTOM_PADDING,
  );
  const screenWidthFromHeight = availableScreenHeight * screenAspectRatio;
  const screenWidth = Math.max(0, Math.min(panelSize.width, screenWidthFromHeight));
  const screenHeight = screenWidth > 0 ? screenWidth / screenAspectRatio : 0;
  const windowHeight = BROWSER_TOP_PADDING + BROWSER_TAB_BAR_HEIGHT + BROWSER_TOOL_BAR_HEIGHT + screenHeight
    + BROWSER_BOTTOM_PADDING;
  const statusText = [
    getBrowserWindowStatusText({ error, isOpening, windowId }),
    getBrowserControlStatusText(status),
    getBrowserControlDetailText(status),
  ].join(" ");
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
  const activeTabIsNewTab = activeTab !== null && isBrowserNewTabUrl(activeTab.url);
  const activeFrameUrl = activeTab !== null && activeTab.id === screencastTabId ? screencastFrameUrl : null;
  const canSendViewportInput = activeTab !== null
    && activeFrameUrl !== null
    && !activeTabIsNewTab
    && screencastState === "streaming";
  const visibleTabs = tabs.length > 0
    ? tabs
    : windowId === null
      ? []
      : [{
          id: windowId,
          index: 0,
          active: true,
          title: `Window ${windowId}`,
          url: DEFAULT_BROWSER_WINDOW_URL,
        }];

  useEffect(() => {
    const panel = panelRef.current;

    if (panel === null) {
      return;
    }

    const updateSize = (): void => {
      const rect = panel.getBoundingClientRect();
      setPanelSize({
        width: rect.width,
        height: rect.height,
      });
    };
    const observer = new ResizeObserver(updateSize);

    updateSize();
    observer.observe(panel);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activeTabIsNewTab) {
      setAddressValue("");
      return;
    }

    if (!isAddressFocused) {
      setAddressValue(activeTab?.url ?? "");
    }
  }, [activeTab?.url, activeTabIsNewTab, isAddressFocused]);

  useEffect(() => {
    if (!activeTabIsNewTab || activeTab === null) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTab?.id, activeTabIsNewTab]);

  const flushPendingScroll = useCallback((): void => {
    scrollFrameRef.current = null;

    const scroll = pendingScrollRef.current;
    pendingScrollRef.current = null;

    if (scroll === null || onViewportWheel === undefined) {
      return;
    }

    void Promise.resolve(onViewportWheel(scroll)).catch(() => undefined);
  }, [onViewportWheel]);

  const handleScreenWheel = useCallback((event: globalThis.WheelEvent): void => {
    const screen = screenRef.current;

    if (!canSendViewportInput || screen === null || activeTab === null || onViewportWheel === undefined) {
      return;
    }

    const ratio = getBrowserViewportInputRatio(screen, event.clientX, event.clientY);
    const fallbackPoint = getBrowserViewportInputPoint(screen, event.clientX, event.clientY);

    if (ratio === null || fallbackPoint === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const pending = pendingScrollRef.current;

    pendingScrollRef.current = {
      tabId: activeTab.id,
      fallbackPoint,
      ratio,
      deltaX: (pending?.deltaX ?? 0) + event.deltaX,
      deltaY: (pending?.deltaY ?? 0) + event.deltaY,
    };

    if (scrollFrameRef.current === null) {
      scrollFrameRef.current = window.requestAnimationFrame(flushPendingScroll);
    }
  }, [activeTab, canSendViewportInput, flushPendingScroll, onViewportWheel]);

  const handleScreenClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    const screen = screenRef.current;

    if (!canSendViewportInput || screen === null || activeTab === null || onViewportClick === undefined) {
      return;
    }

    const ratio = getBrowserViewportInputRatio(screen, event.clientX, event.clientY);
    const fallbackPoint = getBrowserViewportInputPoint(screen, event.clientX, event.clientY);

    if (ratio === null || fallbackPoint === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    void Promise.resolve(onViewportClick({
      fallbackPoint,
      ratio,
      tabId: activeTab.id,
    })).catch(() => undefined);
  }, [activeTab, canSendViewportInput, onViewportClick]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const screen = screenRef.current;

      setIsViewportKeyboardActive(
        screen !== null && event.target instanceof Node && screen.contains(event.target) && canSendViewportInput,
      );
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [canSendViewportInput]);

  useEffect(() => {
    if (!isViewportKeyboardActive || !canSendViewportInput || activeTab === null || onViewportKey === undefined) {
      return;
    }

    const handleKeyEvent = (event: KeyboardEvent): void => {
      if (isEditableKeyboardTarget(event.target) || event.isComposing) {
        return;
      }

      const input = toBrowserViewportKeyboardInput(activeTab.id, event);

      if (input === null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void Promise.resolve(onViewportKey(input)).catch(() => undefined);
    };

    window.addEventListener("keydown", handleKeyEvent, true);
    window.addEventListener("keyup", handleKeyEvent, true);

    return () => {
      window.removeEventListener("keydown", handleKeyEvent, true);
      window.removeEventListener("keyup", handleKeyEvent, true);
    };
  }, [activeTab, canSendViewportInput, isViewportKeyboardActive, onViewportKey]);

  useEffect(() => {
    const screen = screenRef.current;

    if (screen === null) {
      return;
    }

    screen.addEventListener("wheel", handleScreenWheel, { passive: false });

    return () => {
      screen.removeEventListener("wheel", handleScreenWheel);
    };
  }, [handleScreenWheel]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  return (
    <section
      ref={panelRef}
      className="browser-control-panel"
      aria-label={`Browser. ${statusText}`}
      style={{
        "--browser-tab-bar-height": `${BROWSER_TAB_BAR_HEIGHT}px`,
        "--browser-tool-bar-height": `${BROWSER_TOOL_BAR_HEIGHT}px`,
        "--browser-top-padding": `${BROWSER_TOP_PADDING}px`,
        "--browser-bottom-padding": `${BROWSER_BOTTOM_PADDING}px`,
        "--browser-screen-width": `${screenWidth}px`,
        "--browser-screen-height": `${screenHeight}px`,
        "--browser-window-height": `${windowHeight}px`,
      } as CSSProperties}
    >
      <div className="browser-window-layout">
        <div className="browser-window-tabbar" role="tablist" aria-label="Browser tabs">
          {visibleTabs.map((tab) => (
            <div
              key={tab.id}
              className={activeTab?.id === tab.id ? "browser-window-tab active" : "browser-window-tab"}
              role="tab"
              aria-selected={activeTab?.id === tab.id}
              tabIndex={activeTab?.id === tab.id ? 0 : -1}
              title={tab.title ?? tab.url ?? `Tab ${tab.id}`}
              onClick={() => {
                void Promise.resolve(onSelectTab?.(tab.id)).catch(() => undefined);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }

                event.preventDefault();
                void Promise.resolve(onSelectTab?.(tab.id)).catch(() => undefined);
              }}
            >
              <span className="browser-window-tab-favicon" aria-hidden="true">
                {tab.favIconUrl === undefined || tab.favIconUrl.length === 0 ? (
                  <HugeiconsIcon icon={InternetIcon} size={13} color="currentColor" strokeWidth={1.8} />
                ) : (
                  <img src={tab.favIconUrl} alt="" />
                )}
              </span>
              <span className="browser-window-tab-title">{tab.title ?? tab.url ?? "New tab"}</span>
              <button
                className="browser-window-tab-close"
                type="button"
                aria-label={`Close ${tab.title ?? tab.url ?? "tab"}`}
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  void Promise.resolve(onCloseTab?.(tab.id)).catch(() => undefined);
                }}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={13} color="currentColor" strokeWidth={2} />
              </button>
            </div>
          ))}
          <button
            className="browser-window-new-tab"
            type="button"
            aria-label="New tab"
            title="New tab"
            onClick={() => {
              void Promise.resolve(onNewTab?.()).catch(() => undefined);
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} color="currentColor" strokeWidth={1.9} />
          </button>
        </div>
        <div className="browser-window-toolbar" aria-label="Browser toolbar">
          <div className="browser-window-toolbar-nav" aria-label="Browser navigation">
            <button
              className="browser-window-toolbar-button"
              type="button"
              aria-label="Back"
              title="Back"
              disabled={!canGoBack}
              onClick={() => {
                void Promise.resolve(onBack?.()).catch(() => undefined);
              }}
            >
              <HugeiconsIcon icon={ArrowLeft02Icon} size={16} color="currentColor" strokeWidth={2} />
            </button>
            <button
              className="browser-window-toolbar-button"
              type="button"
              aria-label="Forward"
              title="Forward"
              disabled={!canGoForward}
              onClick={() => {
                void Promise.resolve(onForward?.()).catch(() => undefined);
              }}
            >
              <HugeiconsIcon icon={ArrowRight02Icon} size={16} color="currentColor" strokeWidth={2} />
            </button>
            <button
              className="browser-window-toolbar-button"
              type="button"
              aria-label="Refresh"
              title="Refresh"
              disabled={activeTab === null}
              onClick={() => {
                void Promise.resolve(onRefresh?.()).catch(() => undefined);
              }}
            >
              <HugeiconsIcon icon={Refresh01Icon} size={15} color="currentColor" strokeWidth={2} />
            </button>
          </div>
          <form
            className="browser-window-address-form"
            onSubmit={(event) => {
              event.preventDefault();
              const nextUrl = addressValue.trim();

              if (nextUrl.length === 0 || activeTab === null) {
                return;
              }

              void Promise.resolve(onGoTo?.(nextUrl)).catch(() => undefined);
            }}
          >
            <input
              ref={addressInputRef}
              className="browser-window-address"
              type="text"
              value={addressValue}
              aria-label="Address"
              title={activeTab?.url ?? ""}
              disabled={activeTab === null}
              spellCheck={false}
              onBlur={() => {
                setIsAddressFocused(false);
              }}
              onChange={(event) => {
                setAddressValue(event.currentTarget.value);
              }}
              onFocus={(event) => {
                setIsAddressFocused(true);
                event.currentTarget.select();
              }}
            />
          </form>
        </div>
        <div className="browser-window-stage">
          <div
            ref={screenRef}
            className={activeFrameUrl !== null ? "browser-window-screen has-frame" : "browser-window-screen"}
            data-stream-state={screencastState}
            aria-label="Browser screen"
            onClick={handleScreenClick}
          >
            {activeFrameUrl !== null && !activeTabIsNewTab ? (
              <img
                src={activeFrameUrl}
                alt=""
                onLoad={(event) => {
                  const aspectRatio = readBrowserFrameAspectRatio(
                    event.currentTarget.naturalWidth / event.currentTarget.naturalHeight,
                  );

                  if (aspectRatio !== null) {
                    setFrameAspectRatio(aspectRatio);
                  }
                }}
              />
            ) : null}
            {activeTabIsNewTab ? (
              <div className="browser-window-new-tab-placeholder">
                <span className="browser-window-new-tab-title">New tab</span>
                <span className="browser-window-new-tab-subtitle">enter url to continue</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};

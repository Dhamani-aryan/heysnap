import type {
  BrowserViewportInputPoint,
  BrowserViewportKeyboardInput,
} from "./browser-types";

export const DEFAULT_BROWSER_WINDOW_URL = "chrome://newtab";

export const isBrowserNewTabUrl = (url: string | undefined): boolean => {
  if (url === undefined || url.length === 0) {
    return true;
  }

  return url === "about:blank" || url === "chrome://newtab" || url === "chrome://newtab/";
};

export const toBrowserViewportKeyboardInput = (
  tabId: number,
  event: KeyboardEvent,
): BrowserViewportKeyboardInput | null => {
  if (event.type !== "keydown" && event.type !== "keyup") {
    return null;
  }

  return {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    key: event.key,
    keyCode: event.keyCode,
    location: event.location,
    metaKey: event.metaKey,
    repeat: event.repeat,
    shiftKey: event.shiftKey,
    tabId,
    text: getBrowserKeyboardText(event),
    type: event.type === "keydown" ? "keyDown" : "keyUp",
  };
};

const getBrowserKeyboardText = (event: KeyboardEvent): string | undefined => {
  if (event.type !== "keydown" || event.ctrlKey || event.metaKey || event.altKey) {
    return undefined;
  }

  if (event.key.length === 1) {
    return event.key;
  }

  return event.key === "Enter" ? "\r" : undefined;
};

export const getBrowserViewportInputPoint = (
  viewport: HTMLDivElement,
  clientX: number,
  clientY: number,
): BrowserViewportInputPoint | null => {
  const image = viewport.querySelector("img");
  const rect = getBrowserViewportInputRect(viewport);

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const naturalWidth = image?.naturalWidth || rect.width;
  const naturalHeight = image?.naturalHeight || rect.height;

  return {
    x: clampNumber(((clientX - rect.left) / rect.width) * naturalWidth, 0, naturalWidth),
    y: clampNumber(((clientY - rect.top) / rect.height) * naturalHeight, 0, naturalHeight),
  };
};

export const getBrowserViewportInputRatio = (
  viewport: HTMLDivElement,
  clientX: number,
  clientY: number,
): BrowserViewportInputPoint | null => {
  const rect = getBrowserViewportInputRect(viewport);

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    x: clampNumber((clientX - rect.left) / rect.width, 0, 1),
    y: clampNumber((clientY - rect.top) / rect.height, 0, 1),
  };
};

const getBrowserViewportInputRect = (viewport: HTMLDivElement): DOMRectReadOnly => {
  const image = viewport.querySelector("img");

  if (image === null || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return viewport.getBoundingClientRect();
  }

  const rect = image.getBoundingClientRect();
  const objectFit = window.getComputedStyle(image).objectFit;

  if (objectFit !== "contain" && objectFit !== "cover" && objectFit !== "scale-down") {
    return rect;
  }

  const naturalAspectRatio = image.naturalWidth / image.naturalHeight;
  const renderedAspectRatio = rect.width / rect.height;
  const shouldFitWidth = objectFit === "cover"
    ? renderedAspectRatio > naturalAspectRatio
    : renderedAspectRatio < naturalAspectRatio;
  const width = shouldFitWidth ? rect.width : rect.height * naturalAspectRatio;
  const height = shouldFitWidth ? rect.width / naturalAspectRatio : rect.height;

  return new DOMRectReadOnly(
    rect.left + ((rect.width - width) / 2),
    rect.top + ((rect.height - height) / 2),
    width,
    height,
  );
};

export const readBrowserFrameAspectRatio = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0.1 && value < 10 ? value : null;

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

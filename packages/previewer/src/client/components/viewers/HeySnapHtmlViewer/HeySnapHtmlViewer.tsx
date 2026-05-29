import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { PreviewHtmlChange } from "../../../../protocol";
import type { BaseViewerProps } from "../../types";
import { installFilesystemVoiceHotkeyRelay } from "../../../voiceHotkeyRelay";
import {
  HtmlDownloadButton,
  HtmlHeaderGroup,
  HtmlHeaderShell,
  HtmlReloadButton,
  HtmlZoomPicker,
  type HtmlViewMode,
} from "./HtmlViewerHeader";

export type { HtmlViewMode } from "./HtmlViewerHeader";

export interface HeySnapHtmlViewerProps extends Omit<BaseViewerProps, "src"> {
  /** URL served by the preview server for the watched HTML file. */
  src: string;
  /** Metadata about the HTML-root file change that produced this source version. */
  change?: PreviewHtmlChange;
  /** @deprecated HTML previews now render preview-only; retained as a no-op compatibility prop. */
  defaultMode?: HtmlViewMode;
  /** @deprecated HTML previews now render preview-only; retained as a no-op compatibility prop. */
  mode?: HtmlViewMode;
  /** @deprecated HTML previews now render preview-only; retained as a no-op compatibility prop. */
  onModeChange?: (next: HtmlViewMode) => void;
  /** Render the toolbar. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#ffffff" */
  headerBackground?: string;
  /** Toolbar foreground. @default "#15171c" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** Show the download button on the right. @default true */
  showDownloadButton?: boolean;
  /** Background painted around the iframe/source. @default "#ffffff" */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the body wrapper. */
  bodyStyle?: CSSProperties;
  /** Override the filename shown in the toolbar and used for download. */
  documentName?: string;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--html", extra].filter(Boolean).join(" ");

const baseStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  width: "100%",
  height: "100%",
};

const DEFAULTS = {
  headerBackground: "#ffffff",
  headerForeground: "#15171c",
  bodyBackground: "#ffffff",
  zoom: 1,
} as const;

const PREVIEW_RELOAD_PARAM = "heysnap-preview-reload";

export function HeySnapHtmlViewer({
  src,
  change,
  className,
  style,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,

  showDownloadButton = true,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,

  documentName,
  onReady,
  onError,
}: HeySnapHtmlViewerProps) {
  const [previewError, setPreviewError] = useState<Error | null>(null);
  const [iframeSrc, setIframeSrc] = useState(src);
  const [zoom, setZoom] = useState<number>(() => DEFAULTS.zoom);
  const [toolbarDismissVersion, setToolbarDismissVersion] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeSrcRef = useRef(src);
  const baseDocumentRef = useRef<Document | null>(null);
  const baseCaptureVersionRef = useRef(0);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const nestedHotkeyCleanupRef = useRef<(() => void) | null>(null);
  const iframeDismissCleanupRef = useRef<(() => void) | null>(null);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    const reloadSrc = buildReloadSrcPreservingPreviewLocation(
      src,
      iframeSrcRef.current,
      iframeRef.current,
    );

    setPreviewError(null);

    const reloadIframe = () => {
      baseDocumentRef.current = null;
      baseCaptureVersionRef.current += 1;
      iframeSrcRef.current = reloadSrc;
      setIframeSrc(reloadSrc);
    };

    if (change?.type === "initial") {
      reloadIframe();
      return () => {
        cancelled = true;
      };
    }

    void morphIframeDocument({
      iframe: iframeRef.current,
      nextSrc: reloadSrc,
      change,
      baseDocument: baseDocumentRef.current,
    }).then((didMorph) => {
      if (cancelled) {
        return;
      }

      if (didMorph === null) {
        reloadIframe();
        return;
      }

      baseCaptureVersionRef.current += 1;
      baseDocumentRef.current = didMorph.baseDocument;
      iframeSrcRef.current = reloadSrc;
      window.requestAnimationFrame(() => onReadyRef.current?.());
    }).catch(() => {
      if (!cancelled) {
        reloadIframe();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [src, change]);

  useEffect(() => () => {
    nestedHotkeyCleanupRef.current?.();
    nestedHotkeyCleanupRef.current = null;
    iframeDismissCleanupRef.current?.();
    iframeDismissCleanupRef.current = null;
  }, []);

  const title = documentName || "document.html";
  const state: "loading" | "error" | "ready" = previewError ? "error" : "ready";

  const reloadPreview = () => {
    const nextSrc = buildManualReloadSrc(iframeRef.current, iframeSrcRef.current);

    setPreviewError(null);
    baseDocumentRef.current = null;
    baseCaptureVersionRef.current += 1;
    iframeSrcRef.current = nextSrc;
    setIframeSrc(nextSrc);
  };

  const renderShell = (body: ReactNode) => (
    <div
      className={rootClass(className)}
      data-format="html"
      data-mode="preview"
      data-src={src}
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <HtmlHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          <HtmlHeaderGroup align="left">
            <HtmlReloadButton onReload={reloadPreview} />
          </HtmlHeaderGroup>
          <HtmlHeaderGroup align="right">
            <HtmlZoomPicker
              zoom={zoom}
              onZoom={setZoom}
              background={headerBackground}
              foreground={headerForeground}
              dismissVersion={toolbarDismissVersion}
              disabled={state !== "ready"}
            />
            {showDownloadButton && <HtmlDownloadButton name={title} url={src} />}
          </HtmlHeaderGroup>
        </HtmlHeaderShell>
      )}
      {body}
    </div>
  );

  if (previewError) {
    return renderShell(
      <p style={{ padding: 16, color: "#b00020" }}>
        Failed to load HTML preview: {previewError.message}
      </p>,
    );
  }

  return renderShell(
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: bodyBackground,
        overflow: "hidden",
        position: "relative",
        ...bodyStyle,
      }}
    >
      <iframe
        ref={iframeRef}
        title={title || "HTML preview"}
        src={iframeSrc}
        onLoad={(event) => {
          const iframe = event.currentTarget;
          const frameWindow = iframe.contentWindow;
          const baseUrl = currentPreviewUrl(iframe, iframe.src)?.toString() ?? iframe.src;
          const captureVersion = baseCaptureVersionRef.current + 1;

          baseCaptureVersionRef.current = captureVersion;
          iframeSrcRef.current = iframe.src;
          nestedHotkeyCleanupRef.current?.();
          nestedHotkeyCleanupRef.current = frameWindow === null
            ? null
            : installFilesystemVoiceHotkeyRelay(frameWindow);
          iframeDismissCleanupRef.current?.();
          iframeDismissCleanupRef.current = installIframeToolbarDismissRelay(
            iframe,
            () => setToolbarDismissVersion((version) => version + 1),
          );
          if (frameWindow !== null) {
            void captureBaseDocument(baseUrl, frameWindow).then((baseDocument) => {
              if (baseCaptureVersionRef.current === captureVersion) {
                baseDocumentRef.current = baseDocument;
              }
            }).catch(() => {
              if (baseCaptureVersionRef.current === captureVersion) {
                baseDocumentRef.current = null;
              }
            });
          }
          window.requestAnimationFrame(() => onReadyRef.current?.());
        }}
        onError={() => {
          const error = new Error(`Failed to load HTML preview: ${title}`);
          setPreviewError(error);
          onErrorRef.current?.(error);
        }}
        style={{
          display: "block",
          width: `${String(100 / zoom)}%`,
          height: `${String(100 / zoom)}%`,
          border: 0,
          background: "transparent",
          transform: `scale(${String(zoom)})`,
          transformOrigin: "0 0",
        }}
      />
    </div>,
  );
}

type IframeStateSnapshot = {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly activeElement: ElementSnapshot | null;
  readonly dirtyControls: readonly ControlSnapshot[];
};

type ElementSnapshot = {
  readonly selector: string;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly selectionDirection: "forward" | "backward" | "none" | null;
};

type ControlSnapshot =
  | { readonly selector: string; readonly kind: "checked"; readonly checked: boolean }
  | { readonly selector: string; readonly kind: "value"; readonly value: string }
  | { readonly selector: string; readonly kind: "select"; readonly values: readonly string[] };

type MorphResult = {
  readonly baseDocument: Document;
};

const PREVIEW_CACHE_BUSTER_PARAM = "heysnap-preview-v";

const installIframeToolbarDismissRelay = (
  iframe: HTMLIFrameElement,
  onDismiss: () => void,
): (() => void) | null => {
  try {
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;

    if (frameDocument === null) {
      return null;
    }

    frameDocument.addEventListener("pointerdown", onDismiss, true);
    frameDocument.addEventListener("mousedown", onDismiss, true);
    frameDocument.addEventListener("focusin", onDismiss, true);
    frameWindow?.addEventListener("blur", onDismiss);

    return () => {
      frameDocument.removeEventListener("pointerdown", onDismiss, true);
      frameDocument.removeEventListener("mousedown", onDismiss, true);
      frameDocument.removeEventListener("focusin", onDismiss, true);
      frameWindow?.removeEventListener("blur", onDismiss);
    };
  } catch {
    return null;
  }
};

const captureBaseDocument = async (
  url: string,
  frameWindow: Window,
): Promise<Document> => {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to fetch HTML base (${String(response.status)}).`);
  }

  return parseHtmlDocument(frameWindow, await response.text());
};

const parseHtmlDocument = (frameWindow: Window, html: string): Document =>
  new (frameWindow as Window & typeof globalThis).DOMParser()
    .parseFromString(html, "text/html");

const morphIframeDocument = async ({
  iframe,
  nextSrc,
  change,
  baseDocument,
}: {
  readonly iframe: HTMLIFrameElement | null;
  readonly nextSrc: string;
  readonly change: PreviewHtmlChange | undefined;
  readonly baseDocument: Document | null;
}): Promise<MorphResult | null> => {
  if (iframe === null) {
    return null;
  }

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument;

  if (
    frameWindow === null ||
    frameDocument === null ||
    frameDocument.documentElement === null
  ) {
    return null;
  }

  const nextUrl = new URL(nextSrc, window.location.href);
  const currentUrl = currentPreviewUrl(iframe, nextSrc);
  const previewRoot = htmlPreviewRoot(nextUrl);

  if (
    currentUrl === null ||
    previewRoot === null ||
    currentUrl.origin !== nextUrl.origin ||
    !currentUrl.pathname.startsWith(previewRoot)
  ) {
    return null;
  }

  if (isScriptChange(change)) {
    return null;
  }

  if (baseDocument === null) {
    return null;
  }

  const response = await fetch(nextSrc, { cache: "no-store" });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const nextDocument = parseHtmlDocument(frameWindow, html);
  const nextBaseDocument = parseHtmlDocument(frameWindow, html);

  if (!sameScriptSignatures(
    scriptSignatures(frameDocument, currentUrl),
    scriptSignatures(nextDocument, nextUrl),
  )) {
    return null;
  }

  const version = nextUrl.searchParams.get("v") ?? String(Date.now());
  applyChangedAssetCacheBuster(nextDocument, nextUrl, previewRoot, change, version);

  const snapshot = snapshotIframeState(frameWindow, frameDocument);

  morphDocument(frameDocument, nextDocument, baseDocument);

  restoreIframeState(frameWindow, frameDocument, snapshot);
  try {
    frameWindow.history.replaceState(frameWindow.history.state, "", nextSrc);
  } catch {
    // URL bookkeeping is best effort; a successful DOM morph should not turn into a reload.
  }

  return { baseDocument: nextBaseDocument };
};

const isScriptChange = (change: PreviewHtmlChange | undefined): boolean =>
  change !== undefined && change.type !== "initial" && isJavaScriptPath(change.path);

const morphDocument = (
  currentDocument: Document,
  nextDocument: Document,
  baseDocument: Document,
): void => {
  morphElement(
    currentDocument.documentElement,
    nextDocument.documentElement,
    baseDocument.documentElement,
  );
};

const morphNode = (currentNode: Node, nextNode: Node, baseNode: Node | null): void => {
  if (currentNode.nodeType !== nextNode.nodeType) {
    replaceNode(currentNode, nextNode);
    return;
  }

  if (currentNode.nodeType === Node.TEXT_NODE || currentNode.nodeType === Node.COMMENT_NODE) {
    const baseValue = baseNode?.nodeValue ?? null;
    const nextValue = nextNode.nodeValue;

    if (baseNode === null || nextValue !== baseValue) {
      currentNode.nodeValue = nextNode.nodeValue;
    }
    return;
  }

  if (isElementNode(currentNode) && isElementNode(nextNode)) {
    if (currentNode.tagName !== nextNode.tagName) {
      replaceNode(currentNode, nextNode);
      return;
    }

    morphElement(
      currentNode,
      nextNode,
      isElementNode(baseNode) && baseNode.tagName === nextNode.tagName ? baseNode : null,
    );
    return;
  }

  replaceNode(currentNode, nextNode);
};

const morphElement = (
  currentElement: Element,
  nextElement: Element,
  baseElement: Element | null,
): void => {
  if (currentElement.tagName === "SCRIPT") {
    return;
  }

  syncAttributes(currentElement, nextElement, baseElement);

  if (currentElement.tagName === "TEXTAREA") {
    syncTextareaElement(currentElement, nextElement, baseElement);
    return;
  }

  morphChildren(currentElement, nextElement, baseElement);
};

const syncAttributes = (
  currentElement: Element,
  nextElement: Element,
  baseElement: Element | null,
): void => {
  if (baseElement === null) {
    syncAttributesToNext(currentElement, nextElement);
    return;
  }

  const attributeNames = new Set<string>();

  for (const attribute of Array.from(currentElement.attributes)) {
    attributeNames.add(attribute.name);
  }

  for (const attribute of Array.from(nextElement.attributes)) {
    attributeNames.add(attribute.name);
  }

  for (const attribute of Array.from(baseElement.attributes)) {
    attributeNames.add(attribute.name);
  }

  for (const attributeName of attributeNames) {
    const baseValue = baseElement.getAttribute(attributeName);
    const nextValue = nextElement.getAttribute(attributeName);

    if (nextValue !== baseValue) {
      setOrRemoveAttribute(currentElement, attributeName, nextValue);
    }
  }
};

const syncAttributesToNext = (currentElement: Element, nextElement: Element): void => {
  for (const attribute of Array.from(currentElement.attributes)) {
    if (!nextElement.hasAttribute(attribute.name)) {
      currentElement.removeAttribute(attribute.name);
    }
  }

  for (const attribute of Array.from(nextElement.attributes)) {
    if (currentElement.getAttribute(attribute.name) !== attribute.value) {
      currentElement.setAttribute(attribute.name, attribute.value);
    }
  }
};

const setOrRemoveAttribute = (
  element: Element,
  name: string,
  value: string | null,
): void => {
  if (value === null) {
    element.removeAttribute(name);
    return;
  }

  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
};

const syncTextareaElement = (
  currentElement: Element,
  nextElement: Element,
  baseElement: Element | null,
): void => {
  const baseText = baseElement?.textContent ?? null;
  const nextText = nextElement.textContent ?? "";

  if (baseElement === null || nextText !== baseText) {
    currentElement.textContent = nextText;
  }
};

const morphChildren = (
  currentElement: Element,
  nextElement: Element,
  baseElement: Element | null,
): void => {
  const currentChildren = Array.from(currentElement.childNodes);
  const baseChildren = baseElement === null ? [] : Array.from(baseElement.childNodes);
  const matchedCurrentNodes = new Set<Node>();
  const matchedBaseNodes = new Set<Node>();
  let insertionPoint: ChildNode | null = currentElement.firstChild;

  for (const nextChild of Array.from(nextElement.childNodes)) {
    const baseChild = findMatchingChild(
      nextChild,
      baseChildren,
      matchedBaseNodes,
    );
    const currentChild = baseChild === null
      ? findMatchingChild(nextChild, currentChildren, matchedCurrentNodes)
      : findMatchingChild(baseChild, currentChildren, matchedCurrentNodes);

    if (baseChild !== null) {
      matchedBaseNodes.add(baseChild);
    }

    if (currentChild === null) {
      const importedChild = currentElement.ownerDocument.importNode(nextChild, true);
      currentElement.insertBefore(importedChild, insertionPoint);
      insertionPoint = importedChild.nextSibling;
      continue;
    }

    matchedCurrentNodes.add(currentChild);

    if (currentChild !== insertionPoint) {
      currentElement.insertBefore(currentChild, insertionPoint);
    }

    morphNode(currentChild, nextChild, baseChild);
    insertionPoint = currentChild.nextSibling;
  }

  for (const currentChild of currentChildren) {
    if (matchedCurrentNodes.has(currentChild) || currentChild.parentNode !== currentElement) {
      continue;
    }

    const baseChild = findMatchingChild(currentChild, baseChildren, matchedBaseNodes);

    if (baseElement === null || baseChild !== null) {
      currentChild.remove();
    }
  }
};

const findMatchingChild = (
  nextChild: Node,
  currentChildren: readonly Node[],
  matchedCurrentNodes: ReadonlySet<Node>,
): ChildNode | null => {
  if (isElementNode(nextChild)) {
    const id = nextChild.getAttribute("id");

    if (id !== null && id.length > 0) {
      const match = currentChildren.find((currentChild) =>
        !matchedCurrentNodes.has(currentChild) &&
        isElementNode(currentChild) &&
        currentChild.tagName === nextChild.tagName &&
        currentChild.getAttribute("id") === id
      );

      if (isChildNode(match)) {
        return match;
      }
    }

    const name = nextChild.getAttribute("name");

    if (name !== null && name.length > 0) {
      const match = currentChildren.find((currentChild) =>
        !matchedCurrentNodes.has(currentChild) &&
        isElementNode(currentChild) &&
        currentChild.tagName === nextChild.tagName &&
        currentChild.getAttribute("name") === name
      );

      if (isChildNode(match)) {
        return match;
      }
    }
  }

  const sequentialMatch = currentChildren.find((currentChild) =>
    !matchedCurrentNodes.has(currentChild) &&
    sameNodeShape(currentChild, nextChild)
  );

  if (isChildNode(sequentialMatch)) {
    return sequentialMatch;
  }

  return null;
};

const sameNodeShape = (currentNode: Node, nextNode: Node): boolean => {
  if (currentNode.nodeType !== nextNode.nodeType) {
    return false;
  }

  if (isElementNode(currentNode) && isElementNode(nextNode)) {
    return currentNode.tagName === nextNode.tagName;
  }

  return true;
};

const replaceNode = (currentNode: Node, nextNode: Node): void => {
  const parent = currentNode.parentNode;
  const ownerDocument = currentNode.ownerDocument;

  if (parent === null || ownerDocument === null) {
    return;
  }

  parent.replaceChild(ownerDocument.importNode(nextNode, true), currentNode);
};

const isElementNode = (node: Node | null | undefined): node is Element =>
  node?.nodeType === Node.ELEMENT_NODE;

const isChildNode = (node: Node | null | undefined): node is ChildNode =>
  node !== null && node !== undefined && "remove" in node;

const isJavaScriptPath = (path: string): boolean => {
  const cleanPath = path.split("?")[0]?.split("#")[0] ?? path;
  return /\.(?:c|m)?jsx?$|\.tsx?$/iu.test(cleanPath);
};

const scriptSignatures = (document: Document, baseUrl: URL): readonly string[] =>
  Array.from(document.scripts, (script) => {
    const rawSrc = script.getAttribute("src");

    return JSON.stringify({
      async: script.async,
      defer: script.defer,
      integrity: script.integrity,
      noModule: script.noModule,
      src: rawSrc === null ? null : normalizeUrl(rawSrc, baseUrl),
      text: rawSrc === null ? script.textContent ?? "" : "",
      type: script.type,
    });
  });

const sameScriptSignatures = (
  current: readonly string[],
  next: readonly string[],
): boolean =>
  current.length === next.length && current.every((signature, index) => signature === next[index]);

const normalizeUrl = (value: string, baseUrl: URL): string | null => {
  try {
    const url = new URL(value, baseUrl);
    url.searchParams.delete(PREVIEW_CACHE_BUSTER_PARAM);
    return url.toString();
  } catch {
    return null;
  }
};

const applyChangedAssetCacheBuster = (
  document: Document,
  baseUrl: URL,
  previewRoot: string,
  change: PreviewHtmlChange | undefined,
  version: string,
): void => {
  if (
    change === undefined ||
    change.type === "initial" ||
    change.isEntry ||
    isJavaScriptPath(change.path)
  ) {
    return;
  }

  const attributes = ["href", "src", "poster"] as const;

  for (const attribute of attributes) {
    for (const element of Array.from(document.querySelectorAll(`[${attribute}]`))) {
      const currentValue = element.getAttribute(attribute);
      const nextValue = currentValue === null
        ? null
        : cacheBustPreviewUrl(currentValue, baseUrl, previewRoot, change.path, version);

      if (nextValue !== null) {
        element.setAttribute(attribute, nextValue);
      }
    }
  }

  for (const element of Array.from(document.querySelectorAll("[srcset]"))) {
    const currentValue = element.getAttribute("srcset");
    const nextValue = currentValue === null
      ? null
      : cacheBustSrcset(currentValue, baseUrl, previewRoot, change.path, version);

    if (nextValue !== null) {
      element.setAttribute("srcset", nextValue);
    }
  }
};

const cacheBustSrcset = (
  value: string,
  baseUrl: URL,
  previewRoot: string,
  changedPath: string,
  version: string,
): string | null => {
  let changed = false;
  const nextValue = value.split(",").map((candidate) => {
    const trimmed = candidate.trim();
    const [urlPart, ...descriptorParts] = trimmed.split(/\s+/u);

    if (urlPart === undefined || urlPart.length === 0) {
      return candidate;
    }

    const nextUrl = cacheBustPreviewUrl(urlPart, baseUrl, previewRoot, changedPath, version);

    if (nextUrl === null) {
      return candidate;
    }

    changed = true;
    return [nextUrl, ...descriptorParts].join(" ");
  }).join(", ");

  return changed ? nextValue : null;
};

const cacheBustPreviewUrl = (
  value: string,
  baseUrl: URL,
  previewRoot: string,
  changedPath: string,
  version: string,
): string | null => {
  try {
    const url = new URL(value, baseUrl);

    if (url.origin !== baseUrl.origin || !url.pathname.startsWith(previewRoot)) {
      return null;
    }

    const relativePath = decodePreviewPath(url.pathname.slice(previewRoot.length));

    if (relativePath !== normalizePreviewPath(changedPath)) {
      return null;
    }

    url.searchParams.set(PREVIEW_CACHE_BUSTER_PARAM, version);
    return url.toString();
  } catch {
    return null;
  }
};

const decodePreviewPath = (path: string): string => {
  try {
    return normalizePreviewPath(decodeURIComponent(path));
  } catch {
    return normalizePreviewPath(path);
  }
};

const normalizePreviewPath = (path: string): string =>
  path.split("/").filter(Boolean).join("/");

const snapshotIframeState = (
  frameWindow: Window,
  document: Document,
): IframeStateSnapshot => ({
  scrollX: frameWindow.scrollX,
  scrollY: frameWindow.scrollY,
  activeElement: snapshotActiveElement(document),
  dirtyControls: snapshotDirtyControls(document),
});

const restoreIframeState = (
  frameWindow: Window,
  document: Document,
  snapshot: IframeStateSnapshot,
): void => {
  restoreDirtyControls(document, snapshot.dirtyControls);
  restoreActiveElement(document, snapshot.activeElement);
  frameWindow.scrollTo(snapshot.scrollX, snapshot.scrollY);
};

const snapshotActiveElement = (document: Document): ElementSnapshot | null => {
  const element = document.activeElement;

  if (!isHTMLElement(element)) {
    return null;
  }

  const selector = selectorForElement(element);

  if (selector === null) {
    return null;
  }

  return {
    selector,
    selectionStart: selectionCapable(element) ? element.selectionStart : null,
    selectionEnd: selectionCapable(element) ? element.selectionEnd : null,
    selectionDirection: selectionCapable(element) ? element.selectionDirection : null,
  };
};

const restoreActiveElement = (document: Document, snapshot: ElementSnapshot | null): void => {
  if (snapshot === null) {
    return;
  }

  const element = document.querySelector(snapshot.selector);

  if (!isHTMLElement(element)) {
    return;
  }

  element.focus({ preventScroll: true });

  if (selectionCapable(element) && snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
    element.setSelectionRange(
      snapshot.selectionStart,
      snapshot.selectionEnd,
      snapshot.selectionDirection ?? undefined,
    );
  }
};

const snapshotDirtyControls = (document: Document): readonly ControlSnapshot[] => {
  const snapshots: ControlSnapshot[] = [];

  for (const element of Array.from(document.querySelectorAll("input, textarea, select"))) {
    const selector = selectorForElement(element);

    if (selector === null) {
      continue;
    }

    if (isInputElement(element) && (element.type === "checkbox" || element.type === "radio")) {
      if (element.checked !== element.defaultChecked) {
        snapshots.push({ selector, kind: "checked", checked: element.checked });
      }
      continue;
    }

    if (isInputElement(element) || isTextAreaElement(element)) {
      if (element.value !== element.defaultValue) {
        snapshots.push({ selector, kind: "value", value: element.value });
      }
      continue;
    }

    if (isSelectElement(element)) {
      const currentValues = Array.from(element.selectedOptions, (option) => option.value);
      const defaultValues = Array.from(element.options)
        .filter((option) => option.defaultSelected)
        .map((option) => option.value);

      if (!sameStringList(currentValues, defaultValues)) {
        snapshots.push({ selector, kind: "select", values: currentValues });
      }
    }
  }

  return snapshots;
};

const restoreDirtyControls = (
  document: Document,
  snapshots: readonly ControlSnapshot[],
): void => {
  for (const snapshot of snapshots) {
    const element = document.querySelector(snapshot.selector);

    if (snapshot.kind === "checked" && isInputElement(element)) {
      element.checked = snapshot.checked;
      continue;
    }

    if (
      snapshot.kind === "value" &&
      (isInputElement(element) || isTextAreaElement(element))
    ) {
      element.value = snapshot.value;
      continue;
    }

    if (snapshot.kind === "select" && isSelectElement(element)) {
      const selected = new Set(snapshot.values);
      for (const option of Array.from(element.options)) {
        option.selected = selected.has(option.value);
      }
    }
  }
};

const sameStringList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const selectionCapable = (
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement =>
  isTextAreaElement(element) ||
  (
    isInputElement(element) &&
    /^(?:text|search|url|tel|password|email|number)$/iu.test(element.type)
  );

const isHTMLElement = (element: Element | null): element is HTMLElement => {
  const ownerWindow = element?.ownerDocument.defaultView;
  return ownerWindow !== null && ownerWindow !== undefined && element instanceof ownerWindow.HTMLElement;
};

const isInputElement = (element: Element | null): element is HTMLInputElement => {
  const ownerWindow = element?.ownerDocument.defaultView;
  return ownerWindow !== null && ownerWindow !== undefined && element instanceof ownerWindow.HTMLInputElement;
};

const isTextAreaElement = (element: Element | null): element is HTMLTextAreaElement => {
  const ownerWindow = element?.ownerDocument.defaultView;
  return ownerWindow !== null && ownerWindow !== undefined && element instanceof ownerWindow.HTMLTextAreaElement;
};

const isSelectElement = (element: Element | null): element is HTMLSelectElement => {
  const ownerWindow = element?.ownerDocument.defaultView;
  return ownerWindow !== null && ownerWindow !== undefined && element instanceof ownerWindow.HTMLSelectElement;
};

const selectorForElement = (element: Element): string | null => {
  if (element.id.length > 0) {
    return `#${escapeCssIdentifier(element.id)}`;
  }

  const name = element.getAttribute("name");

  if (name !== null && name.length > 0) {
    const selector = `${element.tagName.toLowerCase()}[name="${escapeCssString(name)}"]`;
    const ownerDocument = element.ownerDocument;

    if (ownerDocument.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  return null;
};

const escapeCssIdentifier = (value: string): string => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/gu, "\\$&");
};

const escapeCssString = (value: string): string =>
  value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"");

const buildReloadSrcPreservingPreviewLocation = (
  nextSrc: string,
  fallbackCurrentSrc: string,
  iframe: HTMLIFrameElement | null,
): string => {
  try {
    const nextUrl = new URL(nextSrc, window.location.href);
    const currentUrl = currentPreviewUrl(iframe, fallbackCurrentSrc);
    const previewRoot = htmlPreviewRoot(nextUrl);

    if (
      currentUrl === null ||
      previewRoot === null ||
      currentUrl.origin !== nextUrl.origin ||
      !currentUrl.pathname.startsWith(previewRoot)
    ) {
      return nextUrl.toString();
    }

    const nextVersion = nextUrl.searchParams.get("v");

    if (nextVersion !== null) {
      currentUrl.searchParams.set("v", nextVersion);
    }

    return currentUrl.toString();
  } catch {
    return nextSrc;
  }
};

const buildManualReloadSrc = (
  iframe: HTMLIFrameElement | null,
  fallbackCurrentSrc: string,
): string => {
  const currentUrl = currentPreviewUrl(iframe, fallbackCurrentSrc);

  if (currentUrl === null) {
    return fallbackCurrentSrc;
  }

  currentUrl.searchParams.set(PREVIEW_RELOAD_PARAM, String(Date.now()));
  return currentUrl.toString();
};

const currentPreviewUrl = (
  iframe: HTMLIFrameElement | null,
  fallbackCurrentSrc: string,
): URL | null => {
  try {
    const href = iframe?.contentWindow?.location.href;
    return href === undefined ? new URL(fallbackCurrentSrc, window.location.href) : new URL(href);
  } catch {
    try {
      return new URL(fallbackCurrentSrc, window.location.href);
    } catch {
      return null;
    }
  }
};

const htmlPreviewRoot = (url: URL): string | null => {
  const match = /^(.*\/api\/html-preview\/[^/]+\/)/u.exec(url.pathname);
  return match?.[1] ?? null;
};

import {
  BrowserControlExtensionCommandError,
  connectBrowserControlExtensionPort,
} from "../../../cloud/browser-control-extension";
import type { BrowserViewportKeyboardInput } from "../../../filesystem/filesystem-explorer";

import type {
  BrowserControlAttachmentMetadata,
  BrowserControlAttachmentReader,
  BrowserControlOutputMetadata,
  BrowserControlOutputWriter,
} from "./browser-control-bridge-types";

export const DEFAULT_BROWSER_WINDOW_URL = "chrome://newtab";
const BROWSER_CONTROL_ATTACHMENT_CHUNK_BYTES = 512 * 1024;
const BROWSER_CONTROL_OUTPUT_CHUNK_BYTES = 512 * 1024;

export type BrowserWindowTab = {
  readonly id: number;
  readonly index: number;
  readonly active?: boolean;
  readonly favIconUrl?: string;
  readonly status?: string;
  readonly title?: string;
  readonly url?: string;
};

export type BrowserNavigationState = {
  readonly tabId: number | null;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
};

export type BrowserScreencastState = {
  readonly aspectRatio: number | null;
  readonly frameUrl: string | null;
  readonly state: "idle" | "connecting" | "streaming" | "new_tab" | "stopped" | "error";
  readonly tabId: number | null;
};

type BrowserScreencastMessage =
  | {
      readonly type: "started";
      readonly tabId: number;
    }
  | {
      readonly type: "frame";
      readonly aspectRatio: number | null;
      readonly dataUrl: string;
      readonly tabId: number;
    }
  | {
      readonly type: "stopped";
    }
  | {
      readonly type: "error";
      readonly code: string;
      readonly message: string;
    };

type BrowserControlCommandInput = {
  readonly attachments?: readonly BrowserControlAttachmentMetadata[];
  readonly command: string;
  readonly executeDebuggerCommand: BrowserDebuggerCommandExecutor;
  readonly executeExtensionCommand: (
    command: string,
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly params: unknown;
  readonly outputs?: readonly BrowserControlOutputMetadata[];
  readonly readAttachment?: BrowserControlAttachmentReader;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly windowId: number;
  readonly writeOutput?: BrowserControlOutputWriter;
};

export type BrowserDebuggerCommandExecutor = (input: {
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly signal: AbortSignal;
  readonly tabId: number;
}) => Promise<unknown>;

type CreateNewTabTarget = {
  readonly url?: string;
  readonly active?: boolean;
  readonly index?: number;
  readonly openerTabId?: number;
};

type BrowserControlTab = {
  readonly id: number;
  readonly windowId?: number;
  readonly index?: number;
  readonly active?: boolean;
  readonly url?: string;
};

type WaitUntilState = "domcontentloaded" | "complete" | "networkIdle";

type WaitForLoadOptions = {
  readonly expectedUrl?: string;
  readonly timeoutMs: number;
  readonly waitUntil: WaitUntilState;
};

type BrowserPageLoadState = {
  readonly href: string;
  readonly readyState: string;
  readonly resourceCount: number;
  readonly title: string;
};

type BrowserTabLoadState = {
  readonly pendingUrl?: string;
};

export const executeBrowserControlExtensionCommand = async ({
  attachments = [],
  command,
  executeDebuggerCommand,
  executeExtensionCommand,
  params,
  outputs = [],
  readAttachment,
  signal,
  timeoutMs,
  windowId,
  writeOutput,
}: BrowserControlCommandInput): Promise<unknown> => {
  if (attachments.length > 0 && command !== "tab.evaluate") {
    throw new BrowserControlExtensionCommandError("BROWSER_ATTACHMENTS_UNSUPPORTED", "Browser-control attachments are only supported for tab.evaluate.");
  }

  if (outputs.length > 0 && command !== "tab.screenshot" && command !== "tab.evaluate") {
    throw new BrowserControlExtensionCommandError("BROWSER_OUTPUTS_UNSUPPORTED", "Browser-control outputs are only supported for tab.evaluate and tab.screenshot.");
  }

  switch (command) {
    case "getTabs":
      return executeExtensionCommand("tabs.query", {
        ...readOptionalObject(params, "getTabs.params"),
        windowId,
      }, signal);
    case "createNewTab":
      return createBrowserTabs({
        executeDebuggerCommand,
        executeExtensionCommand,
        params,
        signal,
        timeoutMs,
        windowId,
      });
    case "closeTab":
      return closeBrowserTabs({
        executeExtensionCommand,
        params,
        signal,
      });
    case "tab.focus":
      return executeExtensionCommand("managedWindow.activateTab", {
        tabId: readTabId(params, "tab.focus.params"),
      }, signal);
    case "tab.back":
      return navigateBrowserHistory({
        direction: "back",
        executeDebuggerCommand,
        executeExtensionCommand,
        params,
        signal,
        timeoutMs,
      });
    case "tab.forward":
      return navigateBrowserHistory({
        direction: "forward",
        executeDebuggerCommand,
        executeExtensionCommand,
        params,
        signal,
        timeoutMs,
      });
    case "tab.goTo": {
      const parsed = readRequiredObject(params, "tab.goTo.params");
      const tabId = readRequiredNumber(parsed["tabId"], "tab.goTo.params.tabId");
      const navigation = await navigateManagedBrowserTab({
        executeExtensionCommand,
        signal,
        tabId,
        url: readRequiredString(parsed["url"], "tab.goTo.params.url"),
        windowId,
      });
      return withOptionalLoadWait({
        executeDebuggerCommand,
        executeExtensionCommand,
        params: parsed,
        result: navigation.result,
        signal,
        tabId: navigation.tabId,
        timeoutMs,
        windowId,
      });
    }
    case "tab.refresh": {
      const parsed = readRequiredObject(params, "tab.refresh.params");
      const tabId = readRequiredNumber(parsed["tabId"], "tab.refresh.params.tabId");
      const bypassCache = readOptionalBoolean(parsed["bypassCache"], "tab.refresh.params.bypassCache");
      await executeExtensionCommand("chrome.call", {
        api: "tabs.reload",
        args: bypassCache === undefined ? [tabId] : [tabId, { bypassCache }],
      }, signal);
      return withOptionalLoadWait({
        executeDebuggerCommand,
        executeExtensionCommand,
        params: parsed,
        result: { reloaded: true, tabId },
        signal,
        tabId,
        timeoutMs,
        windowId,
      });
    }
    case "tab.evaluate": {
      const parsed = readRequiredObject(params, "tab.evaluate.params");
      if (attachments.length > 0) {
        await hydrateBrowserControlAttachments({
          attachments,
          executeDebuggerCommand,
          params: parsed,
          readAttachment,
          signal,
        });
      }

      if (outputs.length > 0) {
        await prepareBrowserControlDownloads({
          executeDebuggerCommand,
          outputs,
          params: parsed,
          signal,
        });
      }

      const evaluation = await evaluateInBrowserTab({
        executeDebuggerCommand,
        params: outputs.length > 0
          ? { ...parsed, awaitPromise: true }
          : parsed,
        signal,
      });

      if (outputs.length > 0) {
        if (isFailedBrowserEvaluation(evaluation)) {
          throw new BrowserControlExtensionCommandError("BROWSER_EXECUTOR_ERROR", "tab.evaluate failed before browser-control downloads completed.");
        }

        await drainBrowserControlDownloads({
          executeDebuggerCommand,
          outputs,
          params: parsed,
          signal,
          writeOutput,
        });
      }

      return evaluation;
    }
    case "tab.screenshot":
      return captureBrowserTabScreenshot({
        executeDebuggerCommand,
        executeExtensionCommand,
        outputs,
        params,
        signal,
        timeoutMs,
        writeOutput,
      });
    case "tab.cdp": {
      const parsed = readRequiredObject(params, "tab.cdp.params");
      return executeDebuggerCommand({
        tabId: readRequiredNumber(parsed["tabId"], "tab.cdp.params.tabId"),
        method: readRequiredString(parsed["method"], "tab.cdp.params.method"),
        params: parsed["params"] === undefined ? undefined : readRequiredObject(parsed["params"], "tab.cdp.params.params"),
        signal,
      });
    }
    default:
      throw new Error(`Unsupported browser-control command: ${command}`);
  }
};

const createBrowserTabs = async ({
  executeDebuggerCommand,
  executeExtensionCommand,
  params,
  signal,
  timeoutMs,
  windowId,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly params: unknown;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly windowId: number;
}): Promise<unknown> => {
  const parsed = readRequiredObject(params, "createNewTab.params");
  const rawTabs = parsed["tabs"];

  if (!Array.isArray(rawTabs) || rawTabs.length === 0) {
    throw new Error("createNewTab.params.tabs must be a non-empty array.");
  }

  const createdTabs: unknown[] = [];
  const loads: unknown[] = [];
  for (const rawTab of rawTabs) {
    const tab = readCreateNewTabTarget(rawTab);
    const createdTab = await executeExtensionCommand("chrome.call", {
      api: "tabs.create",
      args: [{
        windowId,
        ...tab,
      }],
    }, signal);
    createdTabs.push(createdTab);

    if (tab.url !== undefined) {
      const waitForLoad = parseWaitForLoadOptions(parsed["waitForLoad"], timeoutMs, tab.url);
      if (waitForLoad === null) {
        continue;
      }

      loads.push(await waitForBrowserLoad({
        executeDebuggerCommand,
        executeExtensionCommand,
        options: waitForLoad,
        signal,
        tabId: readBrowserControlTabId(createdTab, "createNewTab.result.tabs[]"),
      }));
    }
  }

  await rememberCurrentActiveTab({ executeExtensionCommand, signal, windowId });

  return stripUndefined({
    tabs: createdTabs,
    windowId,
    loads: loads.length > 0 ? loads : undefined,
  });
};

const navigateManagedBrowserTab = async ({
  executeExtensionCommand,
  signal,
  tabId,
  url,
  windowId,
}: {
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly signal: AbortSignal;
  readonly tabId: number;
  readonly url: string;
  readonly windowId: number;
}): Promise<{ readonly result: unknown; readonly tabId: number }> => {
  try {
    return {
      result: await executeExtensionCommand("managedWindow.navigate", {
        tabId,
        url,
      }, signal),
      tabId,
    };
  } catch (error) {
    if (!isRestrictedChromeUrlNavigationError(error)) {
      throw error;
    }
  }

  try {
    const updatedTab = await executeExtensionCommand("tabs.update", {
      active: true,
      tabId,
      url,
    }, signal);
    const updatedUrl = readBrowserControlTabUrl(updatedTab) ?? url;

    const windowRecord = await executeExtensionCommand("managedWindow.remember", {
      tabId,
      url: updatedUrl,
      windowId,
    }, signal);
    const tabs = await executeExtensionCommand("managedWindow.listTabs", undefined, signal);

    return {
      result: {
        fallback: "tabs.update",
        tabs,
        window: windowRecord,
      },
      tabId,
    };
  } catch (error) {
    if (!isRestrictedChromeUrlNavigationError(error)) {
      throw error;
    }
  }

  const existingTabs = await executeExtensionCommand("tabs.query", { windowId }, signal);
  const existingTab = Array.isArray(existingTabs)
    ? existingTabs.find((tab) => isBrowserControlTab(tab) && tab.id === tabId)
    : undefined;
  const replacementTab = await executeExtensionCommand("chrome.call", {
    api: "tabs.create",
    args: [stripUndefined({
      active: true,
      index: existingTab?.index,
      url,
      windowId,
    })],
  }, signal);
  const replacementTabId = readBrowserControlTabId(replacementTab, "tab.goTo.replacementTab");
  const replacementUrl = readBrowserControlTabUrl(replacementTab) ?? url;

  await executeExtensionCommand("chrome.call", {
    api: "tabs.remove",
    args: [tabId],
  }, signal).catch(() => undefined);

  const windowRecord = await executeExtensionCommand("managedWindow.remember", {
    tabId: replacementTabId,
    url: replacementUrl,
    windowId,
  }, signal);
  const tabs = await executeExtensionCommand("managedWindow.listTabs", undefined, signal);

  return {
    result: {
      fallback: "replacementTab",
      replacedTabId: tabId,
      tabId: replacementTabId,
      tabs,
      window: windowRecord,
    },
    tabId: replacementTabId,
  };
};

const closeBrowserTabs = async ({
  executeExtensionCommand,
  params,
  signal,
}: {
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly params: unknown;
  readonly signal: AbortSignal;
}): Promise<unknown> => {
  const parsed = readRequiredObject(params, "closeTab.params");
  const rawTabIds = parsed["tabIds"];

  if (!Array.isArray(rawTabIds) || rawTabIds.length === 0) {
    throw new Error("closeTab.params.tabIds must be a non-empty array.");
  }

  let state: unknown = null;
  for (const tabId of rawTabIds) {
    state = await executeExtensionCommand("managedWindow.closeTab", {
      tabId: readRequiredNumber(tabId, "closeTab.params.tabIds[]"),
    }, signal);
  }

  return state;
};

const navigateBrowserHistory = async ({
  direction,
  executeDebuggerCommand,
  executeExtensionCommand,
  params,
  signal,
  timeoutMs,
}: {
  readonly direction: "back" | "forward";
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly params: unknown;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<unknown> => {
  const parsedParams = readRequiredObject(params, `tab.${direction}.params`);
  const tabId = readRequiredNumber(parsedParams["tabId"], `tab.${direction}.params.tabId`);
  const history = await executeDebuggerCommand({
    tabId,
    method: "Page.getNavigationHistory",
    signal,
  });
  const parsedHistory = readNavigationHistory(history);
  const nextIndex = direction === "back"
    ? parsedHistory.currentIndex - 1
    : parsedHistory.currentIndex + 1;
  const entry = parsedHistory.entries[nextIndex];

  if (entry === undefined) {
    return {
      navigated: false,
      reason: direction === "back" ? "NO_BACK_HISTORY" : "NO_FORWARD_HISTORY",
      currentIndex: parsedHistory.currentIndex,
      entriesLength: parsedHistory.entries.length,
      tabId,
      targetIndex: parsedHistory.currentIndex,
    };
  }

  const result = await executeDebuggerCommand({
    tabId,
    method: "Page.navigateToHistoryEntry",
    params: { entryId: entry.id },
    signal,
  });

  const navigationResult = {
    currentIndex: parsedHistory.currentIndex,
    navigated: true,
    direction,
    entry,
    entriesLength: parsedHistory.entries.length,
    result,
    tabId,
    targetIndex: nextIndex,
  };

  return withOptionalLoadWait({
    executeDebuggerCommand,
    executeExtensionCommand,
    params: parsedParams,
    result: navigationResult,
    signal,
    tabId,
    timeoutMs,
  });
};

const withOptionalLoadWait = async ({
  executeDebuggerCommand,
  executeExtensionCommand,
  params,
  result,
  signal,
  tabId,
  timeoutMs,
  windowId,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly params: Record<string, unknown>;
  readonly result: unknown;
  readonly signal: AbortSignal;
  readonly tabId: number;
  readonly timeoutMs?: number;
  readonly windowId?: number;
}): Promise<unknown> => {
  const waitForLoad = parseWaitForLoadOptions(params["waitForLoad"], timeoutMs, readWaitForLoadExpectedUrl(params));

  if (waitForLoad === null) {
    return result;
  }

  const load = await waitForBrowserLoad({
    executeDebuggerCommand,
    executeExtensionCommand,
    options: waitForLoad,
    signal,
    tabId,
  });

  if (windowId !== undefined) {
    await rememberCurrentActiveTab({ executeExtensionCommand, signal, windowId });
  }

  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return {
      ...result,
      load,
    };
  }

  return { result, load };
};

const waitForBrowserLoad = async ({
  executeDebuggerCommand,
  executeExtensionCommand,
  options,
  signal,
  tabId,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly options: WaitForLoadOptions;
  readonly signal: AbortSignal;
  readonly tabId: number;
}): Promise<{
  readonly elapsedMs: number;
  readonly href: string;
  readonly readyState: string;
  readonly resourceCount: number;
  readonly tabId: number;
  readonly title: string;
  readonly waited: true;
  readonly waitUntil: WaitUntilState;
}> => {
  const startedAt = Date.now();
  let lastResourceCount: number | null = null;
  let resourceCountStableSince: number | null = null;

  for (;;) {
    throwIfAborted(signal);
    const state = await getBrowserLoadState({ executeDebuggerCommand, executeExtensionCommand, signal, tabId });
    const elapsedMs = Date.now() - startedAt;
    const pageState = state.page;
    const isWaitingForNavigationCommit = shouldWaitForNavigationCommit(pageState.href, options.expectedUrl, state.tab.pendingUrl);

    if (isWaitingForNavigationCommit) {
      lastResourceCount = null;
      resourceCountStableSince = null;
    } else if (options.waitUntil === "domcontentloaded" && (pageState.readyState === "interactive" || pageState.readyState === "complete")) {
      return { ...pageState, elapsedMs, tabId, waited: true, waitUntil: options.waitUntil };
    } else if (options.waitUntil === "complete" && pageState.readyState === "complete") {
      return { ...pageState, elapsedMs, tabId, waited: true, waitUntil: options.waitUntil };
    } else if (options.waitUntil === "networkIdle" && pageState.readyState === "complete") {
      if (lastResourceCount === pageState.resourceCount) {
        resourceCountStableSince ??= Date.now();
      } else {
        lastResourceCount = pageState.resourceCount;
        resourceCountStableSince = Date.now();
      }

      if (resourceCountStableSince !== null && Date.now() - resourceCountStableSince >= 750) {
        return { ...pageState, elapsedMs, tabId, waited: true, waitUntil: options.waitUntil };
      }
    }

    if (elapsedMs >= options.timeoutMs) {
      throw new Error(`Timed out waiting for tab ${String(tabId)} to reach ${options.waitUntil}.`);
    }

    await delay(250, signal);
  }
};

const getBrowserLoadState = async ({
  executeDebuggerCommand,
  executeExtensionCommand,
  signal,
  tabId,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly signal: AbortSignal;
  readonly tabId: number;
}): Promise<{
  readonly page: BrowserPageLoadState;
  readonly tab: BrowserTabLoadState;
}> => {
  const tab = readBrowserTabLoadState(
    await executeExtensionCommand("chrome.call", {
      api: "tabs.get",
      args: [tabId],
    }, signal),
  );
  const result = await executeDebuggerCommand({
    tabId,
    method: "Runtime.evaluate",
    params: {
      expression: "({ href: location.href, readyState: document.readyState, resourceCount: performance.getEntriesByType('resource').length, title: document.title })",
      returnByValue: true,
    },
    signal,
  });
  const value = readCdpEvaluationValue(result, "loadState");
  const state = readRequiredObject(value, "loadState");

  return {
    page: {
      href: readRequiredString(state["href"], "loadState.href"),
      readyState: readRequiredString(state["readyState"], "loadState.readyState"),
      resourceCount: readRequiredNumber(state["resourceCount"], "loadState.resourceCount"),
      title: typeof state["title"] === "string" ? state["title"] : "",
    },
    tab,
  };
};

const hydrateBrowserControlAttachments = async ({
  attachments,
  executeDebuggerCommand,
  params,
  readAttachment,
  signal,
}: {
  readonly attachments: readonly BrowserControlAttachmentMetadata[];
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly params: Record<string, unknown>;
  readonly readAttachment: BrowserControlAttachmentReader | undefined;
  readonly signal: AbortSignal;
}): Promise<void> => {
  if (readAttachment === undefined) {
    throw new BrowserControlExtensionCommandError("BROWSER_ATTACHMENTS_UNSUPPORTED", "Browser-control attachment reader is unavailable.");
  }

  const tabId = readRequiredNumber(params["tabId"], "tab.evaluate.params.tabId");
  await evaluateBrowserControlAttachmentScript({
    executeDebuggerCommand,
    expression: browserControlFilesHelperExpression,
    label: "browserControlFiles.install",
    signal,
    tabId,
  });

  for (const attachment of attachments) {
    await evaluateBrowserControlAttachmentScript({
      executeDebuggerCommand,
      expression: `window.__heysnapFiles.__begin(${JSON.stringify(attachment)})`,
      label: `browserControlFiles.${attachment.id}.begin`,
      signal,
      tabId,
    });

    let offset = 0;
    for (;;) {
      throwIfAborted(signal);
      const chunk = await readAttachment({
        attachmentId: attachment.id,
        length: BROWSER_CONTROL_ATTACHMENT_CHUNK_BYTES,
        offset,
        signal,
      });

      if (chunk.offset !== offset) {
        throw new Error(`Browser-control attachment ${attachment.id} returned an unexpected chunk offset.`);
      }

      const byteLength = getBase64ByteLength(chunk.dataBase64);
      await evaluateBrowserControlAttachmentScript({
        executeDebuggerCommand,
        expression: `window.__heysnapFiles.__append(${JSON.stringify(attachment.id)}, ${JSON.stringify(chunk.dataBase64)})`,
        label: `browserControlFiles.${attachment.id}.append`,
        signal,
        tabId,
      });
      offset += byteLength;

      if (chunk.done) {
        break;
      }

      if (byteLength === 0) {
        throw new Error(`Browser-control attachment ${attachment.id} returned an empty non-final chunk.`);
      }
    }

    if (offset !== attachment.size) {
      throw new Error(`Browser-control attachment ${attachment.id} size mismatch after streaming.`);
    }

    await evaluateBrowserControlAttachmentScript({
      executeDebuggerCommand,
      expression: `window.__heysnapFiles.__finish(${JSON.stringify(attachment.id)})`,
      label: `browserControlFiles.${attachment.id}.finish`,
      signal,
      tabId,
    });
  }
};

const evaluateBrowserControlAttachmentScript = async ({
  executeDebuggerCommand,
  expression,
  label,
  signal,
  tabId,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly expression: string;
  readonly label: string;
  readonly signal: AbortSignal;
  readonly tabId: number;
}): Promise<void> => {
  const result = await executeDebuggerCommand({
    tabId,
    method: "Runtime.evaluate",
    params: {
      awaitPromise: true,
      expression,
      returnByValue: true,
    },
    signal,
  });
  const cdpResult = readRequiredObject(result, `${label}.result`);

  if (cdpResult["exceptionDetails"] !== undefined) {
    throw new Error(`${label} failed while hydrating browser-control attachments.`);
  }
};

const evaluateInBrowserTab = async ({
  executeDebuggerCommand,
  params,
  signal,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly params: Record<string, unknown>;
  readonly signal: AbortSignal;
}): Promise<unknown> => {
  const result = await executeDebuggerCommand({
    tabId: readRequiredNumber(params["tabId"], "tab.evaluate.params.tabId"),
    method: "Runtime.evaluate",
    params: stripUndefined({
      expression: readRequiredString(params["expression"], "tab.evaluate.params.expression"),
      awaitPromise: readOptionalBoolean(params["awaitPromise"], "tab.evaluate.params.awaitPromise"),
      returnByValue: params["returnByValue"] === undefined ? true : readOptionalBoolean(params["returnByValue"], "tab.evaluate.params.returnByValue"),
      timeout: readOptionalNumber(params["timeoutMs"], "tab.evaluate.params.timeoutMs"),
    }),
    signal,
  });

  const cdpResult = readRequiredObject(result, "tab.evaluate.result");

  if (cdpResult["exceptionDetails"] !== undefined) {
    return {
      exceptionDetails: cdpResult["exceptionDetails"],
      ok: false,
    };
  }

  return {
    ok: true,
    result: readCdpEvaluationResult(cdpResult["result"]),
  };
};

const isFailedBrowserEvaluation = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as Record<string, unknown>)["ok"] === false;

const prepareBrowserControlDownloads = async ({
  executeDebuggerCommand,
  outputs,
  params,
  signal,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly outputs: readonly BrowserControlOutputMetadata[];
  readonly params: Record<string, unknown>;
  readonly signal: AbortSignal;
}): Promise<void> => {
  const tabId = readRequiredNumber(params["tabId"], "tab.evaluate.params.tabId");
  await evaluateBrowserControlDownloadsScript({
    executeDebuggerCommand,
    expression: browserControlDownloadsHelperExpression,
    label: "browserControlDownloads.install",
    signal,
    tabId,
  });
  await evaluateBrowserControlDownloadsScript({
    executeDebuggerCommand,
    expression: `window.__heysnapDownloads.__prepare(${JSON.stringify(outputs)})`,
    label: "browserControlDownloads.prepare",
    signal,
    tabId,
  });
};

const drainBrowserControlDownloads = async ({
  executeDebuggerCommand,
  outputs,
  params,
  signal,
  writeOutput,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly outputs: readonly BrowserControlOutputMetadata[];
  readonly params: Record<string, unknown>;
  readonly signal: AbortSignal;
  readonly writeOutput: BrowserControlOutputWriter | undefined;
}): Promise<void> => {
  if (writeOutput === undefined) {
    throw new BrowserControlExtensionCommandError("BROWSER_OUTPUTS_UNSUPPORTED", "Browser-control output writer is unavailable.");
  }

  const tabId = readRequiredNumber(params["tabId"], "tab.evaluate.params.tabId");

  for (const output of outputs) {
    const info = readDownloadInfo(await evaluateBrowserControlDownloadsScript({
      executeDebuggerCommand,
      expression: `window.__heysnapDownloads.__info(${JSON.stringify(output.id)})`,
      label: `browserControlDownloads.${output.id}.info`,
      signal,
      tabId,
    }), `browserControlDownloads.${output.id}.info`);

    if (info.size > output.maxBytes) {
      throw new BrowserControlExtensionCommandError("BROWSER_OUTPUT_TOO_LARGE", `Browser-control download ${output.id} exceeds the ${String(output.maxBytes)} byte limit.`);
    }

    let offset = 0;
    for (;;) {
      throwIfAborted(signal);
      const chunk = readDownloadChunk(await evaluateBrowserControlDownloadsScript({
        executeDebuggerCommand,
        expression: `window.__heysnapDownloads.__read(${JSON.stringify(output.id)}, ${String(offset)}, ${String(BROWSER_CONTROL_OUTPUT_CHUNK_BYTES)})`,
        label: `browserControlDownloads.${output.id}.read`,
        signal,
        tabId,
      }), `browserControlDownloads.${output.id}.read`);

      if (chunk.offset !== offset) {
        throw new Error(`Browser-control download ${output.id} returned an unexpected chunk offset.`);
      }

      const ack = await writeOutput({
        dataBase64: chunk.dataBase64,
        done: chunk.done,
        offset,
        outputId: output.id,
        signal,
      });
      const byteLength = getBase64ByteLength(chunk.dataBase64);

      if (ack.offset !== offset || ack.bytesWritten !== byteLength) {
        throw new Error("Browser-control output acknowledged an unexpected write range.");
      }

      offset += byteLength;

      if (chunk.done) {
        break;
      }

      if (byteLength === 0) {
        throw new Error(`Browser-control download ${output.id} returned an empty non-final chunk.`);
      }
    }

    if (offset !== info.size) {
      throw new Error(`Browser-control download ${output.id} size mismatch after streaming.`);
    }
  }
};

const evaluateBrowserControlDownloadsScript = async ({
  executeDebuggerCommand,
  expression,
  label,
  signal,
  tabId,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly expression: string;
  readonly label: string;
  readonly signal: AbortSignal;
  readonly tabId: number;
}): Promise<unknown> => {
  const result = await executeDebuggerCommand({
    tabId,
    method: "Runtime.evaluate",
    params: {
      awaitPromise: true,
      expression,
      returnByValue: true,
    },
    signal,
  });
  const cdpResult = readRequiredObject(result, `${label}.result`);

  if (cdpResult["exceptionDetails"] !== undefined) {
    throw new Error(`${label} failed while handling browser-control downloads.`);
  }

  return readCdpEvaluationResult(cdpResult["result"]);
};

const readDownloadInfo = (
  value: unknown,
  label: string,
): { readonly size: number } => {
  const info = readRequiredObject(value, label);
  return {
    size: readRequiredNumber(info["size"], `${label}.size`),
  };
};

const readDownloadChunk = (
  value: unknown,
  label: string,
): { readonly dataBase64: string; readonly done: boolean; readonly offset: number } => {
  const chunk = readRequiredObject(value, label);
  return {
    dataBase64: readRequiredString(chunk["dataBase64"], `${label}.dataBase64`),
    done: readRequiredBoolean(chunk["done"], `${label}.done`),
    offset: readRequiredNumber(chunk["offset"], `${label}.offset`),
  };
};

const captureBrowserTabScreenshot = async ({
  executeDebuggerCommand,
  executeExtensionCommand,
  outputs,
  params,
  signal,
  timeoutMs,
  writeOutput,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly outputs: readonly BrowserControlOutputMetadata[];
  readonly params: unknown;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly writeOutput: BrowserControlOutputWriter | undefined;
}): Promise<unknown> => {
  if (writeOutput === undefined) {
    throw new BrowserControlExtensionCommandError("BROWSER_OUTPUTS_UNSUPPORTED", "Browser-control output writer is unavailable.");
  }

  if (outputs.length !== 1) {
    throw new BrowserControlExtensionCommandError("BROWSER_OUTPUTS_UNSUPPORTED", "tab.screenshot requires exactly one browser-control output.");
  }

  const parsed = readRequiredObject(params, "tab.screenshot.params");
  const tabId = readRequiredNumber(parsed["tabId"], "tab.screenshot.params.tabId");
  const waitForLoad = parseWaitForLoadOptions(parsed["waitForLoad"], timeoutMs);

  if (waitForLoad !== null) {
    await waitForBrowserLoad({
      executeDebuggerCommand,
      executeExtensionCommand,
      options: waitForLoad,
      signal,
      tabId,
    });
  }

  const screenshotParams = await buildScreenshotCdpParams({
    executeDebuggerCommand,
    params: parsed,
    signal,
    tabId,
  });
  const result = await executeDebuggerCommand({
    tabId,
    method: "Page.captureScreenshot",
    params: screenshotParams,
    signal,
  });
  const dataBase64 = readScreenshotData(result);
  const size = getBase64ByteLength(dataBase64);
  const output = outputs[0];

  if (size > output.maxBytes) {
    throw new BrowserControlExtensionCommandError("BROWSER_OUTPUT_TOO_LARGE", `Browser-control screenshot exceeds the ${String(output.maxBytes)} byte limit.`);
  }

  await streamBrowserControlOutput({
    dataBase64,
    outputId: output.id,
    signal,
    writeOutput,
  });

  return {
    tabId,
    outputId: output.id,
    size,
  };
};

const buildScreenshotCdpParams = async ({
  executeDebuggerCommand,
  params,
  signal,
  tabId,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly params: Record<string, unknown>;
  readonly signal: AbortSignal;
  readonly tabId: number;
}): Promise<Record<string, unknown>> => {
  const captureMode = readOptionalString(params["captureMode"], "tab.screenshot.params.captureMode") ?? "viewport";
  const format = readRequiredString(params["format"], "tab.screenshot.params.format");
  const clip = captureMode === "clip"
    ? readScreenshotClip(params["clip"], "tab.screenshot.params.clip")
    : captureMode === "fullPage"
      ? await readFullPageScreenshotClip({ executeDebuggerCommand, signal, tabId })
      : undefined;

  return stripUndefined({
    format,
    quality: readOptionalNumber(params["quality"], "tab.screenshot.params.quality"),
    clip,
    fromSurface: readOptionalBoolean(params["fromSurface"], "tab.screenshot.params.fromSurface"),
    captureBeyondViewport: captureMode === "fullPage"
      ? true
      : readOptionalBoolean(params["captureBeyondViewport"], "tab.screenshot.params.captureBeyondViewport"),
    optimizeForSpeed: readOptionalBoolean(params["optimizeForSpeed"], "tab.screenshot.params.optimizeForSpeed"),
  });
};

const readFullPageScreenshotClip = async ({
  executeDebuggerCommand,
  signal,
  tabId,
}: {
  readonly executeDebuggerCommand: BrowserControlCommandInput["executeDebuggerCommand"];
  readonly signal: AbortSignal;
  readonly tabId: number;
}): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly scale: number }> => {
  const metrics = readRequiredObject(
    await executeDebuggerCommand({
      tabId,
      method: "Page.getLayoutMetrics",
      signal,
    }),
    "Page.getLayoutMetrics.result",
  );
  const contentSize = readRequiredObject(
    metrics["cssContentSize"] ?? metrics["contentSize"],
    "Page.getLayoutMetrics.result.contentSize",
  );

  return {
    x: typeof contentSize["x"] === "number" ? contentSize["x"] : 0,
    y: typeof contentSize["y"] === "number" ? contentSize["y"] : 0,
    width: Math.max(readRequiredNumber(contentSize["width"], "Page.getLayoutMetrics.result.contentSize.width"), 1),
    height: Math.max(readRequiredNumber(contentSize["height"], "Page.getLayoutMetrics.result.contentSize.height"), 1),
    scale: 1,
  };
};

const readScreenshotClip = (
  value: unknown,
  label: string,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly scale?: number } => {
  const clip = readRequiredObject(value, label);

  return stripUndefined({
    x: readRequiredNumber(clip["x"], `${label}.x`),
    y: readRequiredNumber(clip["y"], `${label}.y`),
    width: readRequiredNumber(clip["width"], `${label}.width`),
    height: readRequiredNumber(clip["height"], `${label}.height`),
    scale: readOptionalNumber(clip["scale"], `${label}.scale`),
  });
};

const readScreenshotData = (value: unknown): string => {
  const result = readRequiredObject(value, "Page.captureScreenshot.result");
  return readRequiredString(result["data"], "Page.captureScreenshot.result.data");
};

const streamBrowserControlOutput = async ({
  dataBase64,
  outputId,
  signal,
  writeOutput,
}: {
  readonly dataBase64: string;
  readonly outputId: string;
  readonly signal: AbortSignal;
  readonly writeOutput: BrowserControlOutputWriter;
}): Promise<void> => {
  const maxChunkCharacters = Math.floor(BROWSER_CONTROL_OUTPUT_CHUNK_BYTES / 3) * 4;
  let offset = 0;

  for (let index = 0; index < dataBase64.length; index += maxChunkCharacters) {
    throwIfAborted(signal);
    const chunk = dataBase64.slice(index, index + maxChunkCharacters);
    const done = index + maxChunkCharacters >= dataBase64.length;
    const ack = await writeOutput({
      dataBase64: chunk,
      done,
      offset,
      outputId,
      signal,
    });
    const byteLength = getBase64ByteLength(chunk);

    if (ack.offset !== offset || ack.bytesWritten !== byteLength) {
      throw new Error("Browser-control output acknowledged an unexpected write range.");
    }

    offset += byteLength;
  }

  if (dataBase64.length === 0) {
    await writeOutput({
      dataBase64: "",
      done: true,
      offset: 0,
      outputId,
      signal,
    });
  }
};

const parseWaitForLoadOptions = (
  value: unknown,
  requestTimeoutMs: number | undefined,
  expectedUrl?: string,
): WaitForLoadOptions | null => {
  if (value === undefined || value === false) {
    return null;
  }

  if (value === true) {
    return createWaitForLoadOptions(requestTimeoutMs ?? 30_000, "complete", expectedUrl);
  }

  const options = readRequiredObject(value, "waitForLoad");
  const waitUntil = options["waitUntil"] === undefined
    ? "complete"
    : readWaitUntil(options["waitUntil"], "waitForLoad.waitUntil");

  return createWaitForLoadOptions(
    readOptionalNumber(options["timeoutMs"], "waitForLoad.timeoutMs") ?? requestTimeoutMs ?? 30_000,
    waitUntil,
    expectedUrl,
  );
};

const createWaitForLoadOptions = (
  timeoutMs: number,
  waitUntil: WaitUntilState,
  expectedUrl: string | undefined,
): WaitForLoadOptions => {
  if (expectedUrl !== undefined) {
    return { expectedUrl, timeoutMs, waitUntil };
  }

  return { timeoutMs, waitUntil };
};

const readWaitForLoadExpectedUrl = (params: Record<string, unknown>): string | undefined => {
  const url = params["url"];

  return typeof url === "string" && url.trim().length > 0 ? url : undefined;
};

export const shouldWaitForNavigationCommit = (
  currentHref: string,
  expectedUrl: string | undefined,
  pendingUrl?: string,
): boolean => {
  if (pendingUrl !== undefined && pendingUrl.trim().length > 0) {
    return true;
  }

  if (expectedUrl === undefined) {
    return false;
  }

  const normalizedExpectedUrl = expectedUrl.trim().toLowerCase();

  if (normalizedExpectedUrl.length === 0 || normalizedExpectedUrl === "about:blank") {
    return false;
  }

  return currentHref === "" || currentHref === "about:blank";
};

const readWaitUntil = (value: unknown, label: string): WaitUntilState => {
  if (value === "domcontentloaded" || value === "complete" || value === "networkIdle") {
    return value;
  }

  throw new Error(`${label} must be domcontentloaded, complete, or networkIdle.`);
};

const readCdpEvaluationValue = (value: unknown, label: string): unknown => {
  const result = readRequiredObject(value, `${label}.cdpResult`);
  return readCdpEvaluationResult(result["result"]);
};

const readCdpEvaluationResult = (value: unknown): unknown => {
  const remoteObject = readRequiredObject(value, "Runtime.evaluate.result");

  if ("value" in remoteObject) {
    return remoteObject["value"];
  }

  if ("unserializableValue" in remoteObject) {
    return remoteObject["unserializableValue"];
  }

  if ("description" in remoteObject) {
    return remoteObject["description"];
  }

  return null;
};

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = (): void => {
      window.clearTimeout(timeout);
      reject(new Error("Browser-control request was cancelled."));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new Error("Browser-control request was cancelled.");
  }
};

const browserControlDownloadsHelperExpression = `(() => {
  const VERSION = 1;
  const existing = window.__heysnapDownloads;
  if (existing !== undefined && existing.version === VERSION) {
    return true;
  }

  const records = new Map();
  const encoder = new TextEncoder();
  const getIds = (ids) => {
    if (ids === undefined) {
      return Array.from(records.keys());
    }
    if (Array.isArray(ids)) {
      return ids;
    }
    return [ids];
  };
  const requireRecord = (id) => {
    const record = records.get(id);
    if (record === undefined) {
      throw new Error("Browser-control download output not found: " + id);
    }
    return record;
  };
  const requireSavedRecord = (id) => {
    const record = requireRecord(id);
    if (record.blob === null) {
      throw new Error("Browser-control download output was not saved: " + id);
    }
    return record;
  };
  const toBlob = async (source, mimeType) => {
    if (source instanceof Response) {
      return await source.blob();
    }
    if (source instanceof Blob) {
      return source;
    }
    if (source instanceof ArrayBuffer) {
      return new Blob([source], { type: mimeType });
    }
    if (ArrayBuffer.isView(source)) {
      return new Blob([source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)], { type: mimeType });
    }
    if (typeof source === "string") {
      return new Blob([encoder.encode(source)], { type: mimeType || "text/plain;charset=utf-8" });
    }
    throw new Error("Browser-control download source must be a Response, Blob, ArrayBuffer, typed array, DataView, or string.");
  };
  const encodeBase64 = (bytes) => {
    let binary = "";
    const batchSize = 0x8000;
    for (let index = 0; index < bytes.length; index += batchSize) {
      const chunk = bytes.subarray(index, index + batchSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  };
  const api = {
    version: VERSION,
    __prepare(outputs) {
      records.clear();
      for (const output of outputs) {
        records.set(output.id, {
          blob: null,
          maxBytes: output.maxBytes,
          mimeType: output.mimeType || "application/octet-stream",
        });
      }
      return true;
    },
    __info(id) {
      const record = requireSavedRecord(id);
      return {
        size: record.blob.size,
      };
    },
    async __read(id, offset, length) {
      const record = requireSavedRecord(id);
      if (!Number.isFinite(offset) || offset < 0 || offset > record.blob.size) {
        throw new Error("Browser-control download offset is outside the saved output.");
      }
      if (!Number.isFinite(length) || length <= 0) {
        throw new Error("Browser-control download read length must be positive.");
      }
      const end = Math.min(offset + length, record.blob.size);
      const bytes = new Uint8Array(await record.blob.slice(offset, end).arrayBuffer());
      return {
        dataBase64: encodeBase64(bytes),
        done: end >= record.blob.size,
        offset,
      };
    },
    async save(id, source, options) {
      const record = requireRecord(id);
      const blob = await toBlob(source, options && typeof options.mimeType === "string" ? options.mimeType : record.mimeType);
      if (blob.size > record.maxBytes) {
        throw new Error("Browser-control download exceeds the configured byte limit: " + id);
      }
      record.blob = blob;
      return {
        id,
        mimeType: blob.type || record.mimeType,
        size: blob.size,
      };
    },
    clear(ids) {
      for (const id of getIds(ids)) {
        const record = requireRecord(id);
        record.blob = null;
      }
      return true;
    },
  };

  Object.defineProperty(window, "__heysnapDownloads", {
    configurable: true,
    value: api,
  });
  return true;
})()`;

const browserControlFilesHelperExpression = `(() => {
  const VERSION = 1;
  const existing = window.__heysnapFiles;
  if (existing !== undefined && existing.version === VERSION) {
    return true;
  }

  const records = new Map();
  const requireRecord = (id) => {
    const record = records.get(id);
    if (record === undefined) {
      throw new Error("Browser-control file not found: " + id);
    }
    return record;
  };
  const decodeBase64 = (dataBase64) => {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };
  const resolveTarget = (selectorOrElement) => {
    if (typeof selectorOrElement === "string") {
      const element = document.querySelector(selectorOrElement);
      if (element === null) {
        throw new Error("Browser-control file target not found: " + selectorOrElement);
      }
      return element;
    }
    if (selectorOrElement instanceof Element) {
      return selectorOrElement;
    }
    throw new Error("Browser-control file target must be a selector or Element.");
  };
  const getIds = (ids) => {
    if (ids === undefined) {
      return Array.from(records.keys());
    }
    if (Array.isArray(ids)) {
      return ids;
    }
    return [ids];
  };
  const makeFile = (id) => {
    const record = requireRecord(id);
    if (record.done !== true) {
      throw new Error("Browser-control file is not fully loaded: " + id);
    }
    return new File(record.parts, record.name, {
      type: record.mimeType,
      lastModified: record.lastModified,
    });
  };
  const api = {
    version: VERSION,
    __begin(metadata) {
      records.set(metadata.id, {
        done: false,
        lastModified: Date.now(),
        mimeType: metadata.mimeType || "application/octet-stream",
        name: metadata.name || metadata.id,
        parts: [],
        size: metadata.size,
      });
      return true;
    },
    __append(id, dataBase64) {
      const record = requireRecord(id);
      record.parts.push(decodeBase64(dataBase64));
      return true;
    },
    __finish(id) {
      const record = requireRecord(id);
      record.done = true;
      return true;
    },
    async get(id) {
      return makeFile(id);
    },
    async getAll(ids) {
      return getIds(ids).map((id) => makeFile(id));
    },
    async setInputFiles(selectorOrElement, ids) {
      const target = resolveTarget(selectorOrElement);
      const files = await api.getAll(ids);
      const dataTransfer = new DataTransfer();
      for (const file of files) {
        dataTransfer.items.add(file);
      }
      target.files = dataTransfer.files;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { count: files.length };
    },
    async dropFiles(selectorOrElement, ids) {
      const target = resolveTarget(selectorOrElement);
      const files = await api.getAll(ids);
      const dataTransfer = new DataTransfer();
      for (const file of files) {
        dataTransfer.items.add(file);
      }
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(event);
      return { count: files.length };
    },
    clear(ids) {
      if (ids === undefined) {
        records.clear();
        return true;
      }
      for (const id of getIds(ids)) {
        records.delete(id);
      }
      return true;
    },
  };

  Object.defineProperty(window, "__heysnapFiles", {
    configurable: true,
    value: api,
  });
  return true;
})()`;

const getBase64ByteLength = (value: string): number => {
  if (value.length === 0) {
    return 0;
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
};

const rememberCurrentActiveTab = async ({
  executeExtensionCommand,
  signal,
  windowId,
}: {
  readonly executeExtensionCommand: BrowserControlCommandInput["executeExtensionCommand"];
  readonly signal: AbortSignal;
  readonly windowId: number;
}): Promise<void> => {
  const tabs = await executeExtensionCommand("tabs.query", { windowId, active: true }, signal);
  const activeTab = Array.isArray(tabs) ? tabs.find(isBrowserControlTab) : undefined;

  if (activeTab?.id === undefined) {
    return;
  }

  await executeExtensionCommand("managedWindow.remember", {
    windowId,
    tabId: activeTab.id,
    url: activeTab.url || DEFAULT_BROWSER_WINDOW_URL,
  }, signal);
};

const readCreateNewTabTarget = (value: unknown): CreateNewTabTarget => {
  const parsed = readRequiredObject(value, "createNewTab.params.tabs[]");
  return stripUndefined({
    url: readOptionalString(parsed["url"], "createNewTab.params.tabs[].url"),
    active: readOptionalBoolean(parsed["active"], "createNewTab.params.tabs[].active"),
    index: readOptionalNumber(parsed["index"], "createNewTab.params.tabs[].index"),
    openerTabId: readOptionalNumber(parsed["openerTabId"], "createNewTab.params.tabs[].openerTabId"),
  });
};

const readTabId = (value: unknown, label: string): number => {
  const parsed = readRequiredObject(value, label);
  return readRequiredNumber(parsed["tabId"], `${label}.tabId`);
};

const readBrowserControlTabId = (value: unknown, label: string): number => {
  const parsed = readRequiredObject(value, label);
  return readRequiredNumber(parsed["id"], `${label}.id`);
};

const readBrowserControlTabUrl = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return readOptionalString((value as Record<string, unknown>)["url"], "tab.url");
};

const readBrowserTabLoadState = (value: unknown): BrowserTabLoadState => {
  const parsed = readRequiredObject(value, "tabs.get.result");
  const pendingUrl = readOptionalString(parsed["pendingUrl"], "tabs.get.result.pendingUrl");

  return pendingUrl === undefined ? {} : { pendingUrl };
};

export const readNavigationHistory = (value: unknown): {
  readonly currentIndex: number;
  readonly entries: readonly { readonly id: number; readonly url?: string; readonly title?: string }[];
} => {
  const parsed = readRequiredObject(value, "navigationHistory");
  const currentIndex = readRequiredNumber(parsed["currentIndex"], "navigationHistory.currentIndex");
  const rawEntries = parsed["entries"];

  if (!Array.isArray(rawEntries)) {
    throw new Error("navigationHistory.entries must be an array.");
  }

  return {
    currentIndex,
    entries: rawEntries.map((entry) => {
      const parsedEntry = readRequiredObject(entry, "navigationHistory.entries[]");
      return stripUndefined({
        id: readRequiredNumber(parsedEntry["id"], "navigationHistory.entries[].id"),
        url: readOptionalString(parsedEntry["url"], "navigationHistory.entries[].url"),
        title: readOptionalString(parsedEntry["title"], "navigationHistory.entries[].title"),
      });
    }),
  };
};

export const readBrowserNavigationStateFromHistory = (
  tabId: number,
  history: ReturnType<typeof readNavigationHistory>,
): BrowserNavigationState => ({
  tabId,
  canGoBack: history.currentIndex > 0,
  canGoForward: history.currentIndex < history.entries.length - 1,
});

export const readBrowserNavigationStateFromNavigationResult = (
  value: unknown,
  fallbackTabId: number,
): BrowserNavigationState | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const tabId = typeof record["tabId"] === "number" ? record["tabId"] : fallbackTabId;
  const targetIndex = typeof record["targetIndex"] === "number"
    ? record["targetIndex"]
    : typeof record["currentIndex"] === "number"
      ? record["currentIndex"]
      : undefined;
  const entriesLength = typeof record["entriesLength"] === "number" ? record["entriesLength"] : undefined;

  if (targetIndex === undefined || entriesLength === undefined) {
    return null;
  }

  return {
    tabId,
    canGoBack: targetIndex > 0,
    canGoForward: targetIndex < entriesLength - 1,
  };
};

const readRequiredObject = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
};

const readOptionalObject = (value: unknown, label: string): Record<string, unknown> => {
  if (value === undefined) {
    return {};
  }

  return readRequiredObject(value, label);
};

const readRequiredNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }

  return value;
};

const readOptionalNumber = (value: unknown, label: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredNumber(value, label);
};

const readRequiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
};

const readOptionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredString(value, label);
};

const readRequiredBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
};

const readOptionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
};

export const stripUndefined = <TValue extends Record<string, unknown>>(value: TValue): TValue =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as TValue;

const isBrowserControlTab = (value: unknown): value is BrowserControlTab => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return typeof (value as { id?: unknown }).id === "number";
};

const isRestrictedChromeUrlNavigationError = (error: unknown): boolean => {
  if (error instanceof BrowserControlExtensionCommandError) {
    return error.message.includes("Cannot access a chrome:// URL");
  }

  return error instanceof Error && error.message.includes("Cannot access a chrome:// URL");
};

export const isBrowserControlExtensionUnavailableError = (error: unknown): boolean => {
  if (!(error instanceof BrowserControlExtensionCommandError)) {
    return false;
  }

  return error.code === "EXTENSION_MESSAGING_UNAVAILABLE"
    || error.code === "EXTENSION_MESSAGE_FAILED"
    || error.code === "EXTENSION_EMPTY_RESPONSE"
    || error.code === "EXTENSION_PORT_UNAVAILABLE";
};

export const isDebuggerAlreadyAttachedError = (error: unknown): boolean => getErrorMessage(error).toLowerCase().includes("already attached");

export const isDebuggerNotAttachedError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();

  return message.includes("not attached") || message.includes("detached");
};

export const shouldHoldBrowserNavigationState = (
  tabId: number,
  force: boolean,
  hold: { readonly tabId: number; readonly until: number } | null,
): boolean => !force && hold?.tabId === tabId && Date.now() < hold.until;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "";
};

export const normalizeBrowserAddressUrl = (value: string): string | null => {
  const input = value.trim();

  if (input.length === 0) {
    return null;
  }

  if (/^[a-z][a-z\d+.-]*:/iu.test(input)) {
    return input;
  }

  if (input.startsWith("//")) {
    return `https:${input}`;
  }

  if (!isLikelyBrowserAddress(input)) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }

  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/iu.test(input)) {
    return `http://${input}`;
  }

  return `https://${input}`;
};

const isLikelyBrowserAddress = (input: string): boolean => {
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/iu.test(input)) {
    return true;
  }

  return /^[^\s/?#]+\.[^\s/?#]+(?:[/?#]|$)/u.test(input);
};

export const parseChromeWindow = (value: unknown): { readonly id: number; readonly tabs: BrowserWindowTab[] } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Chrome returned an invalid window.");
  }

  const record = value as Record<string, unknown>;

  if (typeof record["id"] !== "number") {
    throw new Error("Chrome returned a window without an id.");
  }

  const tabs = parseBrowserWindowTabs(record["tabs"]);

  return { id: record["id"], tabs };
};

export const parseBrowserWindowTabs = (value: unknown): BrowserWindowTab[] =>
  Array.isArray(value)
    ? value.filter(isBrowserWindowTab).sort((first, second) => first.index - second.index)
    : [];

export const getActiveBrowserTabId = (tabs: readonly BrowserWindowTab[]): number | null =>
  tabs.find((tab) => tab.active === true)?.id ?? null;

type BrowserTabEventMessage =
  | {
      readonly type: "tabsChanged";
      readonly tabs: BrowserWindowTab[];
      readonly windowId: number | null;
    }
  | {
      readonly type: "windowRemoved";
      readonly windowId: number;
    };

export const parseBrowserTabEventMessage = (value: unknown): BrowserTabEventMessage | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record["type"] === "windowRemoved" && typeof record["windowId"] === "number") {
    return {
      type: "windowRemoved",
      windowId: record["windowId"],
    };
  }

  if (record["type"] !== "tabsChanged") {
    return null;
  }

  const windowRecord = typeof record["window"] === "object" && record["window"] !== null && !Array.isArray(record["window"])
    ? record["window"] as Record<string, unknown>
    : null;

  return {
    type: "tabsChanged",
    tabs: parseBrowserWindowTabs(record["tabs"]),
    windowId: typeof windowRecord?.["windowId"] === "number" ? windowRecord["windowId"] : null,
  };
};

export const parseBrowserScreencastMessage = (value: unknown): BrowserScreencastMessage | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record["type"] === "started" && typeof record["tabId"] === "number") {
    return {
      type: "started",
      tabId: record["tabId"],
    };
  }

  if (
    record["type"] === "frame"
    && typeof record["tabId"] === "number"
    && typeof record["dataUrl"] === "string"
  ) {
    return {
      type: "frame",
      aspectRatio: readBrowserScreencastAspectRatio(record["metadata"]),
      dataUrl: record["dataUrl"],
      tabId: record["tabId"],
    };
  }

  if (record["type"] === "stopped") {
    return { type: "stopped" };
  }

  if (record["type"] === "error") {
    return {
      type: "error",
      code: typeof record["code"] === "string" ? record["code"] : "CDP_SCREENCAST_ERROR",
      message: typeof record["message"] === "string" ? record["message"] : "Failed to stream browser tab.",
    };
  }

  return null;
};

const readBrowserScreencastAspectRatio = (metadata: unknown): number | null => {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  const width = readOptionalPositiveNumber(record["deviceWidth"]) ?? readOptionalPositiveNumber(record["width"]);
  const height = readOptionalPositiveNumber(record["deviceHeight"]) ?? readOptionalPositiveNumber(record["height"]);

  if (width === undefined || height === undefined) {
    return null;
  }

  return width / height;
};

export const readBrowserViewportSize = (value: unknown): { readonly width: number; readonly height: number } | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const viewport = readRecord(record["cssVisualViewport"])
    ?? readRecord(record["cssLayoutViewport"])
    ?? readRecord(record["visualViewport"])
    ?? readRecord(record["layoutViewport"]);
  const width = viewport === null ? undefined : readOptionalPositiveNumber(viewport["clientWidth"]);
  const height = viewport === null ? undefined : readOptionalPositiveNumber(viewport["clientHeight"]);

  if (width === undefined || height === undefined) {
    return null;
  }

  return { width, height };
};

export const createBrowserKeyboardEventParams = (input: BrowserViewportKeyboardInput): Record<string, unknown> => {
  const params: Record<string, unknown> = {
    type: input.type === "keyUp" ? "keyUp" : input.text === undefined ? "rawKeyDown" : "keyDown",
    modifiers: getBrowserKeyboardModifiers(input),
    windowsVirtualKeyCode: input.keyCode,
    nativeVirtualKeyCode: input.keyCode,
    key: input.key,
    code: input.code,
    autoRepeat: input.repeat,
    isKeypad: input.location === 3,
    location: input.location,
  };

  if (input.type === "keyDown" && input.text !== undefined) {
    params["text"] = input.text;
    params["unmodifiedText"] = input.text;
    params["macCharCode"] = input.text.charCodeAt(0);
  }

  return params;
};

const getBrowserKeyboardModifiers = (input: Pick<
  BrowserViewportKeyboardInput,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>): number =>
  (input.altKey ? 1 : 0)
  | (input.ctrlKey ? 2 : 0)
  | (input.metaKey ? 4 : 0)
  | (input.shiftKey ? 8 : 0);

const readRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const readOptionalPositiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

export const disconnectBrowserScreencastPort = (port: ReturnType<typeof connectBrowserControlExtensionPort>): void => {
  try {
    port.postMessage({ type: "stop" });
  } catch {
    // The port may already be gone.
  }

  try {
    port.disconnect();
  } catch {
    // Chrome throws if the port has already disconnected.
  }
};

export const isBrowserWindowTabDebuggable = (tab: BrowserWindowTab): boolean => {
  return isBrowserTabUrlDebuggable(tab.url);
};

type BrowserScreencastMode = "new_tab" | "streamable" | "unsupported";

export const getBrowserScreencastMode = (url: string | undefined): BrowserScreencastMode => {
  if (isBrowserNewTabUrl(url)) {
    return "new_tab";
  }

  return isBrowserTabUrlDebuggable(url) ? "streamable" : "unsupported";
};

const isBrowserTabUrlDebuggable = (url: string | undefined): boolean => {
  return url !== undefined && url.length > 0 && url !== "about:blank" && !url.startsWith("about:") && !url.startsWith("chrome://");
};

const isBrowserNewTabUrl = (url: string | undefined): boolean => {
  if (url === undefined || url.length === 0) {
    return true;
  }

  return url === "about:blank" || url === "chrome://newtab" || url === "chrome://newtab/";
};

const isBrowserWindowTab = (value: unknown): value is BrowserWindowTab => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return typeof record["id"] === "number" && typeof record["index"] === "number";
};

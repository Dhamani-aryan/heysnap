import { Cancel01Icon, CopyIcon, Share04Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import {
  getConnectionFlow,
  getConnectionToolName,
  GITHUB_DEVICE_URL,
} from "./capabilities-connection-helpers";
import type { ConnectionDialogState } from "./capabilities-types";

export function DeviceConnectionDialog({
  state,
  onSubmitInput,
  onClose,
}: {
  readonly state: ConnectionDialogState;
  readonly onSubmitInput: (input: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [inputCode, setInputCode] = useState("");
  const deviceUrl = state.url ?? (state.tool.id === "github" ? GITHUB_DEVICE_URL : null);
  const displayUrl = deviceUrl?.toLowerCase() ?? "waiting for link...";
  const toolName = getConnectionToolName(state.tool);
  const flow = getConnectionFlow(state.tool.id);
  const usesReadonlyCode = flow === "readonly-code";
  const usesInputCode = flow === "input-code";

  const openDevicePage = (): void => {
    if (deviceUrl !== null) {
      window.open(deviceUrl, "_blank", "noopener,noreferrer");
    }
  };

  const copyCode = (): void => {
    if (state.code === null) {
      return;
    }

    void navigator.clipboard.writeText(state.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_000);
    });
  };

  const copyUrl = (): void => {
    if (deviceUrl === null) {
      return;
    }

    void navigator.clipboard.writeText(deviceUrl).then(() => {
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1_000);
    });
  };

  const submitInputCode = (): void => {
    const code = inputCode.trim();
    if (code.length === 0) {
      return;
    }

    onSubmitInput(code);
    setInputCode("");
  };

  return (
    <div className="connector-connect-backdrop" role="presentation">
      <section
        className="connector-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-connect-title"
      >
        <button className="connector-connect-close" type="button" aria-label={`Close ${toolName} connection`} onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={18} color="currentColor" strokeWidth={1.8} />
        </button>
        <div className="connector-connect-header">
          <div className="connector-logo-wrap">
            {state.tool.logoUrl === undefined ? <span>G</span> : <img src={state.tool.logoUrl} alt="" />}
          </div>
          <div>
            <h2 id="connector-connect-title">
              Connect {toolName}
              <span className="connector-connect-title-spinner" aria-hidden="true" />
            </h2>
          </div>
        </div>
        <ol className="connector-connect-steps">
          <li>
            <span>Open the following link.</span>
            <div className="connector-connect-link-row">
              <button className="connector-connect-link-text" type="button" disabled={deviceUrl === null} onClick={openDevicePage}>
                {displayUrl}
              </button>
              <button
                className="connector-connect-icon-button"
                type="button"
                aria-label={copiedUrl ? "Copied link" : "Copy link"}
                title={copiedUrl ? "Copied" : "Copy link"}
                disabled={deviceUrl === null}
                onClick={copyUrl}
              >
                <HugeiconsIcon icon={copiedUrl ? Tick02Icon : CopyIcon} size={15} color="currentColor" strokeWidth={1.8} />
              </button>
              <button
                className="connector-connect-icon-button"
                type="button"
                aria-label="Open link"
                title="Open link"
                disabled={deviceUrl === null}
                onClick={openDevicePage}
              >
                <HugeiconsIcon icon={Share04Icon} size={15} color="currentColor" strokeWidth={1.8} />
              </button>
            </div>
          </li>
          {usesReadonlyCode ? (
            <li>
              <span>Enter the following code.</span>
              <div className="connector-connect-code">
                <strong>{state.code ?? "Waiting for code..."}</strong>
                <button
                  className="connector-connect-icon-button"
                  type="button"
                  aria-label={copied ? "Copied code" : "Copy code"}
                  title={copied ? "Copied" : "Copy code"}
                  disabled={state.code === null}
                  onClick={copyCode}
                >
                  <HugeiconsIcon icon={copied ? Tick02Icon : CopyIcon} size={15} color="currentColor" strokeWidth={1.8} />
                </button>
              </div>
            </li>
          ) : null}
          {usesInputCode ? (
            <li>
              <span>Enter the verification code from the {toolName} page.</span>
              <div className="connector-connect-input">
                <input
                  type="text"
                  value={inputCode}
                  placeholder="Verification code"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setInputCode(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitInputCode();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={inputCode.trim().length === 0 || state.operationId === null || state.isSubmitting}
                  onClick={submitInputCode}
                >
                  {state.isSubmitting ? "Connecting..." : "Connect"}
                </button>
              </div>
            </li>
          ) : null}
        </ol>
        {state.error === null ? null : <p className="connectors-error">{state.error}</p>}
      </section>
    </div>
  );
}

import type { AgentToolSnapshot } from "../../../cloud/capabilities-client";

import { renderConnectorStatus } from "./capabilities-connection-helpers";

export function ConnectorRow({
  tool,
  pendingLabel,
  onInstall,
  onConnect,
  onDisconnect,
}: {
  readonly tool: AgentToolSnapshot;
  readonly pendingLabel: string | null;
  readonly onInstall: (tool: AgentToolSnapshot) => void;
  readonly onConnect: (tool: AgentToolSnapshot) => void;
  readonly onDisconnect: (tool: AgentToolSnapshot) => void;
}): React.ReactElement {
  const isConnected = tool.connectionState === "connected";
  const isInstalled = tool.installState === "installed";
  const isPending = pendingLabel !== null;

  return (
    <article className="connector-list-item">
      <div className="connector-logo-wrap">
        {tool.logoUrl === undefined ? (
          <span>{tool.label.slice(0, 1)}</span>
        ) : (
          <img src={tool.logoUrl} alt="" loading="lazy" />
        )}
      </div>
      <div className="connector-copy">
        <div>
          <strong>{tool.label}</strong>
        </div>
        <span>{renderConnectorStatus(tool)}</span>
      </div>
      <div className="connector-actions">
        {!isInstalled ? (
          <button type="button" disabled={isPending} onClick={() => onInstall(tool)}>
            {pendingLabel ?? "Install"}
          </button>
        ) : null}
        {isInstalled && !isConnected && tool.canConnect ? (
          <button type="button" disabled={isPending} onClick={() => onConnect(tool)}>
            {pendingLabel ?? "Connect"}
          </button>
        ) : null}
        {isInstalled && isConnected && tool.canDisconnect ? (
          <button type="button" disabled={isPending} onClick={() => onDisconnect(tool)}>
            {pendingLabel ?? "Disconnect"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

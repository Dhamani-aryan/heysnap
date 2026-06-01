import { startMachineTunnelClient } from "./tunnel/client.js";
import { startServer } from "./runtime.js";
import { logger } from "./shared/logger.js";
import { startAgentSessionStartupSync } from "./agent/session-sync.js";

const port = Number(process.env.PORT ?? 4000);

const runningServer = await startServer({
  port,
  host: process.env.HOST ?? "127.0.0.1",
  codexBin: process.env.CODEX_BIN,
});

logger.info({
  event: "machine_server.start",
  port: runningServer.port,
  filesystemRoot: runningServer.filesystemRoot.absolutePath,
  filesystemPreviewBaseUrl: runningServer.urls.filesystemPreviewBaseUrl,
  agentBaseUrl: runningServer.urls.agentBaseUrl,
  capabilitiesBaseUrl: runningServer.urls.capabilitiesBaseUrl,
}, "Machine server listening");

if (
  process.env.CLOUD_SERVER_PUBLIC_URL !== undefined &&
  process.env.ANK1015_COMPUTER_ID !== undefined &&
  process.env.ANK1015_MACHINE_TOKEN_FILE !== undefined
) {
  startAgentSessionStartupSync({
    cloudServerPublicUrl: process.env.CLOUD_SERVER_PUBLIC_URL,
    tokenFile: process.env.ANK1015_MACHINE_TOKEN_FILE,
    home: process.env.HOME,
    codexHome: process.env.CODEX_HOME,
  });
  startMachineTunnelClient({
    cloudServerPublicUrl: process.env.CLOUD_SERVER_PUBLIC_URL,
    computerId: process.env.ANK1015_COMPUTER_ID,
    tokenFile: process.env.ANK1015_MACHINE_TOKEN_FILE,
    localPort: runningServer.port,
  });
}

const stop = () => {
  void runningServer.stop().finally(() => {
    process.exit(0);
  });
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

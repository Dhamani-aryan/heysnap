import { startMachineTunnelClient } from "./tunnel/client.js";
import { startServer } from "./runtime.js";

const port = Number(process.env.PORT ?? 4000);

const runningServer = await startServer({
  port,
  host: process.env.HOST ?? "127.0.0.1",
  codexBin: process.env.CODEX_BIN,
});

console.log(`server listening on http://127.0.0.1:${runningServer.port}`);
console.log(`filesystem root: ${runningServer.filesystemRoot.absolutePath}`);
console.log(`agent api: ${runningServer.urls.agentBaseUrl}`);
console.log(`capabilities websocket: ${runningServer.urls.capabilitiesWebSocketUrl}`);

if (
  process.env.CLOUD_SERVER_PUBLIC_URL !== undefined &&
  process.env.ANK1015_COMPUTER_ID !== undefined &&
  process.env.ANK1015_MACHINE_TOKEN_FILE !== undefined
) {
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

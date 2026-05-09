import { serve } from "@hono/node-server";
import { getCloudServerConfig, getDevelopmentCloudServerConfig } from "./config.js";
import { createDbClient } from "./db/client.js";
import { DrizzleCloudStore } from "./db/drizzle-store.js";
import { GatewayAccessService } from "./gateway/access-sessions.js";
import { attachGatewayTunnelServer, MachineTunnelRegistry } from "./gateway/tunnel.js";
import { createComputerProvisioner } from "./provisioning/factory.js";
import { createApp } from "./server.js";

const config = process.env.NODE_ENV === "production"
  ? getCloudServerConfig()
  : getDevelopmentCloudServerConfig();
const dbClient = createDbClient(config.databaseUrl);
const store = new DrizzleCloudStore(dbClient.db);
const tunnelRegistry = new MachineTunnelRegistry();
const app = createApp({
  config,
  store,
  tunnelRegistry,
  provisioner: createComputerProvisioner(config),
});
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`cloud server listening on http://localhost:${String(info.port)}`);
});

attachGatewayTunnelServer(server, {
  store,
  config,
  gatewayAccessService: new GatewayAccessService(store, config),
  registry: tunnelRegistry,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void dbClient.close().finally(() => process.exit(0));
  });
}

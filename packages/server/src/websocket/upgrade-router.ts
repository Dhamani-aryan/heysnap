import type { Server } from "node:http";
import type { WebSocketServer } from "ws";

const upgradeRouterKey = Symbol.for("ank1015-app.websocketUpgradeRouter");

interface UpgradeRouterState {
  readonly routes: Map<string, WebSocketServer>;
}

type RoutedServer = Server & {
  [upgradeRouterKey]?: UpgradeRouterState;
};

export const attachWebSocketUpgradeRoute = (
  server: Server,
  pathname: string,
  socketServer: WebSocketServer,
): void => {
  const routedServer = server as RoutedServer;
  let state = routedServer[upgradeRouterKey];

  if (state === undefined) {
    state = { routes: new Map() };
    routedServer[upgradeRouterKey] = state;
    const routerState = state;

    server.on("upgrade", (request, socket, head) => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const route = routerState.routes.get(requestUrl.pathname);

      if (route === undefined) {
        socket.destroy();
        return;
      }

      route.handleUpgrade(request, socket, head, (webSocket) => {
        route.emit("connection", webSocket, request);
      });
    });
  }

  if (state.routes.has(pathname)) {
    throw new Error(`WebSocket route already attached: ${pathname}`);
  }

  state.routes.set(pathname, socketServer);
};

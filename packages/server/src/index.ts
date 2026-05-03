import { createServer } from "node:http";
import { attachFilesystemWebSocketServer } from "./filesystem/websocket.js";
import { resolveFilesystemRoot } from "./filesystem/paths.js";

const port = Number(process.env.PORT ?? 4000);
const filesystemRoot = resolveFilesystemRoot();

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ank1015 server");
});

attachFilesystemWebSocketServer(server, {
  root: filesystemRoot,
});

server.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
  console.log(`filesystem root: ${filesystemRoot.absolutePath}`);
});

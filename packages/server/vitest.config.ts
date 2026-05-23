import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const configDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ank1015-app/previewer": resolve(configDir, "../previewer/src/server/index.ts"),
      "@ank1015-app/previewer/protocol": resolve(configDir, "../previewer/src/protocol.ts"),
    },
  },
});

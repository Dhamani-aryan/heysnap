import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  if (mode === "server") {
    return {
      build: {
        ssr: true,
        outDir: "dist/server",
        target: "node20",
        rollupOptions: {
          input: {
            index: "src/server/index.ts",
            protocol: "src/protocol.ts",
          },
          output: { entryFileNames: "[name].js", format: "esm" },
          external: ["vite"],
        },
        emptyOutDir: true,
      },
    };
  }

  return {
    plugins: [react()],
    base: "./",
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
    },
  };
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next enforces server-only boundaries at build time; tests run server code directly.
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["test/**/*.test.ts"], testTimeout: 20_000 },
});

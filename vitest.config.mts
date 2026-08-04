import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDirectory,
      "server-only": path.resolve(rootDirectory, "scripts/shims/empty.cjs"),
      "client-only": path.resolve(rootDirectory, "scripts/shims/empty.cjs"),
    },
  },
  test: {
    environment: "node",
    include: ["shared/**/*.test.ts", "features/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});

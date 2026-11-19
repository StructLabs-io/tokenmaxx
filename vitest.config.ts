import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Resolve the "@/..." import alias the same way tsconfig.json does, so tests
// can load route handlers and their real dependencies.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname) },
  },
});

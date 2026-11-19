import { defineConfig } from "vitest/config";

export default defineConfig({
  build: { sourcemap: false },
  test: { include: ["tests/**/*.test.ts"] },
});

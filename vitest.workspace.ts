import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "apps/desktop/vitest.config.ts"
]);

import { defineConfig } from "tsup";
import baseConfig from "../../tsup.config.base.js";

// Two entries: the package API and the `./internal/run-scope` subpath (per-run
// state for framework packages; deliberately not in the public index).
export default defineConfig({
  ...baseConfig,
  entry: {
    index: "src/index.ts",
    "internal/run-scope": "src/internal/run-scope.ts",
  },
});

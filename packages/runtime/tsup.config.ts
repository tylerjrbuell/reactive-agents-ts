import { defineConfig } from "tsup";
import baseConfig from "../../tsup.config.base.js";

// Two entries: the package API and the `./testing` subpath (typed runtime
// fixture builders for test suites; internal, unstable).
export default defineConfig({
  ...baseConfig,
  entry: {
    index: "src/index.ts",
    "testing/index": "src/testing/index.ts",
  },
});

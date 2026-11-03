import { defineConfig } from "tsup";
import baseConfig from "../../tsup.config.base.js";

// Two entries: the package API and the `./testing` subpath (typed kernel
// fixture builders + test doubles for downstream test suites).
export default defineConfig({
  ...baseConfig,
  entry: {
    index: "src/index.ts",
    "testing/index": "src/testing/index.ts",
  },
});

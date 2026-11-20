import { defineConfig } from "tsup";
import baseConfig from "../../tsup.config.base.js";

// Three entries: the package API, the `./testing` subpath (typed kernel
// fixture builders + test doubles for downstream test suites), and the Code
// Action sandbox worker. The worker is loaded by URL at run time
// (strategies/code-action/sandbox.ts `sandboxWorkerUrl`), never imported, so
// the bundle cannot carry it: it must be its own entry at `dist/sandbox-worker.js`
// (0.19.0 shipped without it and Code Action failed from every npm install).
export default defineConfig({
  ...baseConfig,
  entry: {
    index: "src/index.ts",
    "testing/index": "src/testing/index.ts",
    "sandbox-worker": "src/strategies/code-action/sandbox-worker.ts",
  },
});

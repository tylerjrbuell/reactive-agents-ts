import { cpSync } from "node:fs";
import { defineConfig } from "tsup";
import baseConfig from "../../tsup.config.base.js";

// Two entries: the package API and the `./internal/run-slots` subpath (the
// run slots the runtime run entry binds; deliberately not in the public index).
// Splitting is ON: both entries import the slot modules, and each `runSlot()`
// call mints a unique key, so the modules must live in ONE shared chunk. With
// splitting off, each entry would bundle its own copy and a binding made via the
// subpath would never reach the readers in the index.
export default defineConfig({
  ...baseConfig,
  entry: {
    index: "src/index.ts",
    "internal/run-slots": "src/internal/run-slots.ts",
  },
  splitting: true,
  // docker-sandbox.ts resolves its seccomp profile and Dockerfiles next to the
  // module (`<module dir>/sandbox-image/`). The bundle lands in dist/, so the
  // assets must be copied to dist/sandbox-image/ (0.19.0 shipped without them and
  // every npm install ran the Docker sandbox without seccomp).
  onSuccess: async () => {
    cpSync("src/execution/sandbox-image", "dist/sandbox-image", { recursive: true });
  },
});

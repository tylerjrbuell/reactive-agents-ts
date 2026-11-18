import { defineConfig } from "tsup";

export default defineConfig({
  // node-preflight is its own file and external to index: an ESM bundle
  // evaluates imported files in order, so it runs before runtime-shim loads.
  entry: ["src/index.ts", "src/node-preflight.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  splitting: false,
  sourcemap: true,
  // Node shebang: rax runs on Node.js 22.5+ and on Bun (`bun dist/index.js`).
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "./node-preflight.js",
    "effect",
    "@reactive-agents/core",
    "@reactive-agents/runtime",
    "@reactive-agents/runtime-shim",
    "@reactive-agents/benchmarks",
    "@reactive-agents/eval",
    "@reactive-agents/llm-provider",
    "@reactive-agents/a2a",
    "@reactive-agents/trace",
    "@reactive-agents/tools",
    "@reactive-agents/cortex",
    "@reactive-agents/diagnose",
    "@reactive-agents/memory",
    "bun:sqlite",
    "chalk",
    "ora",
    "boxen",
  ],
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: process.env.CLEAN === "true" ? true : false,
  splitting: false,
  sourcemap: true,
  external: [
    "effect",
    "bun:sqlite",
    "@effect/platform",
    "@anthropic-ai/sdk",
    "openai",
    "@google/genai",
    /^@reactive-agents\//,
    // Node adapters — provided by Task 3 and resolved at runtime only
    "./adapters/node-database.js",
    "./adapters/node-process.js",
    "./adapters/node-server.js",
  ],
});

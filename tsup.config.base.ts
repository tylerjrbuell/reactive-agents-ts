import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  // Only clean on explicit 'clean' script, preserves incremental builds
  clean: process.env.CLEAN === "true" ? true : false,
  splitting: false,
  sourcemap: true,
  // Keep external so consumers resolve their own copies
  external: [
    "effect",
    "bun:sqlite",
    "@effect/platform",
    "@anthropic-ai/sdk",
    "openai",
    "@google/genai",
    /^@reactive-agents\//,
  ],
});

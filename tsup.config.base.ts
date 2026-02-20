import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
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
  ],
});

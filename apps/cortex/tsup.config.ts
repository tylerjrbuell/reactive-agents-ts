import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["server/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: [
    "elysia",
    "effect",
    "bun:sqlite",
    /^@reactive-agents\//,
    /^node:/,
  ],
});

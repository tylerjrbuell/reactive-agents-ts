// Invariant guard: hardcoded claude-* model ids in src/runtime.ts (terminal
// default-model fallback in createRuntime()/createLightRuntime() + JSDoc
// examples) must resolve to a static-table capability, and the terminal
// fallback must equal the anthropic provider default. Prevents drift to a
// retired id (404 class — claude-sonnet-4-20250514, retired 2026-06-15,
// survived #193 in this fallback path; v0.11.2 pre-tag audit).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getProviderDefaultModel,
  resolveCapability,
} from "@reactive-agents/llm-provider";

const SOURCE = readFileSync(
  resolve(import.meta.dir, "..", "src", "runtime.ts"),
  "utf-8",
);

describe("runtime default-model terminal fallback", () => {
  it("terminal fallback literal matches the anthropic provider default", () => {
    const anthropicDefault = getProviderDefaultModel("anthropic");
    expect(anthropicDefault).toBeTruthy();
    const fallbacks = [
      ...SOURCE.matchAll(/:\s*undefined\)\s*\|\|\s*"([^"]+)";/g),
    ].map((m) => m[1]);
    expect(fallbacks.length).toBeGreaterThanOrEqual(2); // both createRuntime + createLightRuntime
    expect(fallbacks.filter((id) => id !== anthropicDefault)).toEqual([]);
  });

  it("every hardcoded claude-* model id resolves to a static-table capability", () => {
    const literals = [...SOURCE.matchAll(/"(claude-[^"]+)"/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThanOrEqual(2);
    expect(
      literals.filter(
        (id) => resolveCapability("anthropic", id).source !== "static-table",
      ),
    ).toEqual([]);
  });
});

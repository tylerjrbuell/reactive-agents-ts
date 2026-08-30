// Run: bun test packages/reasoning/tests/kernel/stable-tool-surface.test.ts
//
// RED-ON-CUT: delete the stable-mode short-circuit in resolveToolSurface and
// cells 1, 3 and 4 fail.
import { describe, it, expect, afterEach } from "bun:test";
import {
  resolveToolSurface,
  type ToolSurfaceInputs,
} from "../../src/kernel/capabilities/reason/tool-surface.js";

import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";

const schema = (name: string, description: string): ToolSchema => ({
  name,
  description,
  parameters: [],
});

const SCHEMAS: readonly ToolSchema[] = [
  schema("file-read", "Read a file"),
  schema("file-write", "Write a file"),
  schema("web-search", "Search the web"),
  schema("code-execute", "Run code"),
];

const FINAL_ANSWER = schema("final-answer", "Give the final answer");

/**
 * A full `ToolSurfaceInputs`. Every required field is present — the interface
 * has 13 of them (`tool-surface.ts:150-167`) and omitting one produces a type
 * error, not a default. The explicit return annotation is what makes a typo in
 * a field name a compile error rather than a silently-ignored extra key.
 *
 * `pruneMinTools: 15` mirrors the kernel's `PRUNE_MIN_TOOLS` (`think.ts`), and
 * with only 4 schemas the non-lazy classification prune is BELOW that floor —
 * which is why cell 5 asserts on the lazy disclosure prune rather than the
 * non-lazy classifier one.
 */
function inputs(over: Partial<ToolSurfaceInputs> = {}): ToolSurfaceInputs {
  return {
    augmented: SCHEMAS,
    finalAnswerSchema: FINAL_ANSWER,
    lazyMode: true,
    pressureCritical: false,
    hasClassification: false,
    requiredTools: [],
    relevantTools: [],
    allowedTools: [],
    toolsUsed: [],
    discovered: [],
    gateBlockedTools: [],
    missingRequiredTools: [],
    pruneMinTools: 15,
    // Resolved fresh per call (not hoisted) so a test's `process.env.RA_*`
    // mutation just above is reflected — this file is specifically about
    // that env→config resolution, unlike production call sites which thread
    // one config resolved once at the run boundary.
    harness: resolveHarnessConfig(),
    ...over,
  };
}

afterEach(() => {
  delete process.env.RA_STABLE_TOOL_SURFACE;
});

describe("stable tool surface", () => {
  it("shows every permitted tool regardless of classification", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const out = resolveToolSurface(
      inputs({ hasClassification: true, relevantTools: ["file-read"], taskText: "read a file" }),
    );
    // A classifier verdict must not shrink the surface in stable mode -- that
    // shrinkage is exactly what breaks the cache prefix.
    expect(out.visible.map((t) => t.name).sort()).toEqual([
      "code-execute",
      "file-read",
      "file-write",
      "web-search",
    ]);
  });

  it("STILL removes contract-forbidden tools -- deny is correctness, not disclosure", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const out = resolveToolSurface(inputs({ forbiddenTools: ["code-execute"] }));
    // forbiddenTools is applied by `permitted()` into `augmented` BEFORE the
    // stable-mode short-circuit, so deny beats the caching flag by construction.
    expect(out.visible.map((t) => t.name)).not.toContain("code-execute");
    expect(out.universe.map((t) => t.name)).not.toContain("code-execute");
  });

  it("STILL removes gate-blocked tools", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const out = resolveToolSurface(inputs({ gateBlockedTools: ["web-search"] }));
    expect(out.visible.map((t) => t.name)).not.toContain("web-search");
  });

  it("is byte-stable across iterations that differ only in what was used", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const iter1 = resolveToolSurface(inputs({ toolsUsed: [] }));
    const iter2 = resolveToolSurface(inputs({ toolsUsed: ["file-read"] }));

    // The whole point: the FC tools array must not change between turns.
    expect(JSON.stringify(iter1.visible)).toBe(JSON.stringify(iter2.visible));
  });

  it("leaves the default path untouched when the flag is off", () => {
    const out = resolveToolSurface(
      inputs({ hasClassification: true, relevantTools: ["file-read"], taskText: "read a file" }),
    );
    // Default behaviour must be byte-identical -- every historical baseline was
    // measured on it. Under lazy mode with a classification naming one tool, the
    // visible set is narrower than the universe.
    expect(out.visible.length).toBeLessThan(SCHEMAS.length);
  });
});

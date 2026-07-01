// Run: bun test packages/reasoning/src/kernel/capabilities/reason/think-tool-name-display.test.ts
//
// P0 regression net (2026-06-04, prompt↔FC tool-name mismatch):
// The native-FC tools array sanitizes canonical MCP names (e.g.
// `github/list_commits` → `github_list_commits`) to satisfy the provider name
// regex. The in-prompt tool reference (buildToolReference/buildRules, rendered
// inside the project() systemPromptStage) MUST display that SAME sanitized name.
//
// 3-way bench, qwen3:14b BENCH N=5:
//   tool named `github/list_commits` → 0/5 NO_EMISSION
//   `github_list_commits`            → 5/5
//   `list_commits`                   → 5/5
// Trace: the model reads the slash name in the prompt, emits a <rationale>
// citing `github/list_commits`, then emits NO native call for the underscore
// FC name → end_turn → empty call → loop to max_iterations.
//
// buildThinkProviderRequest is the seam: think.ts:421 delegates the canonical
// project() assembly to it. The fix lives there (display-sanitize the schemas
// handed to project()), so a test on `.request.systemPrompt` drives the REAL
// wiring. The FC array (think.ts llmTools map) and the inbound de-sanitization
// map (think.ts:696, built from gatedToolSchemas) read the canonical schemas and
// are unaffected — the second test pins that the inbound registry path is intact.
//
// Co-located inside packages/reasoning/src/kernel/** (kernel-warden authority).

import { describe, it, expect } from "bun:test";
import { buildThinkProviderRequest } from "./think.js";
import { sanitizeToolName, buildSanitizedReverseMap } from "../attend/context-utils.js";
import { initialKernelState } from "../../state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import type { ToolSchema } from "../attend/tool-formatting.js";

const CANONICAL = "github/list_commits";
const SANITIZED = "github_list_commits";

const schema = (name: string): ToolSchema => ({
  name,
  description: `Tool ${name}`,
  parameters: [],
});

const baseState = () =>
  initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 });

describe("buildThinkProviderRequest — prompt tool-reference name display", () => {
  it("renders the SANITIZED tool name (underscore) in the system prompt, not the canonical slash name", () => {
    const { request } = buildThinkProviderRequest(
      baseState(),
      CONTEXT_PROFILES.local,
      "", // default tier persona
      [schema(CANONICAL)],
      "List the recent commits on the repo.",
    );
    // The prompt the model reads must carry the same name the FC array carries.
    expect(request.systemPrompt).toContain(SANITIZED);
    expect(request.systemPrompt).not.toContain(CANONICAL);
  });

  it("RA_LAZY_TOOLS=0 (RULES branch): the rules text also shows the sanitized name", () => {
    const prev = process.env.RA_LAZY_TOOLS;
    process.env.RA_LAZY_TOOLS = "0";
    try {
      const { request } = buildThinkProviderRequest(
        baseState(),
        CONTEXT_PROFILES.local,
        "",
        [schema(CANONICAL)],
        "List the recent commits on the repo.",
      );
      expect(request.systemPrompt).toContain(SANITIZED);
      expect(request.systemPrompt).not.toContain(CANONICAL);
    } finally {
      if (prev === undefined) delete process.env.RA_LAZY_TOOLS;
      else process.env.RA_LAZY_TOOLS = prev;
    }
  });
});

describe("inbound de-sanitization map — canonical registry lookup is intact", () => {
  // This is the EXACT construction at think.ts:696 (built from the canonical
  // schemas offered this turn). The display-only sanitize at the project() arg
  // must NOT change it: a returned FC name `github_list_commits` still maps back
  // to the registered canonical `github/list_commits` for registry lookup.
  it("maps the sanitized FC name back to the canonical registered name", () => {
    const canonicalSchemas = [schema(CANONICAL), schema("file-write")];
    const canonicalBySanitized = new Map(
      canonicalSchemas.map((ts) => [sanitizeToolName(ts.name), ts.name] as const),
    );
    expect(canonicalBySanitized.get(SANITIZED)).toBe(CANONICAL);
    // A name with no special chars is its own sanitized key (idempotent).
    expect(canonicalBySanitized.get("file-write")).toBe("file-write");
  });
});

describe("buildSanitizedReverseMap — collision detection", () => {
  it("builds a collision-free reverse map for distinct sanitized names", () => {
    const { map, collisions } = buildSanitizedReverseMap([CANONICAL, "file-write"]);
    expect(collisions).toEqual([]);
    expect(map.get(SANITIZED)).toBe(CANONICAL);
    expect(map.get("file-write")).toBe("file-write");
  });

  it("detects when two DISTINCT canonical names sanitize to the same key", () => {
    // `a.b` and `a/b` both sanitize to `a_b` — de-sanitization can no longer
    // recover which tool the model meant. This must be surfaced, not silent.
    const { map, collisions } = buildSanitizedReverseMap(["a.b", "a/b"]);
    expect(collisions.length).toBe(1);
    expect(collisions[0]).toEqual(["a.b", "a/b"]);
    // First registration wins deterministically (Map-ctor previously kept last).
    expect(map.get("a_b")).toBe("a.b");
  });

  it("does not flag exact duplicate registrations as collisions", () => {
    const { collisions } = buildSanitizedReverseMap(["a/b", "a/b"]);
    expect(collisions).toEqual([]);
  });
});

// Run: bun test packages/reasoning/src/kernel/capabilities/reason/think-prune.test.ts
//
// P0 regression net (2026-06-04, classifier-prunes-task-tool-rootcause):
// the RA_LAZY_TOOLS think-phase prune stranded caller-allowlisted domain tools
// and could prune the visible set down to META-only when domain tools existed.
//
// Pins two guarantees of computePromptSchemas:
//   1. FLOOR: input.allowedTools survives the prune in BOTH arms even when the
//      classifier (required/relevant) omits the tool and toolsUsed/discovered
//      are empty. Test isolates the floor by keeping a SEPARATE relevant tool
//      alive — so post-prune is NOT meta-only and the never-prune-to-meta guard
//      stays dormant; the ONLY thing that can save the allowlisted tool is the
//      floor itself.
//   2. NEVER-PRUNE-TO-META-ONLY: when the classifier omits the only domain tool
//      and no allowedTools is set, the guard restores the unpruned set.
//
// Co-located inside packages/reasoning/src/kernel/** (kernel-warden authority).

import { describe, it, expect } from "bun:test";
import { computePromptSchemas } from "./think.js";
import type { ToolSchema } from "../attend/tool-formatting.js";

const schema = (name: string): ToolSchema => ({
  name,
  description: name,
  parameters: [],
});

const names = (s: readonly ToolSchema[]) => s.map((t) => t.name).sort();

// A meta tool (in META_TOOLS) and domain tools.
const META = "recall"; // member of META_TOOLS
const D = "github/list_commits"; // caller-allowlisted domain tool, classifier-omitted
const R = "file-write"; // a domain tool the classifier kept relevant

describe("computePromptSchemas — allowedTools floor (Fix 1)", () => {
  it("lazy arm: allowlisted domain tool survives even when classifier omits it", () => {
    const effectiveSchemas = [schema(D), schema(R), schema(META)];
    const out = computePromptSchemas({
      effectiveSchemas,
      lazyMode: true,
      pressureCritical: false,
      hasClassification: true,
      classifiedRequired: [],
      classifiedRelevant: [R], // keeps R alive → post-prune NOT meta-only
      allowedTools: [D],        // the floor is the ONLY thing that can save D
      toolsUsed: new Set<string>(),
      discovered: [],
      pruneMinTools: 15,
    });
    // R survives via classifier → guard dormant. D survives ONLY via the floor.
    expect(names(out)).toContain(D);
    expect(names(out)).toContain(R);
  });

  it("non-lazy (RA_LAZY_TOOLS=0) arm: allowlisted tool survives the classification prune", () => {
    // > pruneMinTools to force the non-lazy classification filter to run.
    const domain = Array.from({ length: 20 }, (_, i) => schema(`tool-${i}`));
    const effectiveSchemas = [schema(D), schema(R), ...domain, schema(META)];
    const out = computePromptSchemas({
      effectiveSchemas,
      lazyMode: false,
      pressureCritical: false,
      hasClassification: true,
      classifiedRequired: [],
      classifiedRelevant: [R],
      allowedTools: [D],
      toolsUsed: new Set<string>(),
      discovered: [],
      pruneMinTools: 15,
    });
    expect(names(out)).toContain(D);
    expect(names(out)).toContain(R);
    // The non-allowlisted, non-classified domain tools are still pruned away.
    expect(names(out)).not.toContain("tool-0");
  });
});

describe("computePromptSchemas — never-prune-to-meta-only guard (Fix 2)", () => {
  it("restores the unpruned set when the classifier strands the only domain tool", () => {
    const effectiveSchemas = [schema(D), schema(META)];
    const out = computePromptSchemas({
      effectiveSchemas,
      lazyMode: true,
      pressureCritical: false,
      hasClassification: true,
      classifiedRequired: [],
      classifiedRelevant: [], // nothing classified → D would be pruned to meta-only
      allowedTools: [],       // no floor either
      toolsUsed: new Set<string>(),
      discovered: [],
      pruneMinTools: 15,
    });
    // Guard fires: D restored.
    expect(names(out)).toContain(D);
    expect(names(out)).toContain(META);
  });

  it("does NOT fire for legitimately pure-META tasks (0 domain tools pre-prune)", () => {
    const effectiveSchemas = [schema(META), schema("brief")];
    const out = computePromptSchemas({
      effectiveSchemas,
      lazyMode: true,
      pressureCritical: false,
      hasClassification: false,
      classifiedRequired: [],
      classifiedRelevant: [],
      allowedTools: [],
      toolsUsed: new Set<string>(),
      discovered: [],
      pruneMinTools: 15,
    });
    expect(names(out)).toEqual(["brief", META].sort());
  });

  it("does NOT fire under non-lazy pressureCritical final-answer-only narrowing", () => {
    // effectiveSchemas already narrowed to final-answer (a META tool) upstream;
    // pre-prune non-META count is 0 → guard precondition false → no spurious restore.
    const effectiveSchemas = [schema("final-answer")];
    const out = computePromptSchemas({
      effectiveSchemas,
      lazyMode: false,
      pressureCritical: true,
      hasClassification: false,
      classifiedRequired: [],
      classifiedRelevant: [],
      allowedTools: [],
      toolsUsed: new Set<string>(),
      discovered: [],
      pruneMinTools: 15,
    });
    expect(names(out)).toEqual(["final-answer"]);
  });
});

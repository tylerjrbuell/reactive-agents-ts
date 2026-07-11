// Run: bun test packages/runtime/tests/api-correspondence.test.ts
//
// THE SELF-MAINTENANCE DRIFT-GATE for the dual API (spec §4a/§4b).
//
// The fluent surface (builder withers) and the declarative surface
// (AgentConfigSchema) are two projections of ONE source. These two assertions
// make them stay equipotent — drift becomes impossible to merge:
//
//   (a) Every declared `configKey` resolves to a real schema leaf.
//       MUTATION PROOF: rename a schema field (or point a wither's configKey at
//       a key the schema does not contain) → `orphanKeys` non-empty → RED.
//       Verified below with an injected bogus key.
//
//   (b) Every non-plumbing schema leaf is reachable by ≥1 wither OR the
//       declarative-only escape set (CONFIG_ONLY_KEYS).
//       MUTATION PROOF: add a schema field with no covering wither (or drop a
//       wither's configKey) → `orphanLeaves` non-empty → RED.
//       Verified below by shrinking the covering-key set.
import { describe, it, expect } from "bun:test";
import {
  deriveCorrespondence,
  correspondenceCoverage,
  keyResolves,
  leafCovered,
  orphanLeaves,
} from "../src/capability/api-correspondence.js";
import { deriveConfigFields } from "../src/capability/config-fields.js";

describe("dual-API correspondence drift-gate", () => {
  it("(a) every declared configKey resolves to a real AgentConfigSchema leaf", () => {
    const rows = deriveCorrespondence();
    const bad = rows
      .filter((r) => r.orphanKeys.length > 0)
      .map((r) => `${r.wither} → [${r.orphanKeys.join(", ")}]`);
    expect(bad, `withers claiming non-existent config keys:\n${bad.join("\n")}`).toEqual([]);
  });

  it("(b) every non-plumbing schema leaf is reachable by ≥1 wither (no orphans)", () => {
    const orphans = orphanLeaves();
    expect(
      orphans,
      `schema leaves no fluent wither can set (declarative-only?):\n${orphans.join("\n")}`,
    ).toEqual([]);
  });

  it("reports full coverage: every leaf mapped, no orphan keys", () => {
    const c = correspondenceCoverage();
    expect(c.schemaLeaves).toBeGreaterThan(0);
    expect(c.coveredLeaves).toBe(c.schemaLeaves);
    expect(c.orphanLeaves).toEqual([]);
    expect(c.orphanKeys).toEqual([]);
    // Every config-kind wither declares ≥1 key; overlays declare none.
    for (const r of deriveCorrespondence()) {
      if (r.overlay) expect(r.configKeys.length).toBe(0);
      else expect(r.configKeys.length).toBeGreaterThan(0);
    }
  });

  // ── Mutation proofs: prove the gate goes RED when the wiring is cut. ──

  it("MUTATION (a): a wither pointing at a non-existent schema key is caught", () => {
    const leafPaths = new Set(deriveConfigFields().map((f) => f.path));
    // A real subtree prefix resolves; a fabricated key does not.
    expect(keyResolves("memory", leafPaths)).toBe(true);
    expect(keyResolves("memory.tier", leafPaths)).toBe(true);
    expect(keyResolves("memory.doesNotExist", leafPaths)).toBe(false);
    expect(keyResolves("totallyBogusKey", leafPaths)).toBe(false);
  });

  it("MUTATION (b): a schema leaf loses coverage if its wither drops the key", () => {
    const allKeys = new Set<string>();
    for (const r of deriveCorrespondence()) for (const k of r.configKeys) allKeys.add(k);
    // With the full key set, a memory leaf is covered.
    expect(leafCovered("memory.tier", allKeys)).toBe(true);
    // Simulate dropping withMemory's "memory" key: the leaf becomes an orphan.
    const shrunk = new Set([...allKeys].filter((k) => k !== "memory"));
    expect(leafCovered("memory.tier", shrunk)).toBe(false);
  });
});

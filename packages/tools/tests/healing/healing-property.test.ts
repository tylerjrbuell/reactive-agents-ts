// Run: bun test packages/tools/tests/healing/healing-property.test.ts --timeout 30000
//
// PROPERTY tests for the tool-call healing pipeline — the recovery surface that
// runs on EVERY model-emitted tool call (wrong name, aliased params, path args).
// It is fed untrusted LLM output, so its load-bearing invariant is robustness:
// it must never throw, whatever garbage a weak model emits. Example-based tests
// cover the known typo cases; these properties cover the inputs nobody imagined.
import { describe, it, expect } from "bun:test";
import fc from "fast-check";
import { runHealingPipeline } from "../../src/healing/healing-pipeline.js";
import type { ToolCallSpec } from "../../src/tool-calling/types.js";

const REGISTRY = [
  { name: "web-search", description: "search", parameters: [{ name: "query", type: "string", required: true }] },
  { name: "file-read", description: "read", parameters: [{ name: "path", type: "string", required: true }] },
];

const arbArgs = fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean()), { maxKeys: 6 });

describe("runHealingPipeline — property invariants", () => {
  it("never throws and returns a well-formed result for ANY call name + args", () => {
    fc.assert(
      fc.property(fc.string(), arbArgs, (name, args) => {
        const call: ToolCallSpec = { id: "1", name, arguments: args };
        const result = runHealingPipeline(call, REGISTRY, new Set(["file-read"]), "/tmp", {}, {});
        // INVARIANTS: always a structured result; boolean success; on success the
        // resolved name is a registered tool (never an invented one).
        expect(typeof result.succeeded).toBe("boolean");
        expect(Array.isArray(result.actions)).toBe(true);
        if (result.succeeded) {
          expect(REGISTRY.map((t) => t.name)).toContain(result.call.name);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("is robust to adversarial unicode / whitespace / control-char tool names", () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (name) => {
        const call: ToolCallSpec = { id: "1", name, arguments: {} };
        // The only contract here is: do not throw. Resolution may legitimately fail.
        expect(() =>
          runHealingPipeline(call, REGISTRY, new Set(), "/tmp", {}, {}),
        ).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});

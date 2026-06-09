import { describe, test, expect } from "bun:test";
import { syncVariables, sameVariableNames } from "./sync-variables.js";
import type { VariableDef } from "../types/agent-config.js";

const v = (o: Partial<VariableDef> & { name: string }): VariableDef => ({
  type: "string",
  required: true,
  ...o,
});

// Identity wrapper so config object literals (with arbitrary string fields) are
// accepted without tripping TS excess-property checks at the call site.
const cfg = (o: Record<string, unknown> & { variables?: VariableDef[] }) => o;

describe("syncVariables", () => {
  test("adds a detected token as a required string", () => {
    const out = syncVariables(cfg({ prompt: "Research {{topic}}", variables: [] }));
    expect(out).toEqual([{ name: "topic", type: "string", required: true }]);
  });

  test("preserves existing enrichment by name", () => {
    const existing = v({ name: "topic", type: "enum", enumValues: ["a", "b"], default: "a" });
    const out = syncVariables(cfg({ prompt: "On {{topic}}", variables: [existing] }));
    expect(out).toEqual([existing]);
  });

  test("drops a variable whose token is no longer present", () => {
    const out = syncVariables(cfg({
      prompt: "Only {{topic}} now",
      variables: [v({ name: "topic" }), v({ name: "audience" })],
    }));
    expect(out.map((x) => x.name)).toEqual(["topic"]);
  });

  test("scans across multiple fields and dedupes", () => {
    const out = syncVariables(cfg({
      prompt: "{{a}} and {{b}}",
      systemPrompt: "tone {{b}}",
      taskContext: { note: "{{c}}" },
      variables: [],
    }));
    expect(out.map((x) => x.name)).toEqual(["a", "b", "c"]);
  });

  test("ignores the reserved secret. namespace", () => {
    const out = syncVariables(cfg({ prompt: "Use {{secret.KEY}} and {{topic}}", variables: [] }));
    expect(out.map((x) => x.name)).toEqual(["topic"]);
  });

  test("returns empty when no tokens present", () => {
    expect(syncVariables(cfg({ prompt: "plain text", variables: [v({ name: "stale" })] }))).toEqual([]);
  });
});

describe("sameVariableNames", () => {
  test("true for same names in same order", () => {
    expect(sameVariableNames([v({ name: "a" }), v({ name: "b" })], [v({ name: "a" }), v({ name: "b" })])).toBe(true);
  });
  test("false on different length", () => {
    expect(sameVariableNames([v({ name: "a" })], [v({ name: "a" }), v({ name: "b" })])).toBe(false);
  });
  test("false on different names", () => {
    expect(sameVariableNames([v({ name: "a" })], [v({ name: "b" })])).toBe(false);
  });
  test("true regardless of enrichment differences (compares names only)", () => {
    expect(sameVariableNames([v({ name: "a", type: "number" })], [v({ name: "a", type: "string" })])).toBe(true);
  });
});

// Closed value sets live in `enum`, never only in description prose.
//
// Compact (local-tier) profiles drop parameter descriptions from the wire and
// keep `enum` (reasoning wire-parameter-schema.ts). A value set written only in
// prose is therefore invisible there: trace 01M744TPCB87CHKCDPE964YBAP had a
// model call todo with action "Plan and execute a multi-part research project"
// because the wire said only `action: string`.
//
// RED-ON-CUT: delete `enum` from todo's `action` parameter and both the pin and
// the registry guard fail.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import * as tools from "../src/index.js";
import { builtinTools, findToolFor, toParameterJsonSchema, todoTool, validateToolInput } from "../src/index.js";
import { finalAnswerTool } from "../src/skills/final-answer.js";
import type { ToolDefinition } from "../src/types.js";

/** The compact-profile rule (reasoning buildWireParameterSchema): description dropped, the rest kept. */
const compactWire = (p: ToolDefinition["parameters"][number]): Record<string, unknown> => {
  const { description: _dropped, ...rest } = toParameterJsonSchema(p);
  return rest;
};

const isToolDefinition = (v: unknown): v is ToolDefinition =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { name?: unknown }).name === "string" &&
  Array.isArray((v as { parameters?: unknown }).parameters);

/** Every built-in and meta tool definition the package exports, plus the no-web find variant. */
const registry = (): readonly ToolDefinition[] => {
  const all = [
    ...Object.values(tools).filter(isToolDefinition),
    ...builtinTools.map((t) => t.definition),
    findToolFor({ web: false }),
  ];
  const seen = new Set<string>();
  return all.filter((d) => {
    const key = `${d.name}:${d.parameters.map((p) => p.name).join(",")}:${JSON.stringify(d.parameters.map((p) => p.enum))}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Example clauses ("e.g., 'plan', 'findings'", "Examples: './a', './b'") list
// open samples, not a closed set; they are removed before the scan.
const EXAMPLE_CLAUSE = /(?:e\.g\.,?|examples?:)[^)]*\)?/gi;
const CLOSED_ALTERNATIVES: readonly RegExp[] = [
  // a | b | c
  /[\w-]+\s*\|\s*[\w-]+\s*\|\s*[\w-]+/,
  // one of ...
  /\bone of\b/i,
  // 'a', 'b', or 'c' (each item may carry a parenthetical note)
  /(['"])[\w-]+\1(?:\s*\([^)]*\))?(?:\s*,\s*(?:or\s+)?(['"])[\w-]+\2(?:\s*\([^)]*\))?){2,}/,
];

const listsClosedAlternatives = (description: string): boolean => {
  const scanned = description.replace(EXAMPLE_CLAUSE, "");
  return CLOSED_ALTERNATIVES.some((re) => re.test(scanned));
};

describe("tool value sets — seam", () => {
  it("todo action carries its full enum on a compact-profile wire", () => {
    const action = todoTool.parameters.find((p) => p.name === "action");
    expect(action).toBeDefined();
    const wire = compactWire(action!);
    expect(wire.description).toBeUndefined();
    expect(wire.enum).toEqual(["add", "start", "done", "reopen", "edit", "remove", "clear", "patch", "list"]);
  });

  it("the closed-alternatives detector fires on prose value sets and not on open examples", () => {
    expect(listsClosedAlternatives("add | start | done | list")).toBe(true);
    expect(listsClosedAlternatives("Your confidence in the result: 'high', 'medium', or 'low'")).toBe(true);
    expect(listsClosedAlternatives("'links' (direct neighbors, default), 'traverse' (multi-hop), or 'link' (create)")).toBe(true);
    expect(listsClosedAlternatives("The type is one of the supported kinds.")).toBe(true);
    expect(listsClosedAlternatives("Note identifier (e.g., 'plan', 'findings', 'step-3-result')")).toBe(false);
    expect(listsClosedAlternatives("Optional focus question: 'am I ready to answer?' | 'should I change approach?'")).toBe(false);
    expect(listsClosedAlternatives("Examples: 'function\\s+handleClick', 'TODO', 'export (const|function) grepTool'.")).toBe(false);
  });

  it("no built-in or meta tool lists a closed value set in prose without an enum", () => {
    const defs = registry();
    const names = new Set(defs.map((d) => d.name));
    for (const expected of ["todo", "find", "relate", "brief", "final-answer", "rag-ingest"]) {
      expect(names.has(expected)).toBe(true);
    }
    const offenders = defs.flatMap((d) =>
      d.parameters
        .filter((p) => p.type === "string" && p.enum === undefined && listsClosedAlternatives(p.description))
        .map((p) => `${d.name}.${p.name}: ${p.description}`),
    );
    expect(offenders).toEqual([]);
  });

  it("every enum alias targets a value in its enum", () => {
    for (const d of registry()) {
      for (const p of d.parameters) {
        for (const target of Object.values(p.aliases ?? {})) {
          expect(p.enum ?? []).toContain(target);
        }
      }
    }
  });
});

describe("input validator heals near-miss enum values", () => {
  const find = findToolFor();
  const validate = (def: ToolDefinition, args: Record<string, unknown>) =>
    Effect.runPromise(validateToolInput(def, args).pipe(Effect.either));

  it("a declared alias is rewritten to its canonical value", async () => {
    const r = await validate(find, { query: "q", scope: "internet" });
    expect(r._tag === "Right" && r.right.scope).toBe("web");
  });

  it("a case/whitespace variant is rewritten to its canonical value", async () => {
    const r = await validate(find, { query: "q", scope: " Documents " });
    expect(r._tag === "Right" && r.right.scope).toBe("documents");
    const f = await validate(finalAnswerTool, { output: "x", format: "MD", summary: "s", confidence: "Med" });
    expect(f._tag === "Right" && f.right.format).toBe("markdown");
    expect(f._tag === "Right" && f.right.confidence).toBe("medium");
  });

  it("an unknown value still fails, and an alias whose target is off-enum is not applied", async () => {
    expect((await validate(find, { query: "q", scope: "bogus" }))._tag).toBe("Left");
    // No web source: 'web' is not in the enum, so the 'internet' -> 'web' alias cannot apply.
    expect((await validate(findToolFor({ web: false }), { query: "q", scope: "internet" }))._tag).toBe("Left");
  });
});

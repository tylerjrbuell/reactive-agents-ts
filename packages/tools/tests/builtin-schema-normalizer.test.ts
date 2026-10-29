// Pins the provider tool-schema normalizer against the REAL built-in tool
// definitions (the llm-provider unit test can only use fixtures because tools
// depends on llm-provider). Wire conversion mirrors think.ts `llmTools`.
import { describe, it, expect } from "bun:test";
import {
  normalizeToolSchema,
  isStrictCompatible,
  type ToolJSONSchema,
} from "../../llm-provider/src/schema-utils.js";
import { builtinTools, metaToolDefinitions } from "../src/skills/builtin.js";
import { todoTool } from "../src/skills/todo.js";
import type { ToolDefinition } from "../src/types.js";

const definitions: ReadonlyArray<ToolDefinition> = [
  ...builtinTools.map((t) => t.definition),
  ...metaToolDefinitions,
  todoTool,
];

/** Same shape think.ts builds for the provider `tools:` array. */
const toWireSchema = (ts: ToolDefinition, defaultItems = true): Record<string, unknown> => ({
  type: "object",
  properties: Object.fromEntries(
    (ts.parameters ?? []).map((p) => [
      p.name,
      {
        type: p.type ?? "string",
        description: p.description,
        ...(p.type === "array" && defaultItems ? { items: p.items ?? { type: "string" } } : {}),
        ...(p.enum ? { enum: p.enum } : {}),
      },
    ]),
  ),
  required: (ts.parameters ?? []).filter((p) => p.required).map((p) => p.name),
});

const arraysMissingItems = (node: unknown, path = ""): string[] => {
  if (typeof node !== "object" || node === null) return [];
  const rec = node as Record<string, unknown>;
  const out: string[] = [];
  if (rec.type === "array" && rec.items === undefined) out.push(path || "<root>");
  for (const [k, v] of Object.entries(rec)) {
    if (Array.isArray(v)) v.forEach((c, i) => out.push(...arraysMissingItems(c, `${path}.${k}.${i}`)));
    else out.push(...arraysMissingItems(v, `${path}.${k}`));
  }
  return out;
};

/** Pinned strict-compat verdict per tool; a schema change must update this on purpose. */
/** Only known benign repair: http-get `headers` is a bare object (gets `properties: {}`). */
const EXPECTED_REPAIRS: Record<string, readonly { path: string; kind: string }[]> = {
  "http-get": [{ path: "properties.headers", kind: "object-properties" }],
};

const STRICT_VERDICTS: Record<string, boolean> = {
  "brief": true,
  "checkpoint": true,
  "code-execute": true,
  "context-status": true,
  "crypto-price": true,
  "discover-tools": true,
  "file-edit": true,
  "file-read": true,
  "file-write": true,
  "final-answer": true,
  "find": true,
  "gh-cli": true,
  "git-cli": true,
  "grep": true,
  "gws-cli": true,
  "http-get": true,
  "list-directory": true,
  "pulse": true,
  "recall": true,
  "relate": true,
  "todo": true,
  "web-search": true,
};

describe("built-in tool schemas through the provider normalizer", () => {
  it("covers the expected tool set", () => {
    expect(definitions.length).toBe(22);
  });

  for (const def of definitions) {
    it(`${def.name}: idempotent, array items present, repairs pinned`, () => {
      const wire = toWireSchema(def);
      const first = normalizeToolSchema(wire);
      const second = normalizeToolSchema(first.schema);
      expect(second.schema).toEqual(first.schema);
      expect(second.repairs).toEqual([]);
      expect(first.repairs).toEqual(EXPECTED_REPAIRS[def.name] ?? []);
      expect(arraysMissingItems(first.schema)).toEqual([]);
    });
  }

  it("normalizer alone guarantees array items even without the think.ts default", () => {
    for (const def of definitions) {
      const { schema } = normalizeToolSchema(toWireSchema(def, false));
      expect(arraysMissingItems(schema)).toEqual([]);
    }
  });

  it("pins strict-compat verdict per tool", () => {
    const verdicts = Object.fromEntries(
      definitions.map((d) => [
        d.name,
        isStrictCompatible(normalizeToolSchema(toWireSchema(d)).schema as ToolJSONSchema),
      ]),
    );
    expect(verdicts).toEqual(STRICT_VERDICTS);
  });
});

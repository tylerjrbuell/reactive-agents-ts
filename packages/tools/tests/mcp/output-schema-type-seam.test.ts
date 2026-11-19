// Run: bun test packages/tools/tests/mcp/output-schema-type-seam.test.ts --timeout 30000
//
// An MCP tool's declared `outputSchema` becomes the registered tool's
// `returnType`, so code-action bindings render `Returns: <type>` and the model
// stops guessing result shapes (`websites[0].websiteId`, `.results`) on its
// first attempt. Tools without an outputSchema keep `returnType` unset.
//
// RED-ON-CUT: drop the `returnType` spread in tool-service.ts connectMCPServer
// (or the `outputSchema` pass-through in toMCPToolSchemaEntry) and the
// integration case fails.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { join } from "node:path";

import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../../src/tool-service.js";
import {
  jsonSchemaToTypeString,
  OUTPUT_TYPE_MAX_LENGTH,
} from "../../src/mcp/output-schema-type.js";
import { toMCPToolSchemaEntry } from "../../src/mcp/read-only-classification.js";

const FIXTURE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "runtime",
  "tests",
  "fixtures",
  "annotated-stdio-mcp-server.ts",
);

const obj = (properties: Record<string, unknown>, required: readonly string[] = []) => ({
  type: "object",
  properties,
  required,
});

describe("jsonSchemaToTypeString", () => {
  it("renders an object with required and optional keys", () => {
    expect(
      jsonSchemaToTypeString(obj({ id: { type: "string" }, count: { type: "integer" }, ok: { type: "boolean" } }, ["id"])),
    ).toBe("{ id: string; count?: number; ok?: boolean }");
  });

  it("renders arrays of objects", () => {
    const schema = obj(
      { websites: { type: "array", items: obj({ id: { type: "string" }, name: { type: "string" } }, ["id", "name"]) } },
      ["websites"],
    );
    expect(jsonSchemaToTypeString(schema)).toBe("{ websites: { id: string; name: string }[] }");
  });

  it("renders enums, const, nullable type arrays and anyOf as unions", () => {
    const schema = obj(
      {
        status: { enum: ["up", "down"] },
        kind: { const: "site" },
        note: { type: ["string", "null"] },
        value: { anyOf: [{ type: "number" }, { type: "array", items: { type: "string" } }] },
        tags: { type: "array", items: { enum: ["a", "b"] } },
      },
      ["status", "kind", "note", "value", "tags"],
    );
    expect(jsonSchemaToTypeString(schema)).toBe(
      '{ status: "up" | "down"; kind: "site"; note: string | null; value: number | string[]; tags: ("a" | "b")[] }',
    );
  });

  it("quotes non-identifier keys and renders maps and bare objects", () => {
    const schema = obj(
      { "page-views": { type: "number" }, byCountry: { type: "object", additionalProperties: { type: "number" } }, raw: { type: "object" } },
      ["page-views", "byCountry", "raw"],
    );
    expect(jsonSchemaToTypeString(schema)).toBe('{ "page-views": number; byCountry: Record<string, number>; raw: object }');
  });

  it("caps nesting at depth 3 with { ... }", () => {
    const deep = obj({ a: obj({ b: obj({ c: obj({ d: { type: "string" } }, ["d"]) }, ["c"]) }, ["b"]) }, ["a"]);
    expect(jsonSchemaToTypeString(deep)).toBe("{ a: { b: { c: { ... } } } }");
    expect(jsonSchemaToTypeString(deep, { maxDepth: 1 })).toBe("{ a: { ... } }");
  });

  it("stays within the length cap on a wide schema by shrinking depth, then keys", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      wide[`field_${i}`] = obj({ inner: obj({ leaf: { type: "string" } }) });
    }
    const out = jsonSchemaToTypeString(obj(wide));
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(OUTPUT_TYPE_MAX_LENGTH);
    expect(out!.startsWith("{ field_0?:")).toBe(true);
    expect(out!.includes("...")).toBe(true);
  });

  it("never throws on garbage and omits a type that says nothing", () => {
    const cyclic: Record<string, unknown> = { type: "array" };
    cyclic.items = cyclic;
    for (const bad of [undefined, null, 42, "object", [], [1, 2], {}, { type: 7 }, { anyOf: "x" }, { $ref: "#/defs/A" }]) {
      expect(jsonSchemaToTypeString(bad)).toBeUndefined();
    }
    expect(() => jsonSchemaToTypeString(cyclic)).not.toThrow();
    expect(jsonSchemaToTypeString({ type: "object", properties: { x: { type: "mystery" } } })).toBe("{ x?: unknown }");
  });
});

describe("toMCPToolSchemaEntry outputSchema pass-through", () => {
  it("keeps an object outputSchema and drops non-object ones", () => {
    const schema = obj({ id: { type: "string" } });
    expect(toMCPToolSchemaEntry({ name: "t", outputSchema: schema }).outputSchema).toEqual(schema);
    expect("outputSchema" in toMCPToolSchemaEntry({ name: "t", outputSchema: "nope" })).toBe(false);
    expect("outputSchema" in toMCPToolSchemaEntry({ name: "t" })).toBe(false);
  });
});

describe("MCP outputSchema -> ToolDefinition.returnType (stdio integration)", () => {
  it("maps the declared outputSchema; tools without one stay unset", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const tools = yield* ToolService;
        yield* tools.connectMCPServer({ name: "fx", transport: "stdio", command: "bun", args: [FIXTURE] });
        const sites = yield* tools.getTool("fx/sites");
        const echo = yield* tools.getTool("fx/echo");
        const call = yield* tools.execute({ toolName: "fx/sites", arguments: {}, agentId: "a", sessionId: "s" });
        yield* tools.disconnectMCPServer("fx");
        return { sites, echo, call };
      }).pipe(Effect.provide(ToolServiceLive.pipe(Layer.provide(EventBusLive)))),
    );

    expect(result.sites.returnType).toBe(
      "{ websites: { id: string; name: string; domain?: string }[]; total: number }",
    );
    expect(result.sites.returnType!.length).toBeLessThanOrEqual(OUTPUT_TYPE_MAX_LENGTH);
    expect(result.echo.returnType).toBeUndefined();
    // The value the code-action sandbox parses has the declared shape.
    expect(JSON.parse(String(result.call.result))).toEqual({
      websites: [{ id: "w1", name: "docs", domain: "example.org" }],
      total: 1,
    });
  }, 30_000);
});

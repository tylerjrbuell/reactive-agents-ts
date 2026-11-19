import { Effect, Layer, Schema } from "effect";
import { describe, it, expect } from "bun:test";

import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../../src/tool-service.js";
import { defineTool } from "../../src/define-tool.js";
import { isReadOnlyTool, toolEffect, type ToolEffect } from "../../src/read-only.js";
import type { ToolDefinition } from "../../src/types.js";
import { classifyMCPToolMutation } from "../../src/mcp/read-only-classification.js";

const TestToolLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

const SERVER_TOOLS = [
  { name: "lookup", annotations: { readOnlyHint: true } },
  { name: "wipe", annotations: { readOnlyHint: true, destructiveHint: true } },
  { name: "browse", annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "plain" },
  { name: "write_it", annotations: { readOnlyHint: false } },
  { name: "post_web", annotations: { readOnlyHint: false, openWorldHint: true } },
].map((t) => ({ ...t, description: t.name, inputSchema: { type: "object", properties: {} } }));

const withStub = async <T>(run: (endpoint: string) => Promise<T>): Promise<T> => {
  const server = Bun.serve({
    port: 0,
    idleTimeout: 5,
    fetch(req) {
      if (req.method !== "POST") return new Response("Not Found", { status: 404 });
      return req.json().then((body: { id: unknown; method: string }) => {
        if (body.method === "initialize") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "stub", version: "1.0.0" },
            },
          });
        }
        if (body.method === "tools/list") {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: SERVER_TOOLS } });
        }
        return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
      });
    },
  });
  try {
    return await run(`http://localhost:${server.port}/mcp`);
  } finally {
    server.stop(true);
  }
};

type Extra = { readOnly?: boolean | readonly string[]; trustAnnotations?: boolean };

/** Connect stub with extra config; return `{ toolName: isReadOnlyTool }`. */
const readOnlyMap = (endpoint: string, extra: Extra): Promise<Record<string, boolean>> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.connectMCPServer({
        name: "s",
        transport: "streamable-http",
        endpoint,
        ...extra,
      });
      const out: Record<string, boolean> = {};
      for (const t of SERVER_TOOLS) {
        const def: ToolDefinition = yield* tools.getTool(`s/${t.name}`);
        out[t.name] = isReadOnlyTool(def);
      }
      return out;
    }).pipe(Effect.provide(TestToolLayer)),
  );

describe("defineTool mutatesExternalState", () => {
  const base = {
    name: "lookup",
    description: "d",
    input: Schema.Struct({ q: Schema.String }),
    handler: async () => "ok",
  };

  it("round-trips false into the definition and isReadOnlyTool", () => {
    const { definition } = defineTool({ ...base, mutatesExternalState: false });
    expect(definition.mutatesExternalState).toBe(false);
    expect(isReadOnlyTool(definition)).toBe(true);
  });

  it("omitted stays unclassified (not read-only)", () => {
    const { definition } = defineTool(base);
    expect("mutatesExternalState" in definition).toBe(false);
    expect(isReadOnlyTool(definition)).toBe(false);
  });

  it("true and requiresApproval both block read-only", () => {
    expect(isReadOnlyTool(defineTool({ ...base, mutatesExternalState: true }).definition)).toBe(false);
    expect(
      isReadOnlyTool(defineTool({ ...base, mutatesExternalState: false, requiresApproval: true }).definition),
    ).toBe(false);
  });
});

describe("MCP read-only marking (integration)", () => {
  it("default config: nothing is read-only, even with readOnlyHint", async () => {
    await withStub(async (ep) => {
      const m = await readOnlyMap(ep, {});
      expect(Object.values(m).every((v) => v === false)).toBe(true);
    });
  });

  it("untrusted server: readOnlyHint ignored", async () => {
    await withStub(async (ep) => {
      const m = await readOnlyMap(ep, { trustAnnotations: false });
      expect(m["lookup"]).toBe(false);
    });
  });

  it("trusted server: readOnlyHint honored; destructive/openWorld/unhinted/false are not", async () => {
    await withStub(async (ep) => {
      const m = await readOnlyMap(ep, { trustAnnotations: true });
      expect(m).toEqual({
        lookup: true,
        wipe: false,
        browse: false,
        plain: false,
        write_it: false,
        post_web: false,
      });
    });
  });

  it("per-tool list marks only listed names; destructive hint still wins", async () => {
    await withStub(async (ep) => {
      const m = await readOnlyMap(ep, { readOnly: ["plain", "wipe"] });
      expect(m).toEqual({
        lookup: false,
        wipe: false,
        browse: false,
        plain: true,
        write_it: false,
        post_web: false,
      });
    });
  });

  it("readOnly: true marks all tools except destructive/openWorld/readOnlyHint:false", async () => {
    await withStub(async (ep) => {
      const m = await readOnlyMap(ep, { readOnly: true });
      expect(m).toEqual({
        lookup: true,
        wipe: false,
        browse: false,
        plain: true,
        write_it: false,
        post_web: false,
      });
    });
  });
});

describe("classifyMCPToolMutation (seam)", () => {
  it("read (false) needs the trust gate; only narrowing hints yield write (true)", () => {
    expect(classifyMCPToolMutation({}, "t", { readOnlyHint: true })).toBeUndefined();
    expect(classifyMCPToolMutation({ trustAnnotations: true }, "t", { readOnlyHint: true })).toBe(false);
    expect(classifyMCPToolMutation({ trustAnnotations: true }, "t", undefined)).toBeUndefined();
    // Narrowing hints are honored without trust.
    expect(classifyMCPToolMutation({}, "t", { readOnlyHint: false })).toBe(true);
    expect(classifyMCPToolMutation({}, "t", { destructiveHint: true })).toBe(true);
    expect(classifyMCPToolMutation({ readOnly: true }, "t", { destructiveHint: true })).toBe(true);
    expect(classifyMCPToolMutation({ trustAnnotations: true }, "t", { readOnlyHint: false })).toBe(true);
    // openWorld alone is not a write claim.
    expect(classifyMCPToolMutation({ readOnly: true }, "t", { openWorldHint: true })).toBeUndefined();
  });

  it("precedence: write signals beat openWorld and operator read-only; openWorld beats read-only", () => {
    // A server that says it writes is believed, even when it also reaches the open world.
    expect(classifyMCPToolMutation({}, "t", { readOnlyHint: false, openWorldHint: true })).toBe(true);
    expect(classifyMCPToolMutation({}, "t", { destructiveHint: true, openWorldHint: true })).toBe(true);
    expect(
      classifyMCPToolMutation({ trustAnnotations: true }, "t", { readOnlyHint: false, openWorldHint: true }),
    ).toBe(true);
    // ...and beats an operator read-only promise (annotations only narrow).
    expect(classifyMCPToolMutation({ readOnly: true }, "t", { readOnlyHint: false })).toBe(true);
    expect(classifyMCPToolMutation({ readOnly: ["t"] }, "t", { readOnlyHint: false })).toBe(true);
    // openWorld still blocks a read classification (fail closed to unknown).
    expect(
      classifyMCPToolMutation({ trustAnnotations: true }, "t", { readOnlyHint: true, openWorldHint: true }),
    ).toBeUndefined();
    expect(classifyMCPToolMutation({ readOnly: ["t"] }, "t", { openWorldHint: true })).toBeUndefined();
    // No annotations, no declaration: unknown.
    expect(classifyMCPToolMutation({}, "t", undefined)).toBeUndefined();
  });
});

describe("tool effect (read | write | unknown)", () => {
  const effectMap = (endpoint: string, extra: Extra): Promise<Record<string, ToolEffect>> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const tools = yield* ToolService;
        yield* tools.connectMCPServer({ name: "s", transport: "streamable-http", endpoint, ...extra });
        const out: Record<string, ToolEffect> = {};
        for (const t of SERVER_TOOLS) out[t.name] = toolEffect(yield* tools.getTool(`s/${t.name}`));
        return out;
      }).pipe(Effect.provide(TestToolLayer)),
    );

  it("trusted server: annotated read tool is read, unannotated is unknown, write hints are write", async () => {
    await withStub(async (ep) => {
      expect(await effectMap(ep, { trustAnnotations: true })).toEqual({
        lookup: "read",
        wipe: "write",
        browse: "unknown",
        plain: "unknown",
        write_it: "write",
        post_web: "write",
      });
    });
  });

  it("untrusted server: a readOnlyHint never yields read (unknown), write hints still write", async () => {
    await withStub(async (ep) => {
      const m = await effectMap(ep, {});
      expect(m["lookup"]).toBe("unknown");
      expect(m["wipe"]).toBe("write");
      expect(m["write_it"]).toBe("write");
      expect(m["post_web"]).toBe("write");
      expect(m["plain"]).toBe("unknown");
    });
  });

  it("toolEffect: custom defineTool declares effect; approval-gated read is unknown", () => {
    const base = {
      name: "list_websites",
      description: "d",
      input: Schema.Struct({}),
      handler: async () => "ok",
    };
    expect(toolEffect(defineTool({ ...base, mutatesExternalState: false }).definition)).toBe("read");
    expect(toolEffect(defineTool({ ...base, mutatesExternalState: true }).definition)).toBe("write");
    expect(toolEffect(defineTool(base).definition)).toBe("unknown");
    expect(
      toolEffect(defineTool({ ...base, mutatesExternalState: false, requiresApproval: true }).definition),
    ).toBe("unknown");
  });
});

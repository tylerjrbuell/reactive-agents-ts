// Seam pin: validation/input-validator.ts normalizeToolArguments + its
// ToolService.execute wiring.
//
// 2026-11-19: a Cortex code-action run failed 10 iterations straight with
// "undefined is not an object (evaluating Object.keys(args))". The model called
// a zero-argument MCP tool as `umami_list_websites()`, the code-action sandbox
// forwarded `arguments: undefined`, and the validator called Object.keys on it.
// A zero-argument call is legitimate: missing/null arguments mean `{}`. A
// non-object (array, string, number) is a typed validation error.
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";
import { ToolResultCache, ToolResultCacheLive } from "../src/caching/tool-result-cache.js";
import { normalizeToolArguments, validateToolInput } from "../src/validation/input-validator.js";
import { buildJudgmentHealingState } from "../src/healing/judgment-healing.js";
import type { ToolDefinition, ToolInput } from "../src/types.js";

const def = (name: string, parameters: ToolDefinition["parameters"]): ToolDefinition => ({
  name,
  description: name,
  parameters,
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
});

const zeroArg = def("umami/list_websites", []);
const oneRequired = def("lookup", [
  { name: "id", type: "string", description: "Record id", required: true },
]);

const layer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

/** Raw missing arguments, as an untyped caller sends them. */
const missing: unknown = undefined;

/** Runs execute with a raw `arguments` value, as an untyped caller would send it. */
const run = (tool: ToolDefinition, rawArguments: unknown) =>
  Effect.gen(function* () {
    const svc = yield* ToolService;
    yield* svc.register(tool, (args) => Effect.succeed({ ran: true, args }));
    // An untyped caller (code-action sandbox, MCP bridge) can send anything.
    const input = {
      toolName: tool.name,
      arguments: rawArguments,
      agentId: "a",
      sessionId: "s",
    } as ToolInput;
    return yield* svc.execute(input);
  }).pipe(Effect.provide(layer), Effect.either, Effect.runPromise);

describe("ToolService.execute — missing arguments mean {}", () => {
  test("arguments: undefined on a zero-param tool succeeds", async () => {
    const out = await run(zeroArg, undefined);
    expect(out._tag).toBe("Right");
    if (out._tag === "Right") {
      expect(out.right.success).toBe(true);
      expect(out.right.result).toEqual({ ran: true, args: {} });
    }
  });

  test("arguments: null on a zero-param tool succeeds", async () => {
    const out = await run(zeroArg, null);
    expect(out._tag).toBe("Right");
    if (out._tag === "Right") expect(out.right.result).toEqual({ ran: true, args: {} });
  });

  test("arguments: undefined on a tool with a required param is the normal missing-param error", async () => {
    const out = await run(oneRequired, undefined);
    expect(out._tag).toBe("Left");
    if (out._tag === "Left") {
      expect(out.left._tag).toBe("ToolValidationError");
      expect(out.left.message).toContain('Missing required parameter "id"');
    }
  });

  test("arguments: [] is a typed validation error naming the tool and the object shape", async () => {
    const out = await run(oneRequired, []);
    expect(out._tag).toBe("Left");
    if (out._tag === "Left") {
      expect(out.left._tag).toBe("ToolValidationError");
      expect(out.left.message).toContain('"lookup"');
      expect(out.left.message).toContain("JSON object");
      expect(out.left.message).toContain('lookup({"id":"<id>"})');
      if (out.left._tag === "ToolValidationError") expect(out.left.received).toBe("array");
    }
  });

  test("arguments: 'x' and 5 are typed validation errors", async () => {
    for (const [raw, kind] of [["x", "string"], [5, "number"]] as const) {
      const out = await run(zeroArg, raw);
      const err = out._tag === "Left" && out.left._tag === "ToolValidationError" ? out.left : undefined;
      expect(err?.received).toBe(kind);
      expect(err?.message).toContain('"umami/list_websites"');
    }
  });

  test("a cached tool with undefined arguments still runs and caches under {}", async () => {
    const cachedLayer = ToolServiceLive.pipe(
      Layer.provide(EventBusLive),
      Layer.provideMerge(ToolResultCacheLive()),
    );
    let calls = 0;
    const out = await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(zeroArg, () => Effect.sync(() => ++calls));
      const input = { toolName: zeroArg.name, arguments: missing, agentId: "a", sessionId: "s" } as ToolInput;
      yield* svc.execute(input);
      return yield* svc.execute(input);
    }).pipe(Effect.provide(cachedLayer), Effect.runPromise);
    expect(calls).toBe(1);
    expect(out.metadata).toEqual({ cached: true });
  });
});

describe("normalizeToolArguments (pure boundary)", () => {
  test("undefined and null become {}", async () => {
    expect(await Effect.runPromise(normalizeToolArguments(zeroArg, undefined))).toEqual({});
    expect(await Effect.runPromise(normalizeToolArguments(zeroArg, null))).toEqual({});
  });

  test("a plain object passes through unchanged", async () => {
    const args = { id: "1" };
    expect(await Effect.runPromise(normalizeToolArguments(oneRequired, args))).toBe(args);
  });

  test("validateToolInput (public export) accepts undefined without a TypeError", async () => {
    expect(await Effect.runPromise(validateToolInput(zeroArg, undefined))).toEqual({});
  });
});

describe("Object.keys sites reachable without execute", () => {
  test("ToolResultCache.check/store tolerate undefined args", async () => {
    const hit = await Effect.gen(function* () {
      const cache = yield* ToolResultCache;
      const noArgs = missing as Record<string, unknown>;
      yield* cache.store("t", noArgs, "r", true);
      return yield* cache.check("t", {});
    }).pipe(Effect.provide(ToolResultCacheLive()), Effect.runPromise);
    expect(hit?.result).toBe("r");
  });

  test("buildJudgmentHealingState tolerates undefined arguments", () => {
    const noArgs = missing as Record<string, unknown>;
    expect(buildJudgmentHealingState("t", noArgs)).toEqual({ attemptedToolName: "t", attemptedArgumentKeys: [] });
  });
});

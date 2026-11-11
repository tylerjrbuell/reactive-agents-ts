// Seam pin: registry/resolve-tool-name.ts + its ToolService.execute wiring.
//
// Census 2026-11-10 (501 runs, 1,349 calls): 19 calls named MCP tools with `_`
// for `/` (`umami_get_website_stats`) or `web_search` for `web-search` and
// failed as unknown tools. The resolver maps separator/case variants to the
// one registered name; execute runs it and says which tool ran.
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";
import { resolveToolName as fromIndex } from "../src/index.js";
import {
  annotateToolNameCorrection,
  resolveToolName,
  toolNameCorrectionNote,
} from "../src/registry/resolve-tool-name.js";
import type { ToolDefinition } from "../src/types.js";

describe("resolveToolName (pure)", () => {
  test("is exported from the package index", () => {
    expect(fromIndex).toBe(resolveToolName);
  });

  test("an exact name resolves to itself", () => {
    expect(resolveToolName("web-search", ["web-search", "web_search"])).toBe("web-search");
  });

  test("`_` for `/` resolves to the MCP tool", () => {
    expect(
      resolveToolName("umami_get_website_stats", ["umami/get_website_stats", "web-search"]),
    ).toBe("umami/get_website_stats");
  });

  test("`web_search` resolves to `web-search`", () => {
    expect(resolveToolName("web_search", ["web-search", "http-get"])).toBe("web-search");
  });

  test("case and `.` / `:` separators are collapsed too", () => {
    expect(resolveToolName("Umami.Get_Website_Stats", ["umami/get_website_stats"])).toBe(
      "umami/get_website_stats",
    );
    expect(resolveToolName("srv:tool", ["srv/tool"])).toBe("srv/tool");
  });

  test("two candidates equal after collapsing → undefined (never guess)", () => {
    expect(resolveToolName("a_b", ["a-b", "a/b"])).toBeUndefined();
  });

  test("no match → undefined; no edit distance or separator removal", () => {
    expect(resolveToolName("websearch", ["web-search"])).toBeUndefined();
    expect(resolveToolName("web-serch", ["web-search"])).toBeUndefined();
  });
});

describe("annotateToolNameCorrection", () => {
  const note = toolNameCorrectionNote("a_b", "a/b");
  test("note text names both spellings", () => {
    expect(note).toBe("(called as a_b; ran a/b)");
  });
  test("string results get a trailing note line", () => {
    expect(annotateToolNameCorrection("out", "a_b", "a/b")).toBe(`out\n${note}`);
  });
  test("object results keep their keys and gain toolNameCorrection", () => {
    expect(annotateToolNameCorrection({ x: 1 }, "a_b", "a/b")).toEqual({ x: 1, toolNameCorrection: note });
  });
  test("arrays are returned unchanged", () => {
    const arr = [1, 2];
    expect(annotateToolNameCorrection(arr, "a_b", "a/b")).toBe(arr);
  });
});

describe("ToolService.execute heals separator variants and says so", () => {
  const layer = ToolServiceLive.pipe(Layer.provide(EventBusLive));
  const mcpLike: ToolDefinition = {
    name: "umami/get_website_stats",
    description: "stats",
    parameters: [],
    riskLevel: "low",
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function",
  };

  test("`umami_get_website_stats` runs `umami/get_website_stats` and the result notes the correction", async () => {
    const out = await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(mcpLike, () => Effect.succeed({ visitors: 42 }));
      return yield* svc.execute({
        toolName: "umami_get_website_stats",
        arguments: {},
        agentId: "a",
        sessionId: "s",
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);
    expect(out.success).toBe(true);
    expect(out.toolName).toBe("umami/get_website_stats");
    expect(out.result).toEqual({
      visitors: 42,
      toolNameCorrection: "(called as umami_get_website_stats; ran umami/get_website_stats)",
    });
    expect(out.metadata).toEqual({ calledAs: "umami_get_website_stats" });
  });

  test("`web_search` resolves to the built-in `web-search` (lookup only)", async () => {
    const def = await Effect.gen(function* () {
      const svc = yield* ToolService;
      const names = (yield* svc.listTools()).map((d) => d.name);
      return resolveToolName("web_search", names);
    }).pipe(Effect.provide(layer), Effect.runPromise);
    expect(def).toBe("web-search");
  });

  test("an exact call carries no note and no metadata", async () => {
    const out = await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(mcpLike, () => Effect.succeed("plain"));
      return yield* svc.execute({
        toolName: "umami/get_website_stats",
        arguments: {},
        agentId: "a",
        sessionId: "s",
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);
    expect(out.result).toBe("plain");
    expect(out.metadata).toBeUndefined();
  });
});

describe("registry lookup refuses an ambiguous separator variant", () => {
  const layer = ToolServiceLive.pipe(Layer.provide(EventBusLive));
  const def = (name: string): ToolDefinition => ({
    name,
    description: name,
    parameters: [],
    riskLevel: "low",
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function",
  });

  test("`a_b` with `a-b` and `a/b` registered fails as an unknown tool", async () => {
    const out = await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(def("a-b"), () => Effect.succeed("dash"));
      yield* svc.register(def("a/b"), () => Effect.succeed("slash"));
      return yield* svc
        .execute({ toolName: "a_b", arguments: {}, agentId: "a", sessionId: "s" })
        .pipe(Effect.either);
    }).pipe(Effect.provide(layer), Effect.runPromise);
    expect(out._tag).toBe("Left");
    if (out._tag === "Left") expect(out.left._tag).toBe("ToolNotFoundError");
  });

  test("camelCase resolves through the same resolver", () => {
    expect(resolveToolName("fileRead", ["file-read", "file-write"])).toBe("file-read");
  });
});

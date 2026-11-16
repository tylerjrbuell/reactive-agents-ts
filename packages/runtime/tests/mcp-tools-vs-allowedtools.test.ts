// Run: bun test packages/runtime/tests/mcp-tools-vs-allowedtools.test.ts --timeout 30000
//
// Attached MCP servers' tools must stay visible AND executable through the
// ToolService wrapper when `allowedTools` is set. Explicit `server/tool`
// entries restrict that server; `forbiddenTools` still hides.
import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ToolService } from "@reactive-agents/tools";
import { buildToolsLayer } from "../src/runtime-tools-layer.js";

const FIXTURE = join(import.meta.dir, "fixtures", "echo-stdio-mcp-server.ts");

const run = <A>(
  opts: { allowedTools: string[]; forbiddenTools?: string[] },
  body: (ts: ToolService["Type"]) => Effect.Effect<A, unknown>,
): Promise<A> => {
  const layer = buildToolsLayer({ enableTools: true, ...opts }, EventBusLive);
  if (!layer) throw new Error("tools layer disabled");
  return Effect.runPromise(
    Effect.gen(function* () {
      const ts = yield* ToolService;
      yield* ts.connectMCPServer({ name: "matrix", transport: "stdio", command: "bun", args: [FIXTURE] });
      return yield* body(ts);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
};

describe("ToolService allowlist wrapper vs attached MCP servers", () => {
  it("MCP tools of a server with no explicit entry are listed, described and executable", async () => {
    const out = await run({ allowedTools: ["web-search"] }, (ts) =>
      Effect.gen(function* () {
        const names = (yield* ts.listTools()).map((t) => t.name);
        const fc = (yield* ts.toFunctionCallingFormat()).map((t) => t.name);
        const def = yield* ts.getTool("matrix/echo");
        const res = yield* ts.execute({ toolName: "matrix/echo", arguments: { text: "hi" }, agentId: "a", sessionId: "s" });
        return { names, fc, def: def.name, res };
      }),
    );
    expect(out.names).toContain("matrix/echo");
    expect(out.fc).toContain("matrix/echo");
    expect(out.def).toBe("matrix/echo");
    expect(JSON.stringify(out.res)).toContain("echo:hi");
    expect(out.names).not.toContain("file-read");
  }, 30_000);

  it("explicit server/tool entry restricts that server to the entries", async () => {
    const names = await run({ allowedTools: ["matrix/echo"] }, (ts) =>
      ts.listTools().pipe(Effect.map((d) => d.map((t) => t.name))),
    );
    expect(names).toContain("matrix/echo");
    expect(names).not.toContain("matrix/shout");
  }, 30_000);

  it("forbiddenTools hides an otherwise-attached MCP tool", async () => {
    const out = await run({ allowedTools: ["web-search"], forbiddenTools: ["matrix/shout"] }, (ts) =>
      Effect.gen(function* () {
        const names = (yield* ts.listTools()).map((t) => t.name);
        const exit = yield* Effect.either(
          ts.execute({ toolName: "matrix/shout", arguments: { text: "x" }, agentId: "a", sessionId: "s" }),
        );
        return { names, failed: exit._tag === "Left" };
      }),
    );
    expect(out.names).toContain("matrix/echo");
    expect(out.names).not.toContain("matrix/shout");
    expect(out.failed).toBe(true);
  }, 30_000);
});

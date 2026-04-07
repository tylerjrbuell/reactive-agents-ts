import { Effect } from "effect";
import type { Database } from "bun:sqlite";
import { ToolService, createToolsLayer, type ToolOutput } from "@reactive-agents/tools";
import { getMcpServer, parseMcpConfig } from "../db/mcp-queries.js";
import { getLabCustomTool } from "../db/lab-custom-tools-queries.js";
import { labCustomToDefinition, parseCatalogToolId } from "./tool-catalog.js";

const PLAYGROUND_AGENT = "cortex-lab";
const PLAYGROUND_SESSION = "tool-playground";

export type PlaygroundInvokeResult =
  | { ok: true; output: ToolOutput }
  | { ok: false; error: string; httpStatus: number };

function formatToolError(e: unknown): string {
  if (e && typeof e === "object" && "_tag" in e) {
    const t = (e as { _tag: string; message?: string })._tag;
    const m = (e as { message?: string }).message;
    return m ? `${t}: ${m}` : t;
  }
  return e instanceof Error ? e.message : String(e);
}

export function invokeCatalogTool(
  db: Database,
  catalogId: string,
  args: Record<string, unknown>,
): Promise<PlaygroundInvokeResult> {
  const ref = parseCatalogToolId(catalogId);
  if (!ref) {
    return Promise.resolve({ ok: false, error: "Invalid tool id", httpStatus: 400 });
  }

  if (ref.tag === "meta") {
    return Promise.resolve({
      ok: false,
      error:
        "Meta tools run inside an agent with .withMetaTools() and shared services — use a desk run to exercise them.",
      httpStatus: 400,
    });
  }

  const layer = createToolsLayer();

  if (ref.tag === "builtin") {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      return yield* tools.execute({
        toolName: ref.registryName,
        arguments: args,
        agentId: PLAYGROUND_AGENT,
        sessionId: PLAYGROUND_SESSION,
      });
    });
    return Effect.runPromise(program.pipe(Effect.provide(layer))).then(
      (output) => ({ ok: true as const, output }),
      (e) => ({ ok: false as const, error: formatToolError(e), httpStatus: 500 }),
    );
  }

  if (ref.tag === "custom") {
    const row = getLabCustomTool(db, ref.toolId);
    if (!row || row.disabled === 1) {
      return Promise.resolve({ ok: false, error: "Custom tool not found or disabled", httpStatus: 404 });
    }
    const def = labCustomToDefinition(row);
    if (!def) {
      return Promise.resolve({ ok: false, error: "Invalid custom tool definition", httpStatus: 400 });
    }

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(def, (a) =>
        Effect.succeed({
          ok: true,
          labEcho: true,
          tool: def.name,
          received: a,
        }),
      );
      return yield* tools.execute({
        toolName: def.name,
        arguments: args,
        agentId: PLAYGROUND_AGENT,
        sessionId: PLAYGROUND_SESSION,
      });
    });

    return Effect.runPromise(program.pipe(Effect.provide(layer))).then(
      (output) => ({ ok: true as const, output }),
      (e) => ({ ok: false as const, error: formatToolError(e), httpStatus: 500 }),
    );
  }

  // MCP
  const row = getMcpServer(db, ref.serverId);
  if (!row) {
    return Promise.resolve({ ok: false, error: "MCP server not found", httpStatus: 404 });
  }
  const cfg = parseMcpConfig(row);

  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.connectMCPServer({
      name: cfg.name,
      transport: cfg.transport,
      endpoint: cfg.endpoint,
      command: cfg.command,
      args: cfg.args,
      cwd: cfg.cwd,
      env: cfg.env,
      headers: cfg.headers,
    });
    const exec = tools.execute({
      toolName: ref.registryName,
      arguments: args,
      agentId: PLAYGROUND_AGENT,
      sessionId: PLAYGROUND_SESSION,
    });
    const disconnectQuiet = tools.disconnectMCPServer(cfg.name).pipe(
      Effect.catchAll(() => Effect.void),
    );
    return yield* exec.pipe(Effect.ensuring(disconnectQuiet));
  });

  return Effect.runPromise(program.pipe(Effect.provide(layer))).then(
    (output) => ({ ok: true as const, output }),
    (e) => ({ ok: false as const, error: formatToolError(e), httpStatus: 500 }),
  );
}

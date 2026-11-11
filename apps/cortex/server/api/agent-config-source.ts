import { Elysia, t, type Static } from "elysia";
import { Effect, type Layer } from "effect";
import { CortexStoreService } from "../services/store-service.js";
import { launchParamsToBuildParams } from "../services/runner-service.js";
import { cortexAgentSource } from "../services/cortex-agent-source.js";
import { AgentConfigBodyFields } from "./agent-config-body.js";
import { runBodyToLaunchParams } from "./runs.js";

/**
 * Body for `POST /api/agent-config/source`: the `POST /api/runs` body with the
 * prompt optional (the UI sends `cortexRunsPostBody`), so an export reads the
 * config exactly as a desk run does.
 */
export const AgentSourceBody = t.Object({
  prompt: t.Optional(t.String()),
  agentName: t.Optional(t.String()),
  variables: t.Optional(t.Array(t.Unknown())),
  variableValues: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
  ...AgentConfigBodyFields,
});

/**
 * "Export as code": `POST /api/agent-config/source` → `{ source, notInCode }`.
 * Body → desk-run params (`runBodyToLaunchParams`, saved MCP servers resolved
 * like a run) → `cortexAgentSource` (framework `agentConfigToSource` over
 * `cortexParamsToAgentConfig`). The workspace is printed as given, not checked:
 * the code may run on another machine.
 */
export const agentConfigSourceRouter = (storeLayer: Layer.Layer<CortexStoreService>) =>
  new Elysia({ prefix: "/api/agent-config" }).post(
    "/source",
    async ({ body, set }) => {
      const b: Static<typeof AgentSourceBody> = body;
      const workspace = typeof b.workspace === "string" && b.workspace.trim() !== "" ? b.workspace.trim() : undefined;
      const launch = runBodyToLaunchParams({ ...b, prompt: b.prompt ?? "" }, workspace);
      const provider = launch.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test";
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        const mcpConfigs =
          launch.mcpServerIds && launch.mcpServerIds.length > 0
            ? yield* store.getMcpServerConfigsByIds(launch.mcpServerIds)
            : [];
        return yield* Effect.try({
          try: () => cortexAgentSource(launchParamsToBuildParams(launch, provider, mcpConfigs), "agent"),
          catch: (e) => (e instanceof Error ? e.message : String(e)),
        });
      });
      const result = await Effect.runPromise(Effect.either(program.pipe(Effect.provide(storeLayer))));
      if (result._tag === "Left") {
        set.status = 400;
        return { error: result.left };
      }
      return result.right;
    },
    { body: AgentSourceBody },
  );

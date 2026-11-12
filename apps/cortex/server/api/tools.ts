import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { CortexStoreService } from "../services/store-service.js";
import { approvalRequiredToolNames, buildToolCatalog, type CortexToolCatalogEntry } from "../services/tool-catalog.js";
import { invokeCatalogTool } from "../services/tool-playground-invoke.js";
import {
  insertLabCustomTool,
  deleteLabCustomTool,
  setLabCustomToolDisabled,
} from "../db/lab-custom-tools-queries.js";
import { executeMcpJsonImport } from "../services/mcp-json-import-apply.js";
import {
  BUILTIN_SHELL_PRESETS,
  BUILTIN_TOOLSET_ALIASES,
  COMMAND_CAPABILITY_MAP,
  DEFAULT_ALLOWED_COMMANDS,
  OPT_IN_COMMANDS,
} from "@reactive-agents/tools";

const parameterItem = t.Object({
  name: t.String(),
  type: t.String(),
  required: t.Boolean(),
  description: t.String(),
  enum: t.Optional(t.Array(t.String())),
});

export const toolsRouter = (storeLayer: Layer.Layer<CortexStoreService>, db: Database) =>
  new Elysia({ prefix: "/api/tools" })
    .get("/", async () => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getTools();
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    })
    .get("/catalog", (): CortexToolCatalogEntry[] => buildToolCatalog(db))
    // Framework built-in toolset shortcuts (`builtins: ["research"]` etc.) so the UI never hand-copies them.
    .get("/toolsets", (): Record<string, readonly string[]> => ({ ...BUILTIN_TOOLSET_ALIASES }))
    // Shell toolsets (`git`, `workspace`) → the programs their scoped shell-execute runs, so pickers
    // show "git · gh via shell" instead of a bare `shell-execute`, and select the alias itself.
    .get("/shell-presets", (): Record<string, readonly string[]> => ({ ...BUILTIN_SHELL_PRESETS }))
    // The shell allowlist the builder edits as one list: framework defaults, the opt-in
    // commands, and the commands behind each legacy `commandAccess` group (to fold old saves).
    // Tools the framework always gates once any approval policy is set (`requiresApproval`
    // definitions it folds into the policy), so the approval editor can show them locked.
    .get("/approval-required", (): { tools: string[] } => ({ tools: approvalRequiredToolNames() }))
    .get("/shell-commands", () => ({
      defaults: [...DEFAULT_ALLOWED_COMMANDS],
      optIn: [...OPT_IN_COMMANDS],
      groups: COMMAND_CAPABILITY_MAP,
    }))
    .post(
      "/invoke",
      async ({ body, set }) => {
        const res = await invokeCatalogTool(db, body.toolId, body.arguments as Record<string, unknown>, body.approved === true);
        if (!res.ok) {
          set.status = res.httpStatus;
          return { error: res.error, ...(res.approvalRequired ? { approvalRequired: true as const } : {}) };
        }
        return {
          ok: true as const,
          toolName: res.output.toolName,
          success: res.output.success,
          result: res.output.result,
          executionTimeMs: res.output.executionTimeMs,
        };
      },
      {
        body: t.Object({
          toolId: t.String(),
          arguments: t.Record(t.String(), t.Unknown()),
          /** A person approved this call; required for tools the framework gates (`requiresApproval`). */
          approved: t.Optional(t.Boolean()),
        }),
      },
    )
    .post(
      "/mcp-import-json",
      async ({ body, set }) => {
        const out = executeMcpJsonImport(db, body.json);
        if (!out.ok) {
          set.status = out.status;
          return { error: out.error };
        }
        return { ok: true as const, count: out.count, created: out.created };
      },
      { body: t.Object({ json: t.String() }) },
    )
    .post(
      "/lab-custom",
      async ({ body, set }) => {
        const name = body.name.trim();
        if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
          set.status = 400;
          return { error: "name must be kebab-case (letters, numbers, hyphens)" };
        }
        try {
          const parametersJson = JSON.stringify(body.parameters);
          const toolId = insertLabCustomTool(db, {
            name,
            description: body.description.trim() || "Lab custom tool",
            parametersJson,
          });
          return { toolId };
        } catch (e) {
          set.status = 400;
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
      {
        body: t.Object({
          name: t.String(),
          description: t.String(),
          parameters: t.Array(parameterItem),
        }),
      },
    )
    .patch(
      "/lab-custom/:toolId",
      async ({ params, body, set }) => {
        if (body.disabled === undefined) {
          set.status = 400;
          return { error: "disabled (boolean) required" };
        }
        const ok = setLabCustomToolDisabled(db, params.toolId, body.disabled);
        if (!ok) {
          set.status = 404;
          return { error: "Tool not found" };
        }
        return { ok: true as const };
      },
      {
        params: t.Object({ toolId: t.String() }),
        body: t.Object({ disabled: t.Boolean() }),
      },
    )
    .delete(
      "/lab-custom/:toolId",
      async ({ params, set }) => {
        const ok = deleteLabCustomTool(db, params.toolId);
        if (!ok) {
          set.status = 404;
          return { error: "Tool not found" };
        }
        return { ok: true as const };
      },
      { params: t.Object({ toolId: t.String() }) },
    );

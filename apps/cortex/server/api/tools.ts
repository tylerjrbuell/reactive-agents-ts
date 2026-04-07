import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { CortexStoreService } from "../services/store-service.js";
import { buildToolCatalog, type CortexToolCatalogEntry } from "../services/tool-catalog.js";
import { invokeCatalogTool } from "../services/tool-playground-invoke.js";
import {
  insertLabCustomTool,
  deleteLabCustomTool,
  setLabCustomToolDisabled,
} from "../db/lab-custom-tools-queries.js";
import { executeMcpJsonImport } from "../services/mcp-json-import-apply.js";

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
    .post(
      "/invoke",
      async ({ body, set }) => {
        const res = await invokeCatalogTool(db, body.toolId, body.arguments as Record<string, unknown>);
        if (!res.ok) {
          set.status = res.httpStatus;
          return { error: res.error };
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

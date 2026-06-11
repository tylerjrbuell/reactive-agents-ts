import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { insertPrompt, listPrompts, updatePrompt, deletePrompt } from "../db/prompt-queries.js";

const promptTypeSchema = t.Optional(
  t.Union([t.Literal("system"), t.Literal("persona"), t.Literal("task"), t.Literal("snippet")]),
);

export const promptRouter = (db: Database) =>
  new Elysia({ prefix: "/api/prompts" })
    .get("/", () => listPrompts(db))
    .post(
      "/",
      ({ body, set }) => {
        if (!body.body.trim()) {
          set.status = 400;
          return { error: "body is required" };
        }
        const id = insertPrompt(db, {
          name: body.name,
          body: body.body.trim(),
          type: body.type,
          tags: body.tags,
        });
        return { id };
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          body: t.String(),
          type: promptTypeSchema,
          tags: t.Optional(t.Array(t.String())),
        }),
      },
    )
    .patch(
      "/:id",
      ({ params, body, set }) => {
        const id = Number(params.id);
        if (isNaN(id) || !body.body.trim()) {
          set.status = 400;
          return { error: "invalid request" };
        }
        updatePrompt(db, id, {
          name: body.name,
          body: body.body.trim(),
          type: body.type,
          tags: body.tags,
        });
        return { ok: true };
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          body: t.String(),
          type: promptTypeSchema,
          tags: t.Optional(t.Array(t.String())),
        }),
      },
    )
    .delete("/:id", ({ params }) => {
      deletePrompt(db, Number(params.id));
      return { ok: true };
    });

import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { getRunMessages } from "../db/messages-queries.js";

export const messagesRouter = (db: Database) =>
  new Elysia({ prefix: "/api/runs" }).get("/:runId/messages", ({ params }) => {
    return getRunMessages(db, params.runId);
  });

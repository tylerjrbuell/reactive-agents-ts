/**
 * POST /api/strategy-conflict: would this config's strategy be refused by the framework's approval-scope
 * rule? The UI sends the config it holds and renders the answer, so the note and the 409 on the run and
 * chat routes come from one place (`approvalConflictOfConfig`, which asks the framework's own predicate).
 */
import { Elysia, t } from "elysia";
import { approvalConflictOfConfig } from "../services/strategy-conflict-guard.js";

export const strategyConflictRouter = new Elysia({ prefix: "/api/strategy-conflict" }).post(
  "/",
  ({ body }) => ({
    conflict: approvalConflictOfConfig(body.config, body.toolsEnabled === undefined ? {} : { toolsEnabled: body.toolsEnabled }) ?? null,
  }),
  { body: t.Object({ config: t.Record(t.String(), t.Unknown()), toolsEnabled: t.Optional(t.Boolean()) }) },
);

// Run: bun run repo test apps/cortex/server/tests/shell-commands-catalog.test.ts
//
// The builder edits the shell allowlist as one list, seeded from
// `GET /api/tools/shell-commands`. These pin:
//  - the endpoint serves the framework's own default and opt-in lists (never a copy),
//  - the `commandAccess` groups come from the framework's `COMMAND_CAPABILITY_MAP`
//    (no Cortex copy), so folding old saves into the list loses no command.
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { COMMAND_CAPABILITY_MAP, DEFAULT_ALLOWED_COMMANDS, OPT_IN_COMMANDS } from "@reactive-agents/tools";
import { applySchema } from "../db/schema.js";
import { toolsRouter } from "../api/tools.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { SHELL_COMMAND_CAPABILITIES } from "../services/cortex-agent-config.js";

describe("shell commands catalog", () => {
  it("GET /api/tools/shell-commands serves the framework lists and every group", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
    const body = (await (await app.handle(new Request("http://localhost/api/tools/shell-commands"))).json()) as {
      defaults: string[];
      optIn: string[];
      groups: Record<string, string[]>;
    };
    expect(body.defaults).toEqual([...DEFAULT_ALLOWED_COMMANDS]);
    expect(body.optIn).toEqual([...OPT_IN_COMMANDS]);
    expect(Object.keys(body.groups).sort()).toEqual([...SHELL_COMMAND_CAPABILITIES].sort());
    expect(body.groups).toEqual(JSON.parse(JSON.stringify(COMMAND_CAPABILITY_MAP)));
    db.close();
  });
});

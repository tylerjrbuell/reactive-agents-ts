/**
 * Chat agents feed the Cortex ingest path in-process, so a sub-agent spawned in
 * a chat turn becomes its own run row with parent/child correlation, and the
 * root chat run is tagged with its chat session.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { Layer } from "effect";
import { openDatabase } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { CortexIngestService, CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";

const DB_PATH = "/tmp/cortex-chat-ingest.db";
const filler = "prime the delegation run with a long preamble. ".repeat(6);

let db: ReturnType<typeof openDatabase>;
let svc: ChatSessionService;

beforeAll(() => {
  for (const sfx of ["", "-wal", "-shm"]) rmSync(DB_PATH + sfx, { force: true });
  db = openDatabase(DB_PATH);
  const ingestLayer = CortexIngestServiceLive(db).pipe(
    Layer.provide(CortexEventBridgeLive),
  ) as Layer.Layer<CortexIngestService>;
  svc = new ChatSessionService(db, { ingestLayer });
});

afterAll(async () => {
  await svc.disposeAll();
  db.close();
  for (const sfx of ["", "-wal", "-shm"]) rmSync(DB_PATH + sfx, { force: true });
});

type EventRow = { run_id: string; type: string; session_id: string | null; payload: string };

describe("chat -> ingest", () => {
  it("a chat turn that spawns a sub-agent ingests both runs with parent/child correlation", async () => {
    const sessionId = await svc.createSession({
      name: "delegating chat",
      agentConfig: {
        provider: "test",
        model: "test-model",
        enableTools: true,
        strategy: "reactive",
        maxIterations: 6,
        tools: ["spawn-agent"],
        dynamicSubAgents: { enabled: true, maxIterations: 2 },
        testScenario: [
          {
            match: "CHAT_ROOT_TRIGGER",
            toolCall: { name: "spawn-agent", args: { task: "CHILDWORK do the child work", name: "kid" } },
          },
          { match: "CHILDWORK", text: "child done" },
          { text: "Done." },
        ],
      },
    });

    for await (const _ of svc.chatStream(sessionId, `${filler} CHAT_ROOT_TRIGGER: begin.`)) void _;
    // Ingest is fire-and-forget (Effect.runFork); let it drain.
    await new Promise((r) => setTimeout(r, 200));

    const rows = db
      .prepare("SELECT run_id, type, session_id, payload FROM cortex_events ORDER BY seq")
      .all() as EventRow[];
    const started = rows.filter((r) => r.type === "AgentStarted");
    const runs = new Set(started.map((r) => r.run_id));
    expect(runs.size).toBe(2);

    const parsed = started.map((r) => ({ row: r, p: JSON.parse(r.payload) as Record<string, unknown> }));
    const root = parsed.find((x) => x.p.parentRunId === undefined)!;
    const child = parsed.find((x) => x.p.parentRunId !== undefined)!;
    expect(root).toBeDefined();
    expect(child).toBeDefined();
    expect(child.p.parentRunId).toBe(root.row.run_id);
    expect(child.p.rootRunId).toBe(root.row.run_id);
    expect(child.p.depth).toBe(1);

    // Root chat run links back to its chat session; the child is not a chat root.
    expect(root.row.session_id).toBe(sessionId);
    const runRow = db.prepare("SELECT run_id FROM cortex_runs WHERE run_id = ?").get(child.row.run_id);
    expect(runRow).not.toBeNull();
  }, 30_000);
});

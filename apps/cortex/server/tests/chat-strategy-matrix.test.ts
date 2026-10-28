/**
 * Chat strategy matrix: every strategy the Cortex UI offers must run end-to-end
 * through ChatSessionService.chatStream with the deterministic test provider.
 *
 * The strategy list comes from getCapabilityManifest() — the exact source the
 * UI loads via GET /api/capabilities (AgentConfigPanel STRATEGIES), never a
 * hand-copied list. The session also attaches a stdio MCP fixture that carries
 * the malformed tool schema from the Umami incident (array branch without
 * `items`), so a strategy that trips on a bad tool surface fails here.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { getCapabilityManifest } from "@reactive-agents/runtime";
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { openDatabase } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { insertMcpServer } from "../db/mcp-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";

const DB_PATH = "/tmp/cortex-chat-strategy-matrix.db";
const FIXTURE = join(import.meta.dir, "fixtures", "malformed-schema-mcp-server.ts");
const MCP_ID = "matrix-fixture";
const TIMEOUT = 60_000;

/** The same list the UI renders (`/api/capabilities` -> `strategies[].name`). */
const STRATEGIES: readonly string[] = getCapabilityManifest().strategies.map((s) => s.name);

let db: ReturnType<typeof openDatabase>;
let svc: ChatSessionService;

beforeAll(() => {
  for (const sfx of ["", "-wal", "-shm"]) rmSync(DB_PATH + sfx, { force: true });
  db = openDatabase(DB_PATH);
  insertMcpServer(db, MCP_ID, {
    name: "matrix",
    transport: "stdio",
    command: "bun",
    args: [FIXTURE],
  });
  svc = new ChatSessionService(db);
});

afterAll(() => {
  db.close();
  for (const sfx of ["", "-wal", "-shm"]) rmSync(DB_PATH + sfx, { force: true });
});

async function collect(sessionId: string, message: string): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const e of svc.chatStream(sessionId, message)) events.push(e);
  return events;
}

const ECHO_CALL = { name: "matrix/echo", args: { text: "hello" } } as const;
const planOf = (instruction: string) => ({
  json: { steps: [{ title: "Step", instruction, type: "composite" }] },
});

/**
 * Strategies whose scripted tool turn is driven by the kernel's native
 * tool-calling think loop. The others (plan JSON, critique, code blocks,
 * single-shot) own a strategy-specific LLM contract, so a tool turn cannot be
 * expressed with one shared script; they still must complete both turns.
 */
const KERNEL_TOOL_STRATEGIES: ReadonlySet<string> = new Set(["reactive", "adaptive", "tree-of-thought"]);
const PLAN_STRATEGIES: ReadonlySet<string> = new Set(["plan-execute-reflect"]);
const fence = (code: string) => "```typescript\n" + code + "\n```";

/** One script spans the whole session: the scripted cursor persists across turns. */
function scriptFor(strategy: string) {
  if (PLAN_STRATEGIES.has(strategy)) {
    return [
      planOf("Answer the capital of France. ANSWER-STEP"),
      { match: "ANSWER-STEP", text: "FINAL ANSWER: Paris is the capital of France." },
      planOf("Use the echo tool with hello. ECHO-STEP"),
      { match: "ECHO-STEP", toolCall: ECHO_CALL },
      { match: "echo:hello", text: "FINAL ANSWER: The tool said hello." },
      planOf("Answer briefly. ANSWER-STEP"),
    ];
  }
  if (strategy === "blueprint") {
    // Blueprint plans a DAG of tool_call steps and then runs one solver call.
    const echoPlan = { json: { steps: [{ title: "echo", instruction: "Echo", type: "tool_call", toolName: "matrix/echo", toolArgs: { text: "hello" } }] } };
    return [
      echoPlan,
      { text: "Paris is the capital of France." },
      echoPlan,
      { text: "The tool said hello." },
    ];
  }
  if (strategy === "code-action") {
    // The plan LLM answers with a code block executed in the sandbox.
    return [
      { text: fence("(async () => 'Paris is the capital of France.')()") },
      { text: fence("(async () => 'The tool said hello.')()") },
    ];
  }
  if (strategy === "direct") {
    // Single-shot: no tool loop, so turn 2 is a second plain answer.
    return [{ match: "capital of France", text: "Paris is the capital of France." }, { text: "A second plain answer." }];
  }
  return [
    { match: "capital of France", text: "Paris is the capital of France." },
    { match: "use the echo tool", toolCall: ECHO_CALL },
    { match: "echo:hello", text: "The tool said hello." },
    { text: "Fallback reply." },
  ];
}

function sessionFor(strategy: string): Promise<string> {
  return svc.createSession({
    name: `matrix-${strategy}`,
    agentConfig: {
      provider: "test",
      model: "test-model",
      enableTools: true,
      strategy,
      mcpServerIds: [MCP_ID],
      // the UI selects MCP tools by name; the allowlist makes them visible to the kernel
      tools: ["matrix/echo", "matrix/run_funnel"],
      maxIterations: 6,
      testScenario: scriptFor(strategy),
    },
  });
}

/** Failure text a strategy can hand back as if it were an answer. */
const FAILURE_OUTPUT = /^(Strategy execution failed|Could not complete the task)/;

describe("chat strategy matrix", () => {
  it("reads a non-empty strategy list from the capability manifest", () => {
    expect(STRATEGIES.length).toBeGreaterThanOrEqual(5);
    for (const s of ["reactive", "plan-execute-reflect", "tree-of-thought", "reflexion", "adaptive"]) {
      expect(STRATEGIES).toContain(s);
    }
  });

  for (const strategy of STRATEGIES) {
    describe(`strategy: ${strategy}`, () => {
      it("turn 1 plain question completes; turn 2 tool call completes, persists, history carries", async () => {
        const id = await sessionFor(strategy);

        const t1 = await collect(id, "What is the capital of France?");
        const err1 = t1.find((e) => e._tag === "StreamError");
        expect(err1, `[${strategy}] turn 1 error: ${JSON.stringify(err1)}`).toBeUndefined();
        const done1 = t1.find((e) => e._tag === "StreamCompleted");
        expect(done1, `[${strategy}] turn 1 never reached StreamCompleted`).toBeDefined();
        expect(String((done1 as { output?: unknown }).output ?? "").trim().length).toBeGreaterThan(0);

        const t2 = await collect(id, "Please use the echo tool with hello.");
        const err2 = t2.find((e) => e._tag === "StreamError");
        expect(err2, `[${strategy}] turn 2 error (malformed-schema tool present): ${JSON.stringify(err2)}`).toBeUndefined();
        const done2 = t2.find((e) => e._tag === "StreamCompleted");
        expect(done2, `[${strategy}] turn 2 never reached StreamCompleted`).toBeDefined();
        if (KERNEL_TOOL_STRATEGIES.has(strategy)) {
          expect(t2.some((e) => e._tag === "ToolCallCompleted"), `[${strategy}] scripted tool never ran`).toBe(true);
        }
        for (const [n, done] of [[1, done1], [2, done2]] as const) {
          const out = String((done as { output?: unknown }).output ?? "");
          expect(FAILURE_OUTPUT.test(out), `[${strategy}] turn ${n} StreamCompleted carries failure text as the answer: ${out.slice(0, 160)}`).toBe(false);
        }

        const turns = getChatTurns(db, id);
        expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
        expect(turns[0]!.content).toContain("capital of France");
        expect(turns[2]!.content).toContain("echo tool");
        expect(turns[3]!.content.trim().length).toBeGreaterThan(0);
      }, TIMEOUT);

      it("a failing turn surfaces an error that names the strategy", async () => {
        const id = await svc.createSession({
          name: `matrix-err-${strategy}`,
          agentConfig: {
            provider: "test",
            model: "test-model",
            enableTools: true,
            strategy,
            maxIterations: 4,
            testScenario: [{ error: "scripted failure" }],
          },
        });
        const events = await collect(id, "Trigger a failure please.");
        const err = events.find((e) => e._tag === "StreamError") as { cause?: string } | undefined;
        const done = events.find((e) => e._tag === "StreamCompleted") as { output?: unknown } | undefined;
        const text = err?.cause ?? (done ? String(done.output ?? "") : "");
        // A provider failure must never complete silently with an empty answer...
        expect(err || text.trim().length > 0, `[${strategy}] provider failure completed with an empty answer`).toBeTruthy();
        // ...and any failure it does surface must name the strategy.
        if (err || FAILURE_OUTPUT.test(text)) {
          expect(text, `[${strategy}] failure message does not name the strategy`).toContain(strategy);
        }
      }, TIMEOUT);
    });
  }
});

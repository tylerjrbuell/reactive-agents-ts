import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";

let db: Database;
let svc: ChatSessionService;

beforeAll(() => {
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});

afterAll(async () => {
  await svc.disposeAll();
  db.close();
});

const scenario = [
  { toolCall: { name: "todo", args: { action: "add", items: ["step one", "step two"] } } },
  { toolCall: { name: "todo", args: { action: "done", id: 1 } } },
  { text: "All done." },
];

const baseConfig = {
  provider: "test",
  model: "test-model",
  enableTools: true,
  strategy: "reactive",
  maxIterations: 6,
  metaTools: { enabled: true, brief: false, find: false, pulse: false, recall: true, todo: true, harnessSkill: false },
  testScenario: scenario,
};

async function lastAssistantTrace(config: Record<string, unknown>) {
  const id = await svc.createSession({ name: "checklist", agentConfig: config });
  for await (const _ of svc.chatStream(id, "plan and do the work")) void _;
  const turns = getChatTurns(db, id).filter((t) => t.role === "assistant");
  return turns[turns.length - 1]?.trace;
}

describe("chat persists the turn checklist", () => {
  it("a streamed turn with todo enabled persists trace.checklist", async () => {
    const trace = await lastAssistantTrace(baseConfig);
    expect(trace?.checklist).toBeDefined();
    const titles = trace!.checklist!.root.rows.map((r) => r.title);
    expect(titles).toContain("step one");
  }, 30_000);

  it("with observability.checklist off, no checklist is persisted", async () => {
    const trace = await lastAssistantTrace({ ...baseConfig, observability: { checklist: false } });
    expect(trace?.checklist).toBeUndefined();
  }, 30_000);
});

describe("todo is off unless the setting enables it", () => {
  it("chat default (no metaTools.todo): the todo tool is not offered, so no advisory rows persist", async () => {
    const trace = await lastAssistantTrace({
      ...baseConfig,
      metaTools: { enabled: true, brief: false, find: false, pulse: false, recall: true, harnessSkill: false },
    });
    const titles = trace?.checklist?.root.rows.map((r) => r.title) ?? [];
    expect(titles).not.toContain("step one");
  }, 30_000);
});

describe("new-chat default meta-tools shape (todo only)", () => {
  const chatDefault = { enabled: true, brief: false, find: false, pulse: false, recall: false, harnessSkill: false, todo: true };
  it("registers todo: advisory rows persist with only todo enabled", async () => {
    const trace = await lastAssistantTrace({ ...baseConfig, metaTools: chatDefault });
    expect(trace?.checklist?.root.rows.map((r) => r.title)).toContain("step one");
  }, 30_000);
  it("a stored session with todo:false keeps it off", async () => {
    const trace = await lastAssistantTrace({ ...baseConfig, metaTools: { ...chatDefault, todo: false } });
    expect(trace?.checklist?.root.rows.map((r) => r.title) ?? []).not.toContain("step one");
  }, 30_000);
});

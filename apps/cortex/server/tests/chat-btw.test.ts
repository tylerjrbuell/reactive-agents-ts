import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { applySchema } from "../db/schema.js";
import { appendChatTurn, createChatSession, getChatTurns } from "../db/chat-queries.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { UTILITY_AGENT_PARAMS } from "../services/utility-agent.js";
import { BTW_MEMORY_OFF, btwContextFromTurns, btwPrompt, ChatBtwService, type BtwAsk, type BtwContext } from "../services/chat-btw.js";
import { chatRouter } from "../api/chat.js";
import type { ChatSessionService } from "../services/chat-session-service.js";

const running: BtwContext = {
  task: "Find the three largest files",
  running: true,
  draft: "I found two so far",
  steps: [
    { tool: "shell-execute", args: '{"command":"du -a"}', result: "10 a.txt\n20 b.txt" },
    { tool: "file-read", failed: true, result: "ENOENT" },
  ],
};

describe("btwPrompt", () => {
  it("puts the run context before the marker and the question after it", () => {
    const p = btwPrompt("which files did you scan?", running);
    const [quoted, instruction] = p.split("--- Current message ---");
    expect(quoted).toContain("still in progress");
    expect(quoted).toContain("Find the three largest files");
    expect(quoted).toContain("1. shell-execute");
    expect(quoted).toContain("2. file-read (failed)");
    expect(quoted).toContain("I found two so far");
    expect(instruction).toContain("which files did you scan?");
    expect(instruction).toContain("cannot run tools");
  });

  it("bounds a long run: last 12 steps, clipped results", () => {
    const steps = Array.from({ length: 30 }, (_, i) => ({ tool: `t${i}`, result: "x".repeat(5000) }));
    const p = btwPrompt("q", { ...running, steps });
    expect(p).toContain("last 12 shown");
    expect(p).not.toContain("t17\n");
    expect(p).toContain("t29");
    expect(p.length).toBeLessThan(12 * 700 + 8000);
  });

  it("says so when nothing has happened yet", () => {
    const p = btwPrompt("q", { task: "t", steps: [], draft: "", running: true });
    expect(p).toContain("none yet");
    expect(p).toContain("nothing yet");
  });
});

describe("ChatBtwService", () => {
  let db: Database;
  let sid: string;
  let asked: Array<{ cfg: Record<string, unknown>; prompt: string }>;
  const ask: BtwAsk = async (cfg, prompt) => {
    asked.push({ cfg, prompt });
    return "  Two files so far.  ";
  };

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    sid = createChatSession(db, { agentConfig: { provider: "ollama", model: "qwen3" } });
    asked = [];
  });

  it("answers from the client's snapshot on the session's own provider and model", async () => {
    const out = await new ChatBtwService(db, ask).answer(sid, "  how far along? ", running);
    expect(out).toEqual({ ok: true, answer: "Two files so far.", running: true });
    expect(asked[0]!.cfg).toMatchObject({ provider: "ollama", model: "qwen3" });
    expect(asked[0]!.prompt).toContain("how far along?");
  });

  it("never writes to the chat: no turns are added", async () => {
    await new ChatBtwService(db, ask).answer(sid, "q", running);
    expect(getChatTurns(db, sid)).toEqual([]);
  });

  it("with no run in progress it answers from the last stored exchange", async () => {
    appendChatTurn(db, { sessionId: sid, role: "user", content: "Summarise the repo", tokensUsed: 0 });
    appendChatTurn(db, { sessionId: sid, role: "assistant", content: "It is a monorepo.", tokensUsed: 5, toolsUsed: ["file-read"] });
    const out = await new ChatBtwService(db, ask).answer(sid, "what did you read?");
    expect(out).toMatchObject({ ok: true, running: false });
    expect(asked[0]!.prompt).toContain("finished");
    expect(asked[0]!.prompt).toContain("Summarise the repo");
    expect(asked[0]!.prompt).toContain("1. file-read");
    expect(asked[0]!.prompt).toContain("It is a monorepo.");
  });

  it("refuses an empty question, an unknown session, an empty chat, and a model that fails or stays silent", async () => {
    const svc = new ChatBtwService(db, ask);
    expect(await svc.answer(sid, "   ", running)).toMatchObject({ ok: false, status: 400 });
    expect(await svc.answer("nope", "q", running)).toMatchObject({ ok: false, status: 404 });
    expect(await svc.answer(sid, "q")).toMatchObject({ ok: false, status: 400 });
    expect(await new ChatBtwService(db, async () => { throw new Error("provider down"); }).answer(sid, "q", running)).toEqual({ ok: false, status: 502, error: "provider down" });
    expect(await new ChatBtwService(db, async () => "").answer(sid, "q", running)).toMatchObject({ ok: false, status: 502 });
  });

  it("btwContextFromTurns reads the last exchange only", () => {
    appendChatTurn(db, { sessionId: sid, role: "user", content: "old", tokensUsed: 0 });
    appendChatTurn(db, { sessionId: sid, role: "assistant", content: "old answer", tokensUsed: 0 });
    appendChatTurn(db, { sessionId: sid, role: "user", content: "new", tokensUsed: 0 });
    appendChatTurn(db, { sessionId: sid, role: "assistant", content: "new answer", tokensUsed: 0 });
    expect(btwContextFromTurns(getChatTurns(db, sid))).toEqual({ task: "new", steps: [], draft: "new answer", running: false });
  });
});

describe("POST /api/chat/sessions/:id/btw", () => {
  it("returns the answer, 400 for an empty question, and 501 without the service", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const sid = createChatSession(db, { agentConfig: { provider: "test" } });
    const svc = {} as ChatSessionService;
    const post = (app: { handle: (r: Request) => Response | Promise<Response> }, body: unknown) =>
      app.handle(new Request(`http://localhost/api/chat/sessions/${sid}/btw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const app = new Elysia().use(chatRouter(svc, undefined, undefined, undefined, new ChatBtwService(db, async () => "Because.")));
    const ok = await post(app, { question: "why?", context: running });
    expect(await ok.clone().text()).toContain("Because.");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ answer: "Because.", running: true });
    expect((await post(app, { question: " ", context: running })).status).toBe(400);
    const bare = new Elysia().use(chatRouter(svc));
    expect((await post(bare, { question: "why?" })).status).toBe(501);
  });
});

describe("the side-question agent", () => {
  it("builds with no memory layer, so it neither recalls nor writes", () => {
    const withBtwParams = cortexParamsToAgentConfig({ agentName: "chat-btw", provider: "test", ...UTILITY_AGENT_PARAMS, memory: BTW_MEMORY_OFF });
    expect(withBtwParams.memory).toBeUndefined();
    expect(withBtwParams.features?.memory).toBeUndefined();
    // Cortex's default (no memory choice) does turn it on: the explicit off is what keeps the aside clean.
    expect(cortexParamsToAgentConfig({ agentName: "chat-btw", provider: "test", ...UTILITY_AGENT_PARAMS }).features?.memory).toBe(true);
  });

  it("builds from the source with the memory-off params spread in", () => {
    const src = readFileSync(join(import.meta.dir, "../services/chat-btw.ts"), "utf8");
    const at = src.indexOf('agentName: "chat-btw"');
    expect(src.slice(at, at + 200)).toContain("memory: BTW_MEMORY_OFF");
  });
});

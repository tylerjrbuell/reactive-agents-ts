// Run: bun test apps/cortex/server/tests/chat-approval-start.test.ts --timeout 30000
//
// Approving a paused chat turn is a live turn (`ChatApprovals.startResolve`, route
// `POST .../approvals/:runId/:decision/start`): the decision answers at once, the run's gated call,
// result and what follows stream as events, the reply (with the tool calls as its trace) lands when
// the run ends, and a run that holds again on a second gate is held, not looped.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import type { ChatStreamEvent } from "../services/chat-detached-turn.js";
import { applySchema } from "../db/schema.js";
import { chatApprovalStartRoute } from "../api/chat-approval-start-route.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { DetachedTurns } from "../services/chat-detached-turn.js";
import { durableApprovals } from "../services/durable-approvals.js";

let root: string;
let db: Database;
let svc: ChatSessionService;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cortex-approval-start-"));
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});
afterAll(async () => {
  await svc.disposeAll();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** A durable chat whose scripted model calls the gated `shell-execute` once per command, then answers. */
async function shellSession(tag: string, commands: readonly string[]): Promise<string> {
  return svc.createSession({
    agentConfig: {
      provider: "test",
      strategy: "reactive",
      maxIterations: 6,
      tools: ["shell-execute"],
      workspace: mkdtempSync(join(root, `ws-${tag}-`)),
      durableRuns: { enabled: true, dir: join(root, `durable-${tag}`) },
      testScenario: [...commands.map((command) => ({ toolCall: { name: "shell-execute", args: { command } } })), { text: "all done" }],
    },
  });
}

async function pause(id: string): Promise<string> {
  let runId: string | undefined;
  for await (const ev of svc.chatStream(id, "check it")) if (ev._tag === "StreamCompleted") runId = ev.pendingApproval?.runId;
  expect(runId).toBeDefined();
  return runId!;
}

const drain = async (events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const out: ChatStreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
};

describe("startResolve: approve as a live turn", () => {
  it("answers before the run ends, streams the call once with its params, then lands the reply with the call as its trace", async () => {
    const id = await shellSession("one", ["ls"]);
    const runId = await pause(id);

    const started = await svc.approvals.startResolve(id, runId, "approved");
    if (!started.ok) throw new Error(started.message);
    expect(started.message).toBe("check it");
    // Decided and running on: no longer a paused card, not offered from the desk list a second time.
    expect(svc.getSession(id)!.pendingApprovals).toEqual([]);
    expect(durableApprovals.get(runId)).toBeUndefined();
    // The thread has not changed yet: the reply lands when the run ends.
    expect(svc.getSession(id)!.turns).toEqual([]);

    const events = await drain(started.events);
    const calls = events.filter((e) => e._tag === "ToolCallStarted" || e._tag === "ToolCallCompleted");
    expect(calls.map((e) => e._tag)).toEqual(["ToolCallStarted", "ToolCallCompleted"]);
    expect(calls[0]).toMatchObject({ toolName: "shell-execute", args: { command: "ls" } });
    expect(events.at(-1)).toMatchObject({ _tag: "StreamCompleted", output: "all done" });

    const turns = svc.getSession(id)!.turns;
    expect(turns.map((t) => [t.role, t.content])).toEqual([["user", "check it"], ["assistant", "all done"]]);
    // The tool call (with its params) survives a reload: it is in the stored trace.
    expect(turns[1]!.trace?.toolCalls).toMatchObject([{ name: "shell-execute", args: { command: "ls" }, status: "done" }]);
    expect(svc.getSession(id)!.pendingApprovals).toEqual([]);
  }, 30_000);

  it("a second gated call holds the run again with ONE new approval, never the same call twice", async () => {
    const id = await shellSession("two", ["ls", "git status"]);
    const runId = await pause(id);

    const first = await svc.approvals.startResolve(id, runId, "approved");
    if (!first.ok) throw new Error(first.message);
    const firstEvents = await drain(first.events);
    expect(firstEvents.filter((e) => e._tag === "ToolCallStarted")).toHaveLength(1);
    const held = firstEvents.at(-1);
    expect(held).toMatchObject({ _tag: "StreamCompleted", status: "awaiting-approval", pendingApproval: { toolName: "shell-execute", args: { command: "git status" } } });
    // Held again, listed once, with the second call's own params; the first call's turn is still not in the thread.
    const pendings = svc.getSession(id)!.pendingApprovals;
    expect(pendings.map((p) => p.args)).toEqual([{ command: "git status" }]);
    expect(svc.getSession(id)!.turns).toEqual([]);

    const second = await svc.approvals.startResolve(id, runId, "approved");
    if (!second.ok) throw new Error(second.message);
    const secondEvents = await drain(second.events);
    // The first command is not run again by the second approval.
    expect(secondEvents.filter((e) => e._tag === "ToolCallStarted")).toHaveLength(1);
    expect(secondEvents.at(-1)).toMatchObject({ _tag: "StreamCompleted", output: "all done" });
    expect(svc.getSession(id)!.pendingApprovals).toEqual([]);
  }, 30_000);

  it("deny runs no tool and lands the reply", async () => {
    const id = await shellSession("deny", ["ls"]);
    const runId = await pause(id);
    const started = await svc.approvals.startResolve(id, runId, "denied", "not now");
    if (!started.ok) throw new Error(started.message);
    const events = await drain(started.events);
    expect(events.some((e) => e._tag === "ToolCallStarted")).toBe(false);
    expect(events.at(-1)?._tag).toBe("StreamCompleted");
    expect(svc.getSession(id)!.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  }, 30_000);

  it("refuses a second decision while the first is being carried out, and an unknown run", async () => {
    const id = await shellSession("busy", ["ls"]);
    const runId = await pause(id);
    const started = await svc.approvals.startResolve(id, runId, "approved");
    if (!started.ok) throw new Error(started.message);
    expect(await svc.approvals.startResolve(id, runId, "approved")).toMatchObject({ ok: false, code: "busy" });
    expect(await svc.approvals.startResolve(id, "nope", "approved")).toMatchObject({ ok: false, code: "not-found" });
    await drain(started.events);
  }, 30_000);
});

describe("POST .../approvals/:runId/:decision/start", () => {
  it("answers { started } at once and the turn streams from the detached turn", async () => {
    const turns = new DetachedTurns();
    const app = new Elysia().use(chatApprovalStartRoute(svc, turns));
    const id = await shellSession("route", ["ls"]);
    const runId = await pause(id);
    const post = (sid: string, rid: string, decision: string) =>
      app.handle(new Request(`http://localhost/api/chat/sessions/${sid}/approvals/${rid}/${decision}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));

    expect((await post("nope", runId, "approve")).status).toBe(404);
    expect((await post(id, runId, "maybe")).status).toBe(400);
    expect((await post(id, "nope", "approve")).status).toBe(404);
    const res = await post(id, runId, "approve");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ started: true, message: "check it" });
    const turn = turns.get(id)!;
    await turn.whenEnded();
    const seen: string[] = [];
    for await (const n of turn.attach(0)) seen.push(n.event._tag);
    expect(seen).toContain("ToolCallStarted");
    expect(seen.at(-1)).toBe("StreamCompleted");
    expect(svc.getSession(id)!.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  }, 30_000);
});

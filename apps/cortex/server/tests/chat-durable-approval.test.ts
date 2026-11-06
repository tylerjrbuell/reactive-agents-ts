// Run: bun test apps/cortex/server/tests/chat-durable-approval.test.ts --timeout 30000
//
// Chat sessions forward `durableRuns` (+ approval policy) to the agent since the
// builder-controls landing. This drives a REAL chat turn (test provider, tools on)
// whose scripted model calls an approval-gated tool, and pins what happens.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { ChatSessionBusyError, ChatSessionService } from "../services/chat-session-service.js";
import { durableApprovals } from "../services/durable-approvals.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import type { AgentStreamEvent } from "@reactive-agents/runtime";

let root: string;
let db: Database;
let svc: ChatSessionService;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cortex-chat-durable-"));
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("normalizeCortexAgentConfig — durableRuns.dir", () => {
  it("keeps a non-empty durable store dir (was silently dropped)", () => {
    expect(normalizeCortexAgentConfig({ durableRuns: { enabled: true, dir: " /tmp/x " } }).durableRuns).toEqual({
      enabled: true,
      dir: "/tmp/x",
    });
    expect(normalizeCortexAgentConfig({ durableRuns: { enabled: true, dir: "" } }).durableRuns).toEqual({ enabled: true });
  });
});

describe("chat turn with durableRuns + an approval-gated tool", () => {
  it("pauses before the gated tool runs and reports the pending approval", async () => {
    const workspace = mkdtempSync(join(root, "ws-"));
    const durableDir = join(root, "durable");
    const id = await svc.createSession({
      agentConfig: {
        provider: "test",
        strategy: "reactive",
        maxIterations: 4,
        tools: ["file-write"],
        workspace,
        durableRuns: { enabled: true, dir: durableDir, approvalTools: ["file-write"] },
        testScenario: [
          { toolCall: { name: "file-write", args: { path: join(workspace, "gated.txt"), content: "hi" } } },
          { text: "wrote it" },
        ],
      },
    });

    const events: AgentStreamEvent[] = [];
    for await (const ev of svc.chatStream(id, "write the file")) events.push(ev);

    const completed = events.find((e): e is Extract<AgentStreamEvent, { _tag: "StreamCompleted" }> => e._tag === "StreamCompleted");
    expect(completed).toBeDefined();
    // The framework checkpoints and pauses: the gated tool never ran.
    expect(existsSync(join(workspace, "gated.txt"))).toBe(false);
    expect(completed?.pendingApproval?.toolName).toBe("file-write");
    expect(typeof completed?.runId).toBe("string");
    // The durable store was written under the configured dir.
    expect(existsSync(join(durableDir, "runs.db"))).toBe(true);

    await svc.deleteSession(id);
  }, 30_000);

});

/** A session whose scripted model calls the approval-gated `file-write`, then answers. */
async function gatedSession(
  service: ChatSessionService,
  tag: string,
  after: readonly Record<string, unknown>[] = [{ text: "wrote it" }],
): Promise<{ id: string; target: string }> {
  const workspace = mkdtempSync(join(root, `ws-${tag}-`));
  const target = join(workspace, "gated.txt");
  const id = await service.createSession({
    agentConfig: {
      provider: "test",
      strategy: "reactive",
      maxIterations: 4,
      tools: ["file-write"],
      workspace,
      durableRuns: { enabled: true, dir: join(root, `durable-${tag}`), approvalTools: ["file-write"] },
      testScenario: [{ toolCall: { name: "file-write", args: { path: target, content: "hi" } } }, ...after],
    },
  });
  return { id, target };
}

/** Run one streamed turn to its pause; returns the durable runId. */
async function pauseTurn(service: ChatSessionService, id: string): Promise<string> {
  let runId: string | undefined;
  for await (const ev of service.chatStream(id, "write the file")) {
    if (ev._tag === "StreamCompleted") runId = ev.pendingApproval?.runId;
  }
  expect(runId).toBeDefined();
  return runId!;
}

describe("a paused chat turn: listing, approve, deny, restart", () => {
  it("is held as a pending approval (not a 'Run paused' turn), listed for the desk, and blocks new turns", async () => {
    const { id } = await gatedSession(svc, "list");
    const runId = await pauseTurn(svc, id);

    const session = svc.getSession(id)!;
    expect(session.turns).toEqual([]);
    expect(session.pendingApprovals.map((p) => [p.runId, p.toolName, p.userMessage])).toEqual([[runId, "file-write", "write the file"]]);
    const desk = await durableApprovals.listPending();
    expect(desk.find((r) => r.runId === runId)).toMatchObject({ toolName: "file-write", chatSessionId: id });
    await expect(svc.chat(id, "another")).rejects.toBeInstanceOf(ChatSessionBusyError);

    await svc.deleteSession(id);
    expect(durableApprovals.get(runId)).toBeUndefined();
  }, 30_000);

  it("approve resumes the run: the gated tool runs and the reply lands in the thread", async () => {
    const { id, target } = await gatedSession(svc, "approve");
    const runId = await pauseTurn(svc, id);

    const out = await svc.approvals.resolve(id, runId, "approved");
    expect(out).toMatchObject({ ok: true, status: "completed" });
    expect(existsSync(target)).toBe(true);
    const turns = svc.getSession(id)!.turns;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[0]!.content).toBe("write the file");
    expect(turns[1]!.content).toBe(out.ok && out.status === "completed" ? out.reply : "<none>");
    // The scripted model's answer after the approved tool ran, not the "Run paused" notice.
    expect(turns[1]!.content).toContain("wrote it");
    expect(turns[1]!.toolsUsed).toEqual(["file-write"]);
    expect(svc.getSession(id)!.pendingApprovals).toEqual([]);
    expect(durableApprovals.get(runId)).toBeUndefined();

    await svc.deleteSession(id);
  }, 30_000);

  it("deny from the desk registry resumes with the denial: the tool never runs and the reply lands", async () => {
    const { id, target } = await gatedSession(svc, "deny");
    const runId = await pauseTurn(svc, id);

    // The shared /api/runs/:runId/deny path goes through the registry, not the chat route.
    expect(await durableApprovals.decide(runId, "denied", "not now")).toEqual({ ok: true });
    expect(existsSync(target)).toBe(false);
    const turns = svc.getSession(id)!.turns;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[1]!.content.length).toBeGreaterThan(0);
    expect(svc.getSession(id)!.pendingApprovals).toEqual([]);

    await svc.deleteSession(id);
  }, 30_000);

  it("survives a restart: a fresh service restores the pending turn and approving resumes from the durable store", async () => {
    const { id, target } = await gatedSession(svc, "restart");
    const runId = await pauseTurn(svc, id);

    // Simulate a restart: the process-wide registry and every live agent are gone; the DB stays.
    await svc.disposeAll();
    await durableApprovals.finalize(runId);
    const after = new ChatSessionService(db);
    expect(after.approvals.restore()).toBeGreaterThanOrEqual(1);
    expect((await durableApprovals.listPending()).some((r) => r.runId === runId)).toBe(true);

    const out = await after.approvals.resolve(id, runId, "approved");
    expect(out.ok).toBe(true);
    expect(existsSync(target)).toBe(true);

    await after.deleteSession(id);
    await after.disposeAll();
  }, 30_000);

  it("a resumed run that stops to ask the user is held for a reply; answering it finishes the run", async () => {
    const question = "Which file should I write instead?";
    const { id, target } = await gatedSession(svc, "ask", [
      { toolCall: { name: "request_user_input", args: { kind: "confirmation", prompt: question, schema: {} } } },
      { text: "ok, stopping" },
    ]);
    const runId = await pauseTurn(svc, id);

    const out = await svc.approvals.resolve(id, runId, "denied", "not that one");
    expect(out).toMatchObject({ ok: true, status: "awaiting-interaction" });
    expect(existsSync(target)).toBe(false);
    const held = svc.getSession(id)!;
    expect(held.turns).toEqual([]);
    expect(held.pendingApprovals).toEqual([]);
    expect(held.pendingInteractions.map((p) => [p.runId, p.prompt, p.userMessage])).toEqual([[runId, question, "write the file"]]);

    const answered = await svc.approvals.respond(id, runId, false);
    expect(answered).toMatchObject({ ok: true, status: "completed" });
    expect(svc.getSession(id)!.turns.map((t) => [t.role, t.content])).toEqual([
      ["user", "write the file"],
      ["assistant", question],
      ["user", "No"],
      ["assistant", answered.ok && answered.status === "completed" ? answered.reply : "<none>"],
    ]);
    expect(svc.getSession(id)!.pendingInteractions).toEqual([]);

    await svc.deleteSession(id);
  }, 30_000);

  it("the non-stream chat path holds an approval pause too (was saved as a 'Run paused' turn)", async () => {
    const { id, target } = await gatedSession(svc, "nonstream");
    await svc.chat(id, "write the file");
    const session = svc.getSession(id)!;
    expect(session.turns).toEqual([]);
    expect(session.pendingApprovals.map((p) => [p.toolName, p.userMessage])).toEqual([["file-write", "write the file"]]);
    expect(existsSync(target)).toBe(false);
    await svc.deleteSession(id);
  }, 30_000);

  it("dismiss drops a paused turn without resuming it", async () => {
    const { id, target } = await gatedSession(svc, "dismiss");
    const runId = await pauseTurn(svc, id);
    expect(await svc.approvals.dismiss(id, runId)).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(svc.getSession(id)!.pendingApprovals).toEqual([]);
    expect(durableApprovals.get(runId)).toBeUndefined();
    await svc.deleteSession(id);
  }, 30_000);
});

/** A durable session whose scripted model asks the user first (`request_user_input`), then answers. */
async function askingSession(service: ChatSessionService, tag: string, schema: Record<string, unknown> = { options: ["red", "blue"] }): Promise<string> {
  return service.createSession({
    agentConfig: {
      provider: "test",
      strategy: "reactive",
      maxIterations: 4,
      tools: ["file-write"],
      workspace: mkdtempSync(join(root, `ws-${tag}-`)),
      durableRuns: { enabled: true, dir: join(root, `durable-${tag}`) },
      testScenario: [
        { toolCall: { name: "request_user_input", args: { kind: "choice", prompt: "Which colour?", schema } } },
        { text: "Painting it now." },
      ],
    },
  });
}

describe("a chat turn paused on request_user_input", () => {
  it("is held as a pending interaction (not a 'Run paused' turn) and blocks new turns", async () => {
    const id = await askingSession(svc, "ask-first");
    let runId: string | undefined;
    for await (const ev of svc.chatStream(id, "paint the wall")) {
      if (ev._tag === "StreamCompleted") runId = ev.pendingInteraction?.runId;
    }
    expect(runId).toBeDefined();
    const session = svc.getSession(id)!;
    expect(session.turns).toEqual([]);
    expect(session.pendingInteractions).toMatchObject([
      { runId, sessionId: id, userMessage: "paint the wall", kind: "choice", prompt: "Which colour?", schema: { options: ["red", "blue"] } },
    ]);
    expect(svc.approvals.hasPending(id)).toBe(true);
    await expect(svc.chat(id, "another")).rejects.toBeInstanceOf(ChatSessionBusyError);
    // Not an approval: the desk approval list does not show it.
    expect((await durableApprovals.listPending()).some((r) => r.runId === runId)).toBe(false);
    await svc.deleteSession(id);
  }, 30_000);

  it("respond resumes the run with the answer; question and answer land in the thread", async () => {
    const id = await askingSession(svc, "ask-respond");
    let runId = "";
    for await (const ev of svc.chatStream(id, "paint the wall")) {
      if (ev._tag === "StreamCompleted") runId = ev.pendingInteraction?.runId ?? "";
    }
    const out = await svc.approvals.respond(id, runId, "blue");
    expect(out).toMatchObject({ ok: true, status: "completed", reply: "Painting it now." });
    expect(svc.getSession(id)!.turns.map((t) => [t.role, t.content])).toEqual([
      ["user", "paint the wall"],
      ["assistant", "Which colour?"],
      ["user", "blue"],
      ["assistant", "Painting it now."],
    ]);
    expect(svc.getSession(id)!.pendingInteractions).toEqual([]);
    expect(svc.approvals.hasPending(id)).toBe(false);
    await svc.deleteSession(id);
  }, 30_000);

  it("respond on an unknown run is not-found; dismiss drops the held turn", async () => {
    const id = await askingSession(svc, "ask-dismiss");
    let runId = "";
    for await (const ev of svc.chatStream(id, "paint the wall")) {
      if (ev._tag === "StreamCompleted") runId = ev.pendingInteraction?.runId ?? "";
    }
    expect(await svc.approvals.respond(id, "nope", "x")).toMatchObject({ ok: false, code: "not-found" });
    expect(await svc.approvals.dismiss(id, runId)).toBe(true);
    expect(svc.getSession(id)!.pendingInteractions).toEqual([]);
    expect(svc.approvals.hasPending(id)).toBe(false);
    await svc.deleteSession(id);
  }, 30_000);
});

describe("answerText", () => {
  it("renders an interaction answer as the user's thread message", async () => {
    const { answerText } = await import("../services/chat-approvals.js");
    expect(answerText("blue")).toBe("blue");
    expect(answerText(true)).toBe("Yes");
    expect(answerText(false)).toBe("No");
    expect(answerText({ name: "Ada", age: 36 })).toBe("name: Ada\nage: 36");
    expect(answerText(3)).toBe("3");
  });
});

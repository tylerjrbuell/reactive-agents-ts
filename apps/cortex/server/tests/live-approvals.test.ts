// Run: bun test apps/cortex/server/tests/live-approvals.test.ts --timeout 30000
//
// Tool approvals without durable runs (runtime 078365780): a `detach` gate makes
// the run wait LIVE in process. Cortex lists the wait through the running agent
// (`durableApprovals.watchLive`) and Approve / Deny answer it; the same run
// continues. No durable store is configured anywhere here.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { Effect, Layer } from "effect";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexIngestService } from "../services/ingest-service.js";
import { CortexRunnerService, CortexRunnerServiceLive } from "../services/runner-service.js";
import { applySchema } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { approvalsWaitLive, durableApprovals, type LiveApprovableAgent } from "../services/durable-approvals.js";

let root: string;
let db: Database;
let svc: ChatSessionService;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cortex-live-approval-"));
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});
afterAll(async () => {
  await svc.disposeAll();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("approvalsWaitLive", () => {
  it("is true for a detach gate without durable runs only", () => {
    expect(approvalsWaitLive({ approvalPolicy: { mode: "detach" } })).toBe(true);
    expect(approvalsWaitLive({ approvalPolicy: { mode: "detach" }, durableRuns: { enabled: true } })).toBe(false);
    expect(approvalsWaitLive({ approvalPolicy: { mode: "block" } })).toBe(false);
    expect(approvalsWaitLive({})).toBe(false);
  });
});

describe("durableApprovals live sources", () => {
  const fake = (rows: { runId: string; gateId: string; toolName: string; args: unknown }[], calls: string[]): LiveApprovableAgent =>
    ({
      listPendingApprovals: async () => rows.map((r) => ({ ...r, task: "", updatedAt: 0 })),
      approveRun: async (runId: string) => {
        calls.push(`approve:${runId}`);
        return {} as never;
      },
      denyRun: async (runId: string, reason: string) => {
        calls.push(`deny:${runId}:${reason}`);
        return {} as never;
      },
    }) as unknown as LiveApprovableAgent;

  it("lists a live wait with its agent and chat session, answers it, and forgets the source once unwatched", async () => {
    const calls: string[] = [];
    const rows = [{ runId: "live-1", gateId: "g1", toolName: "shell-execute", args: { command: "git push" } }];
    const unwatch = durableApprovals.watchLive({ agentId: "chat-agent", agent: fake(rows, calls), chatSessionId: "s1" });
    try {
      const listed = await durableApprovals.listPending();
      expect(listed.find((r) => r.runId === "live-1")).toEqual({
        runId: "live-1",
        agentId: "chat-agent",
        gateId: "g1",
        toolName: "shell-execute",
        args: { command: "git push" },
        chatSessionId: "s1",
      });
      expect(await durableApprovals.decide("live-1", "approved")).toEqual({ ok: true });
      expect(await durableApprovals.decide("live-1", "denied", "not now")).toEqual({ ok: true });
      expect(calls).toEqual(["approve:live-1", "deny:live-1:not now"]);
      expect((await durableApprovals.decide("nobody", "approved")).ok).toBe(false);
    } finally {
      unwatch();
    }
    expect((await durableApprovals.listPending()).some((r) => r.runId === "live-1")).toBe(false);
    expect((await durableApprovals.decide("live-1", "approved")).ok).toBe(false);
  });
});

/** A chat session whose scripted model calls the gated `file-write`, then answers. No durable runs. */
async function liveGatedSession(tag: string): Promise<{ id: string; target: string }> {
  const workspace = mkdtempSync(join(root, `ws-${tag}-`));
  const target = join(workspace, "gated.txt");
  const id = await svc.createSession({
    agentConfig: {
      provider: "test",
      strategy: "reactive",
      maxIterations: 4,
      tools: ["file-write"],
      workspace,
      approvalPolicy: { mode: "detach", tools: ["file-write"] },
      testScenario: [{ toolCall: { name: "file-write", args: { path: target, content: "hi" } } }, { text: "wrote it" }],
    },
  });
  return { id, target };
}

/** Drive one chat turn; when the run asks, decide it from the desk registry (as the UI does). */
async function turnWithDecision(id: string, decision: "approved" | "denied"): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const ev of svc.chatStream(id, "write the file")) {
    events.push(ev);
    if (ev._tag === "ApprovalRequested") {
      // The wait is listed for the desk with its chat session, then answered live.
      const listed = (await durableApprovals.listPending()).find((r) => r.runId === ev.runId);
      expect(listed).toMatchObject({ toolName: "file-write", chatSessionId: id });
      expect(await durableApprovals.decide(ev.runId, decision, decision === "denied" ? "Not this file." : undefined)).toEqual({ ok: true });
    }
  }
  return events;
}

describe("a desk run waiting live on an approval (no durable runs)", () => {
  const buildRunner = () => {
    const runDb = new Database(":memory:");
    applySchema(runDb);
    const ingest = Layer.succeed(CortexIngestService, { handleEvent: () => Effect.void, getSubscriberCount: () => Effect.succeed(0) });
    return CortexRunnerServiceLive.pipe(Layer.provide(Layer.merge(CortexStoreServiceLive(runDb), ingest)));
  };

  it("is listed through the running agent and Approve from the desk lets the same run finish", async () => {
    const workspace = mkdtempSync(join(root, "ws-desk-"));
    const target = join(workspace, "desk.txt");
    const program = Effect.gen(function* () {
      const runner = yield* CortexRunnerService;
      const { runId } = yield* runner.start({
        provider: "test",
        prompt: "write the desk file",
        strategy: "reactive",
        maxIterations: 4,
        tools: ["file-write"],
        workspace,
        approvalPolicy: { mode: "detach", tools: ["file-write"] },
        testScenario: [{ toolCall: { name: "file-write", args: { path: target, content: "desk" } } }, { text: "wrote it" }],
      } as never);
      // Wait for the live wait to be listed (the run asks once it reaches the gated call).
      let listed: readonly { runId: string; agentId: string; toolName: string }[] = [];
      for (let i = 0; i < 100 && listed.length === 0; i++) {
        listed = yield* runner.listPendingApprovals();
        if (listed.length === 0) yield* Effect.sleep("50 millis");
      }
      expect(listed.map((r) => r.toolName)).toEqual(["file-write"]);
      expect(existsSync(target)).toBe(false);
      yield* runner.approveApproval(listed[0]!.runId as never);
      // The same run carries on and finishes: the tool ran, the run left the active map.
      for (let i = 0; i < 100 && (yield* runner.getActive()).has(runId); i++) yield* Effect.sleep("50 millis");
      expect(existsSync(target)).toBe(true);
      expect(yield* runner.listPendingApprovals()).toEqual([]);
    });
    await Effect.runPromise(program.pipe(Effect.provide(buildRunner())));
  }, 30_000);
});

describe("a chat turn waiting live on an approval (no durable runs)", () => {
  it("Approve continues the same run: the gated tool runs and the turn completes", async () => {
    const { id, target } = await liveGatedSession("approve");
    const events = await turnWithDecision(id, "approved");
    const asked = events.find((e) => e._tag === "ApprovalRequested");
    expect(asked).toMatchObject({ toolName: "file-write" });
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("hi");
    const done = events.find((e): e is Extract<AgentStreamEvent, { _tag: "StreamCompleted" }> => e._tag === "StreamCompleted");
    expect(done?.pendingApproval).toBeUndefined();
    // Nothing is held: the reply landed in the thread like any turn.
    const session = svc.getSession(id)!;
    expect(session.pendingApprovals).toEqual([]);
    expect(session.turns.length).toBeGreaterThan(0);
    await svc.deleteSession(id);
  }, 30_000);

  it("Deny refuses the call: the tool never runs and the turn still ends", async () => {
    const { id, target } = await liveGatedSession("deny");
    const events = await turnWithDecision(id, "denied");
    expect(events.some((e) => e._tag === "ApprovalRequested")).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(events.some((e) => e._tag === "StreamCompleted")).toBe(true);
    expect(svc.getSession(id)!.pendingApprovals).toEqual([]);
    await svc.deleteSession(id);
  }, 30_000);
});

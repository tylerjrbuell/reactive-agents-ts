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
import { ChatSessionService } from "../services/chat-session-service.js";
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

  // Known Cortex gap (2026-11-05): the paused chat turn is persisted as an ordinary
  // assistant reply ("Run paused — awaiting human approval.") and the paused agent is
  // never registered in `durableApprovals` (only runner-service registers desk runs),
  // so GET /api/runs/pending-approvals does not list it and nothing can approve/deny
  // it. Approving also needs the resumed output to land back in the chat thread.
  it.todo("a paused chat turn is listed in pending approvals and approve/deny resumes it into the thread", () => {});
});

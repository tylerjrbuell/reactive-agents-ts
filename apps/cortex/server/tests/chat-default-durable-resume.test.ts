// End to end, default config: a chat made with NO durableRuns setting (only a store dir) is
// durable, so a Stop leaves a resumable run, and Continue streams the resumed run's progress
// live (tool calls as they happen, then the end) and stores the exchange.
import { afterAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatStreamEvent as AgentStreamEvent } from "../services/chat-detached-turn.js";
import { applySchema } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { interruptChatTurn } from "../services/chat-run-control.js";
import { parseResumeInput } from "../services/loop-stop-resume.js";
import { rmTmpDirs, tmpDir } from "./helpers/tmp-db.js";

afterAll(() => rmTmpDirs());

const workspace = tmpDir("default-durable-ws");
const file = join(workspace, "notes.txt");
writeFileSync(file, "hello");
const read = { toolCall: { name: "file-read", args: { path: file } }, delayMs: 250 };

describe("default durable chat: Stop leaves a run, Continue streams it live", () => {
  it("stops mid-run, lists the run, then continues with live progress and the stored exchange", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const svc = new ChatSessionService(db);
    // No `enabled` key: the default decides.
    const id = await svc.createSession({
      agentConfig: {
        provider: "test", model: "m", strategy: "reactive", maxIterations: 12, tools: ["file-read"], workspace,
        durableRuns: { dir: tmpDir("default-durable") },
        testScenario: [read, read, read, read, read, read, { text: "all read. FINAL" }],
      },
    });

    // Turn 1: stop it after its first tool call.
    const first: AgentStreamEvent[] = [];
    let stopped: Awaited<ReturnType<typeof interruptChatTurn>> | undefined;
    for await (const ev of svc.chatStream(id, "read the hostname a few times")) {
      first.push(ev);
      if (ev._tag === "ToolCallCompleted" && stopped === undefined) stopped = await interruptChatTurn(svc, id, "stop");
    }
    expect(stopped?.persisted).toBe(true);

    // The stop left a resumable run, with no durableRuns.enabled anywhere in the config.
    const listed = await svc.resume.list(id);
    expect(listed.length).toBe(1);
    expect(listed[0]?.kind).toBe("user-stopped");

    // Continue as a live turn: progress arrives before the end.
    const input = parseResumeInput({ note: "go on" });
    if (!input.ok) throw new Error("bad input");
    const out = await svc.resume.startStream(id, listed[0]!.runId, input);
    if (!out.ok) throw new Error(`not started: ${out.message}`);
    const live: AgentStreamEvent[] = [];
    for await (const ev of out.events) live.push(ev);
    const tags = live.map((e) => e._tag);
    expect(tags.some((t) => t === "ToolCallStarted" || t === "ToolCallCompleted" || t === "IterationProgress")).toBe(true);
    expect(tags.at(-1)).toBe("StreamCompleted");
    expect(tags.indexOf("StreamCompleted")).toBe(tags.length - 1); // progress first, the end last

    // The exchange is stored as the next turn, and the run is no longer listed as resumable.
    expect(getChatTurns(db, id).some((t) => t.role === "user" && t.content === "Continue: go on")).toBe(true);
    await svc.disposeAll();
    db.close();
  }, 60_000);
});

# Gateway Chat Mode + Memory Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two memory rendering bugs, add `channels.mode: 'chat' | 'task'` to the gateway with per-sender conversation history + episodic context injection + SQLite session persistence, and add an auto-compaction gate so the always-on gateway never grows unbounded memory.

**Architecture:** `GatewayChatManager` (new `packages/runtime/src/gateway-chat.ts`) owns per-sender `ChatMessage[]` maps, session load/save via `SessionStoreService`, episodic context queries via `EpisodicMemoryService`, and builds enriched instructions that are passed to the existing `executeEvent()` path — same ReAct loop as today, with history context stacked into the instruction. The gateway tick runs `compactProgressive` + episodic log prune on a daily gate. Two existing working-tree memory rendering bugs ship as-is after test verification.

**Tech Stack:** Bun, Effect-TS, SQLite (`@reactive-agents/memory` services), TypeScript strict.

---

## File Map

| Status | File | Change |
|--------|------|--------|
| Modified (working tree) | `packages/reasoning/src/context/context-manager.ts` | Render `priorContext` — ship as-is |
| Modified (working tree) | `packages/runtime/src/execution-engine.ts` | Remove `enableSelfImprovement` gate on episodic injection — ship as-is |
| Modified (working tree) | `packages/reasoning/tests/strategies/kernel/react-kernel.test.ts` | priorContext test — ship as-is |
| Modify | `packages/runtime/src/chat.ts` | Add `extraContext?: string` to `ChatOptions` |
| Modify | `packages/memory/src/types.ts` | Add `"chat-turn"` to `DailyLogEntry.eventType` literal union |
| Modify | `packages/memory/src/compaction/compaction-service.ts` | Add `pruneEpisodicLog(agentId, ttlDays)` |
| Modify | `packages/memory/src/index.ts` | Export `pruneEpisodicLog` type + re-export |
| Modify | `packages/gateway/src/types.ts` | Add `mode` + `sessionTtlDays` to channel config schema |
| Modify | `packages/runtime/src/builder.ts` | Add fields to `GatewayOptions`; swap channel handler; add compaction gate |
| **Create** | `packages/runtime/src/gateway-chat.ts` | `GatewayChatManager` class + pure utilities |
| Modify | `packages/memory/tests/compaction-service.test.ts` | Add `pruneEpisodicLog` tests |
| Modify | `packages/runtime/tests/gateway-builder.test.ts` | Add `channels.mode` + `sessionTtlDays` type test |
| **Create** | `packages/runtime/tests/gateway-chat.test.ts` | Unit tests for `GatewayChatManager` + utilities |

---

## Task 1: Verify and commit working-tree memory fixes

**Files:**
- Verify: `packages/reasoning/src/context/context-manager.ts`
- Verify: `packages/runtime/src/execution-engine.ts`
- Test: `packages/reasoning/tests/strategies/kernel/react-kernel.test.ts`

- [ ] **Step 1: Run the affected test suite to confirm the working-tree changes are green**

```bash
bun test packages/reasoning/tests/strategies/kernel/react-kernel.test.ts
```

Expected: all tests pass including the `"injects priorContext into the thought prompt"` test.

- [ ] **Step 2: Commit the three modified files**

```bash
git add packages/reasoning/src/context/context-manager.ts \
        packages/runtime/src/execution-engine.ts \
        packages/reasoning/tests/strategies/kernel/react-kernel.test.ts
git commit -m "fix(memory): render priorContext in system prompt + inject all episodic event types"
```

---

## Task 2: Add `ChatOptions.extraContext`

**Files:**
- Modify: `packages/runtime/src/chat.ts:50-55` (ChatOptions interface)
- Modify: `packages/runtime/src/chat.ts:177-211` (directChat function)
- Test: `packages/runtime/tests/chat.test.ts`

- [ ] **Step 1: Read the existing `chat.test.ts` to understand the test pattern**

```bash
# Check first 40 lines
head -40 packages/runtime/tests/chat.test.ts
```

- [ ] **Step 2: Write a failing test for extraContext injection**

Add to the bottom of `packages/runtime/tests/chat.test.ts`:

```typescript
describe("directChat extraContext", () => {
  it("prepends extraContext to system prompt when provided", async () => {
    const { directChat } = await import("../src/chat.js");
    const { TestLLMServiceLayer } = await import("@reactive-agents/llm-provider");

    // The test LLM matches on system prompt content via the messages passed.
    // We verify extraContext appears by matching on it in the layer response.
    const layer = TestLLMServiceLayer([
      { match: "gateway-activity-marker", text: "seen the extra context" },
    ]);

    const reply = await Effect.runPromise(
      directChat(
        "hello",
        [],
        "base context",
        "--- Recent gateway activity ---\ngateway-activity-marker",
      ).pipe(Effect.provide(layer)),
    );
    expect(reply.message).toBe("seen the extra context");
  });

  it("works normally when extraContext is undefined", async () => {
    const { directChat } = await import("../src/chat.js");
    const { TestLLMServiceLayer } = await import("@reactive-agents/llm-provider");

    const layer = TestLLMServiceLayer([
      { match: "hello", text: "hi there" },
    ]);

    const reply = await Effect.runPromise(
      directChat("hello", [], "", undefined).pipe(Effect.provide(layer)),
    );
    expect(reply.message).toBe("hi there");
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

```bash
bun test packages/runtime/tests/chat.test.ts --test-name-pattern "directChat extraContext"
```

Expected: FAIL — `directChat` only accepts 3 args.

- [ ] **Step 4: Add `extraContext` to `ChatOptions` in `packages/runtime/src/chat.ts`**

Find the `ChatOptions` interface (around line 50) and add the field:

```typescript
export interface ChatOptions {
  /** Override automatic tool-need detection. Default: auto-detected via heuristic */
  useTools?: boolean
  /** Maximum iterations for the tool-capable path. Default: 5 */
  maxIterations?: number
  /** Optional context prepended to the system context summary (direct-LLM path only). */
  extraContext?: string
}
```

- [ ] **Step 5: Update `directChat` signature and system prompt assembly**

Find `directChat` (around line 177). Change the signature and system prompt construction:

```typescript
export function directChat(
  message: string,
  history: ChatMessage[],
  contextSummary: string,
  extraContext?: string,
): Effect.Effect<ChatReply, Error, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;

    const fullContext = [extraContext, contextSummary].filter(Boolean).join("\n\n---\n\n");

    const systemPrompt = fullContext
      ? `You are a helpful AI assistant. Here is context from a recent agent run:\n\n${fullContext}\n\nAnswer conversationally and concisely.`
      : "You are a helpful AI assistant. Answer conversationally and concisely.";
    // ... rest of function unchanged
```

- [ ] **Step 6: Pass `extraContext` through in `agent.chat()` direct-LLM path**

Find the `directChat(message, ...)` call inside `chat()` in `builder.ts` (around line 5117) and pass the option through:

```typescript
const reply = await this.runtime.runPromise(
  directChat(
    message,
    _history ?? this._chatHistory,
    contextSummary,
    options?.extraContext,
  )
)
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
bun test packages/runtime/tests/chat.test.ts
```

Expected: all pass including the two new extraContext tests.

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/chat.ts packages/runtime/src/builder.ts \
        packages/runtime/tests/chat.test.ts
git commit -m "feat(chat): add ChatOptions.extraContext for episodic context injection"
```

---

## Task 3: Add `pruneEpisodicLog` to CompactionService + extend `DailyLogEntry.eventType`

**Files:**
- Modify: `packages/memory/src/types.ts` (add `"chat-turn"` to `DailyLogEntry.eventType` literal)
- Modify: `packages/memory/src/compaction/compaction-service.ts`
- Modify: `packages/memory/src/index.ts`
- Test: `packages/memory/tests/compaction-service.test.ts`

- [ ] **Step 1: Add `"chat-turn"` to `DailyLogEntry.eventType` in `packages/memory/src/types.ts`**

Find the `Schema.Literal(` block starting at line 140 and add `"chat-turn"`:

```typescript
eventType: Schema.Literal(
  "task-started",
  "task-completed",
  "task-failed",
  "decision-made",
  "error-encountered",
  "user-feedback",
  "tool-call",
  "observation",
  "chat-turn",   // ← add this
),
```

Run all memory tests to confirm no regressions:

```bash
bun test packages/memory/tests/
```

Expected: all pass.

- [ ] **Step 2: Read the existing compaction-service test to understand the DB setup pattern**

```bash
head -60 packages/memory/tests/compaction-service.test.ts
```

- [ ] **Step 3: Write the failing test for `pruneEpisodicLog`**

Add at the bottom of `packages/memory/tests/compaction-service.test.ts`:

```typescript
describe("pruneEpisodicLog", () => {
  it("deletes old episodic entries beyond TTL while preserving strategy-outcome and reflexion-critique", async () => {
    // Re-use whatever DB setup the existing tests use in this file.
    // Insert 3 episodic rows: one recent, one old-generic, one old-strategy-outcome.
    const now = Date.now();
    const oldDate = new Date(now - 40 * 86400000).toISOString(); // 40 days ago
    const recentDate = new Date(now - 1 * 86400000).toISOString(); // 1 day ago

    // Insert directly via the same db handle used by the test suite
    await db.exec(
      `INSERT INTO episodic_log (id, agent_id, date, content, event_type, metadata, created_at)
       VALUES
         ('ep-old-generic',   'agent-prune', '2026-01-01', 'old generic',   'task-completed',     '{}', ?),
         ('ep-old-strategy',  'agent-prune', '2026-01-01', 'old strategy',  'strategy-outcome',   '{}', ?),
         ('ep-recent-generic','agent-prune', '2026-01-01', 'recent generic','task-completed',     '{}', ?)`,
      [oldDate, oldDate, recentDate],
    );

    const deleted = await Effect.runPromise(
      compactionService.pruneEpisodicLog("agent-prune", 30),
    );

    expect(deleted).toBe(1); // only ep-old-generic deleted

    // Confirm what remains
    const remaining = await db.query<{ id: string }>(
      `SELECT id FROM episodic_log WHERE agent_id = 'agent-prune'`,
      [],
    );
    const ids = remaining.map((r) => r.id).sort();
    expect(ids).toEqual(["ep-old-strategy", "ep-recent-generic"].sort());
  });
});
```

- [ ] **Step 4: Run to confirm it fails**

```bash
bun test packages/memory/tests/compaction-service.test.ts --test-name-pattern "pruneEpisodicLog"
```

Expected: FAIL — `pruneEpisodicLog` is not a function.

- [ ] **Step 5: Add `pruneEpisodicLog` to the `CompactionService` tag interface**

In `packages/memory/src/compaction/compaction-service.ts`, add to the service interface:

```typescript
export class CompactionService extends Context.Tag("CompactionService")<
  CompactionService,
  {
    // ... existing methods ...

    /** Prune episodic_log entries older than ttlDays, preserving strategy-outcome and reflexion-critique. */
    readonly pruneEpisodicLog: (
      agentId: string,
      ttlDays: number,
    ) => Effect.Effect<number, DatabaseError>;
  }
>() {}
```

- [ ] **Step 6: Implement `pruneEpisodicLog` in `CompactionServiceLive`**

Inside the `return { ... }` block of `CompactionServiceLive`, add:

```typescript
pruneEpisodicLog: (agentId, ttlDays) =>
  Effect.gen(function* () {
    const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
    const deleted = yield* db.exec(
      `DELETE FROM episodic_log
       WHERE agent_id = ?
         AND created_at < ?
         AND event_type NOT IN ('strategy-outcome', 'reflexion-critique')`,
      [agentId, cutoff],
    );
    return deleted;
  }),
```

- [ ] **Step 7: Export `pruneEpisodicLog` from the memory package index**

Open `packages/memory/src/index.ts` and find the compaction export block. Add the new method to the re-export — since it's on the `CompactionService` tag the existing export already covers it, but confirm:

```bash
grep -n "CompactionService\|compaction" packages/memory/src/index.ts
```

If the `CompactionService` tag is already exported, no change is needed. If only specific methods are re-exported, add `pruneEpisodicLog` to that list.

- [ ] **Step 8: Run tests**

```bash
bun test packages/memory/tests/compaction-service.test.ts
```

Expected: all pass including the new `pruneEpisodicLog` test.

- [ ] **Step 9: Commit**

```bash
git add packages/memory/src/types.ts \
        packages/memory/src/compaction/compaction-service.ts \
        packages/memory/src/index.ts \
        packages/memory/tests/compaction-service.test.ts
git commit -m "feat(memory): add chat-turn eventType + pruneEpisodicLog to CompactionService"
```

---

## Task 4: Add `mode` + `sessionTtlDays` to gateway types and `GatewayOptions`

**Files:**
- Modify: `packages/gateway/src/types.ts:116-128` (channels schema)
- Modify: `packages/runtime/src/builder.ts:531-543` (GatewayOptions.channels)
- Test: `packages/runtime/tests/gateway-builder.test.ts`

- [ ] **Step 1: Add fields to the channels schema in `packages/gateway/src/types.ts`**

Find the `channels` schema inside `GatewayConfigSchema` (around line 116) and add two optional fields:

```typescript
channels: Schema.optional(Schema.Struct({
  accessPolicy: Schema.optionalWith(
    Schema.Literal("allowlist", "blocklist", "open"),
    { default: () => "allowlist" as const },
  ),
  allowedSenders: Schema.optional(Schema.Array(Schema.String)),
  blockedSenders: Schema.optional(Schema.Array(Schema.String)),
  unknownSenderAction: Schema.optionalWith(
    Schema.Literal("skip", "escalate"),
    { default: () => "skip" as const },
  ),
  replyToUnknown: Schema.optional(Schema.String),
  /** How incoming channel messages are handled. Default: 'chat'. */
  mode: Schema.optionalWith(
    Schema.Literal("chat", "task"),
    { default: () => "chat" as const },
  ),
  /** Days of inactivity before a chat session is pruned. Default: 30. */
  sessionTtlDays: Schema.optionalWith(Schema.Number, { default: () => 30 }),
})),
```

- [ ] **Step 2: Add the same fields to `GatewayOptions.channels` in `packages/runtime/src/builder.ts`**

Find the `GatewayOptions` interface channels block (around line 532) and add:

```typescript
readonly channels?: {
  readonly accessPolicy?: 'allowlist' | 'blocklist' | 'open'
  readonly allowedSenders?: string[]
  readonly blockedSenders?: string[]
  readonly unknownSenderAction?: 'skip' | 'escalate'
  readonly replyToUnknown?: string
  /** How incoming channel messages are handled. Default: 'chat'. */
  readonly mode?: 'chat' | 'task'
  /** Days of inactivity before a persisted chat session is pruned. Default: 30. */
  readonly sessionTtlDays?: number
}
```

- [ ] **Step 3: Write a type-level test in `packages/runtime/tests/gateway-builder.test.ts`**

Add to the existing describe block:

```typescript
test("gateway channels accepts mode and sessionTtlDays", async () => {
  const { ReactiveAgents } = await import("../src/builder");
  const builder = ReactiveAgents.create()
    .withName("test-gw-chat")
    .withProvider("test")
    .withGateway({
      channels: {
        accessPolicy: "allowlist",
        allowedSenders: ["+15551234567"],
        mode: "chat",
        sessionTtlDays: 14,
      },
    });
  expect(builder).toBeDefined();
});

test("gateway channels mode defaults to chat when omitted", async () => {
  const { ReactiveAgents } = await import("../src/builder");
  // Should compile and not throw — mode is optional
  const builder = ReactiveAgents.create()
    .withName("test-gw-default-mode")
    .withProvider("test")
    .withGateway({ channels: { accessPolicy: "open" } });
  expect(builder).toBeDefined();
});
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/runtime/tests/gateway-builder.test.ts
```

Expected: all pass including the two new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/types.ts \
        packages/runtime/src/builder.ts \
        packages/runtime/tests/gateway-builder.test.ts
git commit -m "feat(gateway): add channels.mode and sessionTtlDays to GatewayOptions"
```

---

## Task 5: Create `GatewayChatManager` — pure utilities

**Files:**
- Create: `packages/runtime/src/gateway-chat.ts`
- Create: `packages/runtime/tests/gateway-chat.test.ts`

- [ ] **Step 1: Write failing tests for the pure utility functions**

Create `packages/runtime/tests/gateway-chat.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import {
  applyHistoryWindow,
  formatHistoryBlock,
  formatEpisodicContext,
  buildEnrichedInstruction,
} from "../src/gateway-chat.js";
import type { ChatMessage } from "../src/chat.js";

const msg = (role: "user" | "assistant", content: string, timestamp = 0): ChatMessage =>
  ({ role, content, timestamp });

describe("applyHistoryWindow", () => {
  test("returns full history when under limits", () => {
    const history = [msg("user", "hello"), msg("assistant", "hi")];
    expect(applyHistoryWindow(history)).toEqual(history);
  });

  test("truncates to last 40 turns", () => {
    const history = Array.from({ length: 50 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`),
    );
    expect(applyHistoryWindow(history)).toHaveLength(40);
    expect(applyHistoryWindow(history)[0]!.content).toBe("msg 10");
  });

  test("truncates when total chars exceed 8000", () => {
    // 10 messages × 1000 chars = 10000 chars — should drop oldest until under 8000
    const history = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", "x".repeat(1000)),
    );
    const windowed = applyHistoryWindow(history);
    const totalChars = windowed.reduce((sum, m) => sum + m.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(8000);
  });

  test("never drops below empty when all messages exceed budget", () => {
    const history = [msg("user", "x".repeat(9000))];
    const windowed = applyHistoryWindow(history);
    expect(windowed).toHaveLength(0);
  });
});

describe("formatHistoryBlock", () => {
  test("returns empty string for empty history", () => {
    expect(formatHistoryBlock([])).toBe("");
  });

  test("formats user and assistant turns with correct labels", () => {
    const history = [
      msg("user", "what are my PRs?"),
      msg("assistant", "You have 3 open PRs."),
    ];
    const block = formatHistoryBlock(history);
    expect(block).toContain("--- Conversation history ---");
    expect(block).toContain("User: what are my PRs?");
    expect(block).toContain("Assistant: You have 3 open PRs.");
  });
});

describe("formatEpisodicContext", () => {
  test("returns empty string for empty episodes", () => {
    expect(formatEpisodicContext([])).toBe("");
  });

  test("formats episodes with event type prefix", () => {
    const episodes = [
      { eventType: "task-completed", content: "Morning brief sent at 09:00." },
      { eventType: "chat-turn", content: "User asked about PRs." },
    ];
    const block = formatEpisodicContext(episodes);
    expect(block).toContain("--- Recent gateway activity ---");
    expect(block).toContain("[task-completed] Morning brief sent at 09:00.");
    expect(block).toContain("[chat-turn] User asked about PRs.");
  });

  test("truncates long content to 300 chars", () => {
    const episodes = [{ eventType: "task-completed", content: "x".repeat(400) }];
    const block = formatEpisodicContext(episodes);
    expect(block).toContain("[task-completed] " + "x".repeat(300));
    expect(block).not.toContain("x".repeat(301));
  });
});

describe("buildEnrichedInstruction", () => {
  test("includes all blocks when all are provided", () => {
    const instruction = buildEnrichedInstruction({
      sender: "+15551234567",
      platform: "signal",
      mcpServer: "signal",
      message: "what did you find?",
      historyBlock: "--- Conversation history ---\nUser: hi",
      episodicBlock: "--- Recent gateway activity ---\n[task-completed] done",
    });
    expect(instruction).toContain("--- Recent gateway activity ---");
    expect(instruction).toContain("--- Conversation history ---");
    expect(instruction).toContain("send_message_to_user");
    expect(instruction).toContain("User: what did you find?");
    expect(instruction).toContain("+15551234567");
  });

  test("omits empty blocks gracefully", () => {
    const instruction = buildEnrichedInstruction({
      sender: "+15551234567",
      platform: "signal",
      mcpServer: "signal",
      message: "hello",
      historyBlock: "",
      episodicBlock: "",
    });
    expect(instruction).not.toContain("Conversation history");
    expect(instruction).not.toContain("Recent gateway activity");
    expect(instruction).toContain("User: hello");
  });

  test("includes long-run nudge", () => {
    const instruction = buildEnrichedInstruction({
      sender: "+1555",
      platform: "signal",
      mcpServer: "signal",
      message: "do something",
      historyBlock: "",
      episodicBlock: "",
    });
    expect(instruction).toContain("multiple steps");
    expect(instruction).toContain("send_message_to_user");
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test packages/runtime/tests/gateway-chat.test.ts
```

Expected: FAIL — module `../src/gateway-chat.js` not found.

- [ ] **Step 3: Create `packages/runtime/src/gateway-chat.ts` with the pure utilities**

```typescript
import type { ChatMessage } from "./chat.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TURNS = 40;
const MAX_CHARS = 8_000;
const MAX_EPISODE_CONTENT = 300;

// ─── Pure Utilities ───────────────────────────────────────────────────────────

/**
 * Window conversation history to at most MAX_TURNS turns and MAX_CHARS total.
 * Drops oldest turns first. The full history is preserved elsewhere for
 * persistence — this only affects what gets injected into the LLM instruction.
 */
export function applyHistoryWindow(history: readonly ChatMessage[]): ChatMessage[] {
  let windowed = history.slice(-MAX_TURNS);
  let totalChars = windowed.reduce((sum, m) => sum + m.content.length, 0);
  while (windowed.length > 0 && totalChars > MAX_CHARS) {
    totalChars -= windowed[0]!.content.length;
    windowed = windowed.slice(1);
  }
  return windowed;
}

/**
 * Format a windowed history slice as a labeled conversation block.
 */
export function formatHistoryBlock(history: readonly ChatMessage[]): string {
  if (history.length === 0) return "";
  const lines = history.map((m) =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
  );
  return `--- Conversation history ---\n${lines.join("\n")}`;
}

/**
 * Format recent episodic entries as a gateway activity block.
 */
export function formatEpisodicContext(
  episodes: readonly { eventType?: string; content?: string }[],
): string {
  if (episodes.length === 0) return "";
  const lines = episodes.map((e) => {
    const tag = e.eventType ?? "episodic";
    const body = String(e.content ?? "").slice(0, MAX_EPISODE_CONTENT);
    return `[${tag}] ${body}`;
  });
  return `--- Recent gateway activity ---\n${lines.join("\n")}`;
}

/**
 * Build the full enriched instruction sent to executeEvent().
 * Stacks: episodic context → conversation history → behavioral nudge → user message.
 */
export function buildEnrichedInstruction(params: {
  sender: string;
  platform: string;
  mcpServer: string;
  message: string;
  historyBlock: string;
  episodicBlock: string;
}): string {
  const parts: string[] = [];
  if (params.episodicBlock) parts.push(params.episodicBlock);
  if (params.historyBlock) parts.push(params.historyBlock);
  parts.push(
    `You are in a live conversation with ${params.sender} on ${params.platform}.\n` +
    `If this task will take multiple steps or more than a few seconds, ` +
    `send them a brief acknowledgement first using ${params.mcpServer}/send_message_to_user ` +
    `so they aren't left waiting. Keep them informed at meaningful milestones.\n` +
    `Always send your final response via ${params.mcpServer}/send_message_to_user.\n\n` +
    `User: ${params.message}`,
  );
  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/runtime/tests/gateway-chat.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/gateway-chat.ts \
        packages/runtime/tests/gateway-chat.test.ts
git commit -m "feat(gateway): GatewayChatManager pure utilities"
```

---

## Task 6: Build `GatewayChatManager` stateful class

**Files:**
- Modify: `packages/runtime/src/gateway-chat.ts` (add class)
- Modify: `packages/runtime/tests/gateway-chat.test.ts` (add class tests)

- [ ] **Step 1: Write failing tests for the class**

Add to `packages/runtime/tests/gateway-chat.test.ts`:

```typescript
import { GatewayChatManager } from "../src/gateway-chat.js";

// ─── Stub deps ────────────────────────────────────────────────────────────────

function makeStubDeps(overrides: Partial<{
  findById: (id: string) => Promise<{ messages: { role: "user"|"assistant"; content: string; timestamp: number }[] } | null>;
  executeEvent: (event: unknown, source: string, instruction: string) => Promise<void>;
  logEpisode: (entry: unknown) => Promise<void>;
  saveSession: (input: unknown) => Promise<void>;
  getRecentEpisodes: (agentId: string, limit: number) => Promise<{ eventType?: string; content?: string }[]>;
}> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    deps: {
      agentId: "test-agent",
      sessionTtlDays: 30,
      executeEvent: overrides.executeEvent ?? (async (e, s, i) => { calls.push({ method: "executeEvent", args: [s, i] }); }),
      logEpisode: overrides.logEpisode ?? (async (entry) => { calls.push({ method: "logEpisode", args: [entry] }); }),
      saveSession: overrides.saveSession ?? (async (input) => { calls.push({ method: "saveSession", args: [input] }); }),
      findById: overrides.findById ?? (async (_id) => null),
      getRecentEpisodes: overrides.getRecentEpisodes ?? (async (_agentId, _limit) => []),
      cleanup: async (_ttlDays: number) => 0,
    },
  };
}

describe("GatewayChatManager", () => {
  test("getOrLoadHistory returns empty array when no prior session exists", async () => {
    const { deps } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    const history = await mgr.getOrLoadHistory("+15551234567");
    expect(history).toEqual([]);
  });

  test("getOrLoadHistory restores history from store on first call", async () => {
    const storedMessages = [
      { role: "user" as const, content: "hello", timestamp: 1000 },
      { role: "assistant" as const, content: "hi", timestamp: 1001 },
    ];
    const { deps } = makeStubDeps({
      findById: async (_id) => ({ messages: storedMessages }),
    });
    const mgr = new GatewayChatManager(deps);
    const history = await mgr.getOrLoadHistory("+15551234567");
    expect(history).toEqual(storedMessages);
  });

  test("getOrLoadHistory caches after first load (no second store call)", async () => {
    let callCount = 0;
    const { deps } = makeStubDeps({
      findById: async (_id) => { callCount++; return null; },
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.getOrLoadHistory("+155");
    await mgr.getOrLoadHistory("+155");
    expect(callCount).toBe(1);
  });

  test("handleMessage appends user+assistant turns to history", async () => {
    const { deps } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "what's up?", "signal", "signal", {});
    const history = await mgr.getOrLoadHistory("+155");
    expect(history.length).toBe(2);
    expect(history[0]!.role).toBe("user");
    expect(history[0]!.content).toBe("what's up?");
    expect(history[1]!.role).toBe("assistant");
  });

  test("handleMessage calls executeEvent with enriched instruction containing sender info", async () => {
    const { deps, calls } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+15551234567", "hello", "signal", "signal", {});
    const execCall = calls.find((c) => c.method === "executeEvent");
    expect(execCall).toBeDefined();
    const instruction = execCall!.args[1] as string;
    expect(instruction).toContain("+15551234567");
    expect(instruction).toContain("signal");
    expect(instruction).toContain("User: hello");
  });

  test("handleMessage calls logEpisode with chat-turn eventType", async () => {
    const { deps, calls } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "test msg", "signal", "signal", {});
    const logCall = calls.find((c) => c.method === "logEpisode");
    expect(logCall).toBeDefined();
    const entry = logCall!.args[0] as { eventType: string; content: string };
    expect(entry.eventType).toBe("chat-turn");
    expect(entry.content).toContain("+155");
    expect(entry.content).toContain("test msg");
  });

  test("handleMessage persists updated history after each turn", async () => {
    const { deps, calls } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "first", "signal", "signal", {});
    await mgr.handleMessage("+155", "second", "signal", "signal", {});
    const saveCalls = calls.filter((c) => c.method === "saveSession");
    expect(saveCalls.length).toBe(2);
  });

  test("pruneStaleSessions calls cleanup with ttlDays", async () => {
    const cleanupCalls: number[] = [];
    const { deps } = makeStubDeps({
      cleanup: async (ttl: number) => { cleanupCalls.push(ttl); return 0; },
    } as any);
    const mgr = new GatewayChatManager(deps);
    await mgr.pruneStaleSessions();
    expect(cleanupCalls).toContain(30); // sessionTtlDays default
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test packages/runtime/tests/gateway-chat.test.ts --test-name-pattern "GatewayChatManager"
```

Expected: FAIL — `GatewayChatManager` not exported from gateway-chat.ts.

- [ ] **Step 3: Add the `GatewayChatManagerDeps` interface and `GatewayChatManager` class to `packages/runtime/src/gateway-chat.ts`**

Append after the pure utilities:

```typescript
// ─── GatewayChatManager ───────────────────────────────────────────────────────

/** Dependencies injected by start() — all async, no Effect required. */
export interface GatewayChatManagerDeps {
  readonly agentId: string;
  readonly sessionTtlDays: number;
  readonly executeEvent: (event: unknown, source: string, instruction: string) => Promise<void>;
  readonly logEpisode: (entry: {
    id: string;
    agentId: string;
    date: string;
    content: string;
    eventType: string;
    createdAt: Date;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  readonly saveSession: (input: {
    sessionId: string;
    agentId: string;
    messages: ChatMessage[];
  }) => Promise<void>;
  readonly findById: (sessionId: string) => Promise<{ messages: ChatMessage[] } | null>;
  readonly getRecentEpisodes: (agentId: string, limit: number) => Promise<readonly { eventType?: string; content?: string }[]>;
  readonly cleanup: (ttlDays: number) => Promise<number>;
}

export class GatewayChatManager {
  private readonly histories = new Map<string, ChatMessage[]>();
  private lastPruneAt = 0;

  constructor(private readonly deps: GatewayChatManagerDeps) {}

  private sessionKey(senderId: string): string {
    return `gateway-chat-${this.deps.agentId}-${senderId}`;
  }

  async getOrLoadHistory(senderId: string): Promise<ChatMessage[]> {
    if (this.histories.has(senderId)) {
      return this.histories.get(senderId)!;
    }
    const record = await this.deps.findById(this.sessionKey(senderId));
    const history = (record?.messages ?? []) as ChatMessage[];
    this.histories.set(senderId, history);
    return history;
  }

  async handleMessage(
    sender: string,
    message: string,
    platform: string,
    mcpServer: string,
    gwEvent: unknown,
  ): Promise<void> {
    const history = await this.getOrLoadHistory(sender);

    const [episodes, windowed] = await Promise.all([
      this.deps.getRecentEpisodes(this.deps.agentId, 8),
      Promise.resolve(applyHistoryWindow(history)),
    ]);

    const filtered = episodes.filter((e) => e.eventType !== "chat-turn");
    const episodicBlock = formatEpisodicContext(filtered);
    const historyBlock = formatHistoryBlock(windowed);
    const instruction = buildEnrichedInstruction({
      sender,
      platform,
      mcpServer,
      message,
      historyBlock,
      episodicBlock,
    });

    let runOutput = "(sent via Signal)";
    try {
      await this.deps.executeEvent(gwEvent, "channel", instruction);
    } catch (err) {
      runOutput = `(error: ${err instanceof Error ? err.message : String(err)})`;
    }

    history.push({ role: "user", content: message, timestamp: Date.now() });
    history.push({ role: "assistant", content: runOutput, timestamp: Date.now() });

    const now = new Date();
    await Promise.all([
      this.deps.saveSession({
        sessionId: this.sessionKey(sender),
        agentId: this.deps.agentId,
        messages: history,
      }),
      this.deps.logEpisode({
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: this.deps.agentId,
        date: now.toISOString().slice(0, 10),
        content: `${sender} (${platform}): ${message.slice(0, 200)} → ${runOutput.slice(0, 300)}`,
        eventType: "chat-turn",
        createdAt: now,
        metadata: { sender, platform },
      }),
    ]);
  }

  async pruneStaleSessions(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneAt < 86_400_000) return; // max once per 24h
    this.lastPruneAt = now;
    await this.deps.cleanup(this.deps.sessionTtlDays);
  }

  async dispose(): Promise<void> {
    // All histories are persisted on every turn — no flush needed.
    // Clear in-memory cache so GC can reclaim.
    this.histories.clear();
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/runtime/tests/gateway-chat.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/gateway-chat.ts \
        packages/runtime/tests/gateway-chat.test.ts
git commit -m "feat(gateway): GatewayChatManager stateful class with per-sender history"
```

---

## Task 7: Wire `GatewayChatManager` into `start()` in `builder.ts`

**Files:**
- Modify: `packages/runtime/src/builder.ts` — `start()` method (~line 5513)

- [ ] **Step 1: Add the import for `GatewayChatManager` at the top of builder.ts**

Find the import block in `packages/runtime/src/builder.ts` and add:

```typescript
import {
  GatewayChatManager,
  type GatewayChatManagerDeps,
} from "./gateway-chat.js";
```

- [ ] **Step 2: Locate the three sections in `start()` that need changes**

The sections are:
1. After `obs` is resolved (~line 5595): create `chatManager`
2. The `ChannelMessageReceived` handler (~line 5856): make mode-aware
3. The `stop()` path (~line 5904): dispose chatManager

- [ ] **Step 3: Create `chatManager` after `obs` is resolved in the `loopPromise` block**

After the `obs` resolution try/catch block (~line 5595), add:

```typescript
// ─── Build GatewayChatManager deps (resolve services lazily) ──────────────
const channelMode = (self._gatewayOptions as any)?.channels?.mode ?? "chat";
const sessionTtlDays = (self._gatewayOptions as any)?.channels?.sessionTtlDays ?? 30;

const chatDeps: GatewayChatManagerDeps = {
  agentId: self.agentId ?? "gateway",
  sessionTtlDays,
  executeEvent,
  logEpisode: async (entry) => {
    await self.runtime.runPromise(
      Effect.gen(function* () {
        const memMod = yield* Effect.promise(() => import("@reactive-agents/memory"));
        const svcOpt = yield* Effect.serviceOption(memMod.EpisodicMemoryService);
        if (svcOpt._tag !== "Some") return;
        yield* svcOpt.value.log(entry as any);
      }).pipe(Effect.catchAll(() => Effect.void))
    );
  },
  saveSession: async (input) => {
    await self.runtime.runPromise(
      Effect.gen(function* () {
        const memMod = yield* Effect.promise(() => import("@reactive-agents/memory"));
        const storeOpt = yield* Effect.serviceOption(memMod.SessionStoreService);
        if (storeOpt._tag !== "Some") return;
        yield* storeOpt.value.save(input as any);
      }).pipe(Effect.catchAll(() => Effect.void))
    );
  },
  findById: async (sessionId) => {
    return self.runtime.runPromise(
      Effect.gen(function* () {
        const memMod = yield* Effect.promise(() => import("@reactive-agents/memory"));
        const storeOpt = yield* Effect.serviceOption(memMod.SessionStoreService);
        if (storeOpt._tag !== "Some") return null;
        return yield* storeOpt.value.findById(sessionId);
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))
    );
  },
  getRecentEpisodes: async (agentId, limit) => {
    return self.runtime.runPromise(
      Effect.gen(function* () {
        const memMod = yield* Effect.promise(() => import("@reactive-agents/memory"));
        const episodicOpt = yield* Effect.serviceOption(memMod.EpisodicMemoryService);
        if (episodicOpt._tag !== "Some") return [];
        return yield* episodicOpt.value.getRecent(agentId, limit);
      }).pipe(Effect.catchAll(() => Effect.succeed([])))
    );
  },
  cleanup: async (ttlDays) => {
    return self.runtime.runPromise(
      Effect.gen(function* () {
        const memMod = yield* Effect.promise(() => import("@reactive-agents/memory"));
        const storeOpt = yield* Effect.serviceOption(memMod.SessionStoreService);
        if (storeOpt._tag !== "Some") return 0;
        return yield* storeOpt.value.cleanup(ttlDays);
      }).pipe(Effect.catchAll(() => Effect.succeed(0)))
    );
  },
};

const chatManager = new GatewayChatManager(chatDeps);
```

Note: `executeEvent` is already defined as a local `async` function earlier in the same scope — it's captured by closure here.

- [ ] **Step 4: Replace the channel message handler with a mode-aware dispatch**

Find the existing handler inside the `eb.on('ChannelMessageReceived', ...)` callback (around line 5856). Replace the `if (channelDecision.action === 'execute')` block:

```typescript
if (channelDecision.action === "execute") {
  glog(
    "info",
    `channel → ${event.platform} message from ${event.sender}`,
    { message: event.message.slice(0, 80), mode: channelMode },
  )

  if (channelMode === "task") {
    // Original behavior: fire-and-forget agent run, no history
    const instruction = `Respond to this ${event.platform} message from ${event.sender}: "${event.message}". Use the ${event.mcpServer}/send_message_to_user tool to reply.`
    yield* Effect.promise(() =>
      executeEvent(gwEvent, "channel", instruction)
    )
  } else {
    // Chat mode: per-sender history + episodic context + persist
    yield* Effect.promise(() =>
      chatManager.handleMessage(
        event.sender,
        event.message,
        event.platform ?? "unknown",
        event.mcpServer ?? "signal",
        gwEvent,
      )
    )
  }
}
```

- [ ] **Step 5: Add daily pruning to the `tick()` function**

Inside the `tick` async function (around line 5726), after the cron loop, add:

```typescript
// Prune stale chat sessions once per day (no-op if < 24h since last prune)
await chatManager.pruneStaleSessions();
```

- [ ] **Step 6: Add daily compaction gate in the same `tick()` function**

After the prune call, add:

```typescript
// Run compaction once per day when memory is configured
if (Date.now() - lastCompactionAt > 86_400_000) {
  lastCompactionAt = Date.now();
  await self.runtime.runPromise(
    Effect.gen(function* () {
      const memMod = yield* Effect.promise(() => import("@reactive-agents/memory"));
      const compactionOpt = yield* Effect.serviceOption(memMod.CompactionService);
      if (compactionOpt._tag !== "Some") return;
      const agentId = self.agentId ?? "gateway";
      yield* compactionOpt.value.compactProgressive(agentId, {
        strategy: "progressive",
        maxEntries: 1000,
        intervalMs: 30 * 86_400_000,
        decayFactor: 0.05,
      });
      yield* compactionOpt.value.pruneEpisodicLog(agentId, sessionTtlDays);
    }).pipe(Effect.catchAll(() => Effect.void))
  );
}
```

Declare `let lastCompactionAt = 0;` alongside the other `let` declarations at the top of the `loopPromise` async block (near `let heartbeatsFired = 0`).

- [ ] **Step 7: Dispose chatManager in the `stop()` path**

Find the `stop:` function (around line 5904) and add the dispose call:

```typescript
stop: async () => {
  stopped = true
  if (timer) clearInterval(timer)
  unsubChannel?.()
  await chatManager.dispose()   // ← add this line
  const summary: GatewaySummary = {
    heartbeatsFired,
    totalRuns,
    cronChecks,
  }
  resolveStop?.(summary)
  return summary
},
```

- [ ] **Step 8: Run the full gateway test suite**

```bash
bun test packages/runtime/tests/gateway-builder.test.ts \
         packages/runtime/tests/gateway-runtime.test.ts \
         packages/runtime/tests/gateway-start.test.ts \
         packages/runtime/tests/gateway-status.test.ts \
         packages/runtime/tests/gateway-logging.test.ts
```

Expected: all existing gateway tests pass unchanged (chat mode is default but channel events don't fire in these tests).

- [ ] **Step 9: Commit**

```bash
git add packages/runtime/src/builder.ts
git commit -m "feat(gateway): wire GatewayChatManager into start() — mode-aware channel handling + daily compaction"
```

---

## Task 8: Integration test + final verification

**Files:**
- Create: `packages/runtime/tests/gateway-chat-mode.test.ts`

- [ ] **Step 1: Write the integration test**

Create `packages/runtime/tests/gateway-chat-mode.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { applyHistoryWindow, buildEnrichedInstruction, GatewayChatManager } from "../src/gateway-chat.js";
import type { ChatMessage } from "../src/chat.js";

// Integration: confirm the full handleMessage flow preserves history across turns
describe("GatewayChatManager multi-turn history", () => {
  test("second turn includes first turn in windowed history passed to executeEvent", async () => {
    const instructions: string[] = [];

    const deps = {
      agentId: "test",
      sessionTtlDays: 30,
      executeEvent: async (_e: unknown, _s: string, instruction: string) => {
        instructions.push(instruction);
      },
      logEpisode: async () => {},
      saveSession: async () => {},
      findById: async () => null,
      getRecentEpisodes: async () => [],
      cleanup: async () => 0,
    };

    const mgr = new GatewayChatManager(deps);

    await mgr.handleMessage("+155", "what are my PRs?", "signal", "signal", {});
    await mgr.handleMessage("+155", "and the commits?", "signal", "signal", {});

    expect(instructions).toHaveLength(2);
    // Second instruction should contain the first turn's history
    expect(instructions[1]).toContain("what are my PRs?");
    expect(instructions[1]).toContain("Conversation history");
    expect(instructions[1]).toContain("and the commits?");
  });

  test("separate senders have independent histories", async () => {
    const deps = {
      agentId: "test",
      sessionTtlDays: 30,
      executeEvent: async () => {},
      logEpisode: async () => {},
      saveSession: async () => {},
      findById: async () => null,
      getRecentEpisodes: async () => [],
      cleanup: async () => 0,
    };

    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+111", "message from sender A", "signal", "signal", {});
    await mgr.handleMessage("+222", "message from sender B", "signal", "signal", {});

    const histA = await mgr.getOrLoadHistory("+111");
    const histB = await mgr.getOrLoadHistory("+222");

    expect(histA.some((m) => m.content === "message from sender A")).toBe(true);
    expect(histA.some((m) => m.content === "message from sender B")).toBe(false);
    expect(histB.some((m) => m.content === "message from sender B")).toBe(true);
    expect(histB.some((m) => m.content === "message from sender A")).toBe(false);
  });
});

// Config: confirm GatewayOptions accepts new fields
describe("GatewayOptions type acceptance", () => {
  test("builder accepts channels.mode task to preserve original behavior", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const builder = ReactiveAgents.create()
      .withName("test-task-mode")
      .withProvider("test")
      .withGateway({
        channels: {
          accessPolicy: "allowlist",
          allowedSenders: ["+15551234567"],
          mode: "task",
        },
      });
    expect(builder).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
bun test packages/runtime/tests/gateway-chat-mode.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run the full runtime test suite to check for regressions**

```bash
bun test packages/runtime/tests/
```

Expected: all existing tests pass. If any gateway tests fail, inspect — the most likely cause is the `chatManager.dispose()` call in stop() running before the manager was initialized (if the gateway services failed to resolve). Wrap it in `chatManager?.dispose()`.

- [ ] **Step 4: Run the reasoning and memory suites**

```bash
bun test packages/reasoning/tests/ packages/memory/tests/
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/tests/gateway-chat-mode.test.ts
git commit -m "test(gateway): integration tests for chat mode history isolation and multi-turn context"
```

- [ ] **Step 6: Final smoke — run the full repo test suite**

```bash
bun test packages/
```

Expected: all green. Note the total test count in the output — it should be higher than before this branch started (new tests added across 4 packages).

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|------------|
| Bug 1: priorContext not rendered | Task 1 |
| Bug 2: episodic gate behind enableSelfImprovement | Task 1 |
| ChatOptions.extraContext for direct-LLM callers | Task 2 |
| pruneEpisodicLog for episodic_log TTL | Task 3 |
| channels.mode: 'chat' \| 'task', default 'chat' | Task 4 |
| channels.sessionTtlDays, default 30 | Task 4 |
| GatewayChatManager pure utilities | Task 5 |
| Per-sender ChatMessage[] histories | Task 6 |
| Session load from SessionStoreService on first message | Task 6 |
| Persist history after every turn | Task 6 |
| History windowing: 40 turns / 8k chars | Task 5 + 6 |
| Episodic context injected (excluding chat-turn events) | Task 6 |
| Long-run nudge + Signal send directive in instruction | Task 5 |
| ChatTurn logged as episodic row (eventType: 'chat-turn') | Task 6 |
| Mode-aware channel handler in start() | Task 7 |
| pruneStaleSessions in gateway tick (daily gate) | Task 7 |
| Daily compactProgressive + pruneEpisodicLog in tick | Task 7 |
| chatManager.dispose() on gateway stop | Task 7 |
| Integration: multi-turn history, per-sender isolation | Task 8 |

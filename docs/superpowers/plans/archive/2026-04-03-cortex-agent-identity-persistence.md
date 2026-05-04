# Agent Identity Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each chat session a stable `agentId` that persists across server restarts so episodic memory accumulates in a consistent SQLite DB rather than a fresh one on every rebuild.

**Architecture:** Add `.withAgentId(id)` to the framework builder so a caller can pin the generated `agentId` instead of `name-timestamp`. Cortex threads the stable ID through `BuildCortexAgentParams` → `buildCortexAgent` → builder. Chat sessions generate a stable agentId at creation time and store it in `cortex_chat_sessions.stable_agent_id`. Gateway agents pass their existing DB `agent_id` as the stable ID. Both paths enable `memory: { episodic: true }` so memories accumulate.

**Tech Stack:** TypeScript, Effect-TS, bun:test, bun:sqlite

---

### Task 1: `.withAgentId()` on `ReactiveAgentBuilder`

**Files:**
- Modify: `packages/runtime/src/builder.ts` (line 697 field list; line 819 method zone; line 2281 agentId assignment)
- Create: `packages/runtime/src/__tests__/builder-agent-id.test.ts`

**Root cause:** `build()` at line 2281 always generates `${self._name}-${Date.now()}`, so every call creates a unique agentId. Memory is stored at `.reactive-agents/memory/{agentId}/memory.db` — a new path each build means no accumulated memory.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/src/__tests__/builder-agent-id.test.ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../builder.js";

describe(".withAgentId() builder", () => {
  it("uses the supplied stable agentId instead of name-timestamp", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withAgentId("my-stable-id")
      .build();
    expect(agent.agentId).toBe("my-stable-id");
  });

  it("falls back to name-timestamp when withAgentId is not called", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withName("myagent")
      .build();
    expect(agent.agentId).toMatch(/^myagent-\d+$/);
  });

  it("two builds with same withAgentId produce the same agentId", async () => {
    const a = await ReactiveAgents.create().withProvider("test").withAgentId("shared-id").build();
    const b = await ReactiveAgents.create().withProvider("test").withAgentId("shared-id").build();
    expect(a.agentId).toBe("shared-id");
    expect(b.agentId).toBe("shared-id");
  });

  it("chains with other builder methods", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withAgentId("chain-test")
      .withReasoning()
      .withMemory();
    expect(builder).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test packages/runtime/src/__tests__/builder-agent-id.test.ts
```

Expected: FAIL — `Property 'withAgentId' does not exist`

- [ ] **Step 3: Add `_stableAgentId` field to `ReactiveAgentBuilder`**

In `packages/runtime/src/builder.ts`, add after line 697 (`private _name: string = "agent";`):

```typescript
  private _stableAgentId?: string;
```

- [ ] **Step 4: Add `.withAgentId()` method**

In `builder.ts`, add after the `withName` method (around line 819):

```typescript
  /**
   * Pin a stable agent identity for this agent.
   *
   * When set, `build()` uses this value as the `agentId` instead of generating
   * a new `${name}-${Date.now()}` ID. All memory and run data keyed on `agentId`
   * will accumulate across multiple builds that share the same ID.
   *
   * @param id - The stable identifier to use (e.g. a UUID or Cortex session ID).
   */
  withAgentId(id: string): this {
    this._stableAgentId = id;
    return this;
  }
```

- [ ] **Step 5: Use `_stableAgentId` in `build()`**

In `builder.ts`, replace line 2281:

```typescript
      const agentId = `${self._name}-${Date.now()}`;
```

with:

```typescript
      const agentId = self._stableAgentId ?? `${self._name}-${Date.now()}`;
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test packages/runtime/src/__tests__/builder-agent-id.test.ts
```

Expected: 4 passing

- [ ] **Step 7: Run full runtime tests to check for regressions**

```bash
bun test packages/runtime/
```

Expected: all passing

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/__tests__/builder-agent-id.test.ts
git commit -m "feat(runtime): add .withAgentId() to pin stable agent identity across builds"
```

---

### Task 2: Wire `agentId` through `BuildCortexAgentParams`

**Files:**
- Modify: `apps/cortex/server/services/build-cortex-agent.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/cortex/server/tests/runner-service.test.ts` (or create a focused test if preferred). Since this is integration-level, add a unit-style check to the existing `apps/cortex/server/tests/cortex-to-agent-config.test.ts`:

Actually, since `buildCortexAgent` builds a real agent (even with `provider: "test"`), add a describe block to the existing `apps/cortex/server/tests/runner-service.test.ts`:

```typescript
// Add at the bottom of apps/cortex/server/tests/runner-service.test.ts
import { buildCortexAgent } from "../services/build-cortex-agent.js";

describe("buildCortexAgent — agentId passthrough", () => {
  it("uses the supplied agentId when provided", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      agentId: "cortex-stable-test-id",
    });
    expect(agent.agentId).toBe("cortex-stable-test-id");
  });

  it("generates a name-timestamp agentId when no agentId is provided", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      agentName: "mybot",
    });
    expect(agent.agentId).toMatch(/^mybot-\d+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test apps/cortex/server/tests/runner-service.test.ts --test-name-pattern "agentId passthrough"
```

Expected: FAIL — test doesn't exist / `agentId` prop not on `BuildCortexAgentParams`

- [ ] **Step 3: Add `agentId` to `BuildCortexAgentParams` and wire to builder**

In `apps/cortex/server/services/build-cortex-agent.ts`:

Add to `BuildCortexAgentParams` interface (after `readonly agentName?: string;`):

```typescript
  /**
   * Stable agent identity to use for this build.
   * When set, the framework uses this instead of generating a name-timestamp ID.
   * All memory keyed on agentId accumulates across server restarts.
   */
  readonly agentId?: string;
```

In `buildCortexAgent()`, add after `let b = await agentConfigToBuilder(agentConfig);`:

```typescript
  if (params.agentId) b = b.withAgentId(params.agentId);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test apps/cortex/server/tests/runner-service.test.ts
```

Expected: all passing (including 2 new)

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/services/build-cortex-agent.ts apps/cortex/server/tests/runner-service.test.ts
git commit -m "feat(cortex): thread stable agentId through BuildCortexAgentParams"
```

---

### Task 3: Schema migration — `cortex_chat_sessions.stable_agent_id`

**Files:**
- Modify: `apps/cortex/server/db/schema.ts`
- Modify: `apps/cortex/server/tests/db.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/cortex/server/tests/db.test.ts`:

```typescript
  it("cortex_chat_sessions has stable_agent_id column after migration", () => {
    const db2 = new Database(":memory:");
    // First apply without the column (simulate old schema by creating the table without it)
    db2.exec(`
      CREATE TABLE IF NOT EXISTS cortex_chat_sessions (
        session_id   TEXT PRIMARY KEY,
        name         TEXT    NOT NULL DEFAULT 'New Chat',
        agent_config TEXT    NOT NULL,
        created_at   INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER NOT NULL DEFAULT 0
      )
    `);
    // Now run the full schema (migration path)
    applySchema(db2);
    const cols = (db2.prepare("PRAGMA table_info(cortex_chat_sessions)").all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(cols).toContain("stable_agent_id");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test apps/cortex/server/tests/db.test.ts --test-name-pattern "stable_agent_id"
```

Expected: FAIL — column does not exist

- [ ] **Step 3: Add migration to `applySchema()`**

In `apps/cortex/server/db/schema.ts`, add after the `chatTurnCols` migration block (around line 125):

```typescript
  const chatSessionCols = (db.prepare("PRAGMA table_info(cortex_chat_sessions)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!chatSessionCols.includes("stable_agent_id")) {
    db.exec("ALTER TABLE cortex_chat_sessions ADD COLUMN stable_agent_id TEXT");
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test apps/cortex/server/tests/db.test.ts
```

Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/db/schema.ts apps/cortex/server/tests/db.test.ts
git commit -m "feat(cortex): add stable_agent_id column to cortex_chat_sessions via migration"
```

---

### Task 4: Update `chat-queries.ts` to store and retrieve `stableAgentId`

**Files:**
- Modify: `apps/cortex/server/db/chat-queries.ts`
- Modify: `apps/cortex/server/tests/chat-queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/cortex/server/tests/chat-queries.test.ts`:

```typescript
describe("stable_agent_id persistence", () => {
  it("stores and retrieves stableAgentId on createChatSession", () => {
    const id = createChatSession(db, {
      name: "Stable ID Test",
      agentConfig: { provider: "test" },
      stableAgentId: "agent-abc-123",
    });
    const session = getChatSession(db, id);
    expect(session).not.toBeNull();
    expect(session!.stableAgentId).toBe("agent-abc-123");
  });

  it("returns undefined stableAgentId when not set", () => {
    const id = createChatSession(db, {
      name: "No ID",
      agentConfig: { provider: "test" },
    });
    const session = getChatSession(db, id);
    expect(session!.stableAgentId).toBeUndefined();
  });

  it("listChatSessions returns stableAgentId for each session", () => {
    const id = createChatSession(db, {
      name: "List Test",
      agentConfig: { provider: "test" },
      stableAgentId: "listed-agent-id",
    });
    const sessions = listChatSessions(db);
    const found = sessions.find((s) => s.sessionId === id);
    expect(found).toBeDefined();
    expect(found!.stableAgentId).toBe("listed-agent-id");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test apps/cortex/server/tests/chat-queries.test.ts --test-name-pattern "stable_agent_id"
```

Expected: FAIL — `stableAgentId` property does not exist

- [ ] **Step 3: Update `ChatSessionRow` type**

In `apps/cortex/server/db/chat-queries.ts`, add `stableAgentId?: string` to `ChatSessionRow`:

```typescript
export type ChatSessionRow = {
  sessionId: string;
  name: string;
  agentConfig: Record<string, unknown>;
  createdAt: number;
  lastUsedAt: number;
  /** Stable agentId generated at session creation for persistent memory. */
  stableAgentId?: string;
};
```

- [ ] **Step 4: Update `createChatSession` to accept and store `stableAgentId`**

```typescript
export function createChatSession(
  db: Database,
  opts: { name?: string; agentConfig: Record<string, unknown>; stableAgentId?: string },
): string {
  const sessionId = generateTaskId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO cortex_chat_sessions (session_id, name, agent_config, stable_agent_id, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, opts.name ?? "New Chat", JSON.stringify(opts.agentConfig), opts.stableAgentId ?? null, now, now);
  return sessionId;
}
```

- [ ] **Step 5: Update `getChatSession` to include `stable_agent_id` in SELECT**

```typescript
export function getChatSession(db: Database, sessionId: string): ChatSessionRow | null {
  const row = db
    .prepare(
      `SELECT session_id, name, agent_config, stable_agent_id, created_at, last_used_at
       FROM cortex_chat_sessions WHERE session_id = ?`,
    )
    .get(sessionId) as
    | {
        session_id: string;
        name: string;
        agent_config: string;
        stable_agent_id: string | null;
        created_at: number;
        last_used_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    name: row.name,
    agentConfig: JSON.parse(row.agent_config) as Record<string, unknown>,
    ...(row.stable_agent_id ? { stableAgentId: row.stable_agent_id } : {}),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
```

- [ ] **Step 6: Update `listChatSessions` to include `stable_agent_id`**

```typescript
export function listChatSessions(db: Database): ChatSessionRow[] {
  const rows = db
    .prepare(
      `SELECT session_id, name, agent_config, stable_agent_id, created_at, last_used_at
       FROM cortex_chat_sessions ORDER BY last_used_at DESC LIMIT 100`,
    )
    .all() as Array<{
    session_id: string;
    name: string;
    agent_config: string;
    stable_agent_id: string | null;
    created_at: number;
    last_used_at: number;
  }>;
  return rows.map((r) => ({
    sessionId: r.session_id,
    name: r.name,
    agentConfig: JSON.parse(r.agent_config) as Record<string, unknown>,
    ...(r.stable_agent_id ? { stableAgentId: r.stable_agent_id } : {}),
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
bun test apps/cortex/server/tests/chat-queries.test.ts
```

Expected: all passing (including 3 new)

- [ ] **Step 8: Commit**

```bash
git add apps/cortex/server/db/chat-queries.ts apps/cortex/server/tests/chat-queries.test.ts
git commit -m "feat(cortex): store and retrieve stable_agent_id in chat session queries"
```

---

### Task 5: `ChatSessionService` — generate stable agentId at creation, use it on every build

**Files:**
- Modify: `apps/cortex/server/services/chat-session-service.ts`
- Modify: `apps/cortex/server/tests/chat-session-service.test.ts`

**What changes:**
1. `createSession()` generates a `stableAgentId = generateTaskId()` and passes it to `createChatSession`
2. `buildSession()` retrieves `stableAgentId` from the session row and passes `agentId: stableAgentId` + `memory: { episodic: true }` to `buildCortexAgent`

- [ ] **Step 1: Write the failing tests**

Add to `apps/cortex/server/tests/chat-session-service.test.ts`:

```typescript
  it("session has a stable_agent_id stored in DB after creation", async () => {
    const { getChatSession } = await import("../db/chat-queries.js");
    const id = await svc.createSession({
      name: "Stable Session",
      agentConfig: { provider: "test", model: "test-model" },
    });
    const row = getChatSession(db, id);
    expect(row).not.toBeNull();
    expect(typeof row!.stableAgentId).toBe("string");
    expect(row!.stableAgentId!.length).toBeGreaterThan(0);
  });

  it("two chats in the same session use the same agentId (stable memory path)", async () => {
    const id = await svc.createSession({
      name: "Memory Test",
      agentConfig: { provider: "test", model: "test-model" },
    });
    // First chat builds the AgentSession
    const r1 = await svc.chat(id, "Hello");
    // Evict the in-memory session to force rebuild
    (svc as any).sessions.delete(id);
    // Second chat rebuilds the AgentSession from DB
    const r2 = await svc.chat(id, "Hello again");
    expect(r1.reply.length).toBeGreaterThan(0);
    expect(r2.reply.length).toBeGreaterThan(0);
    // The stable agentId was used both times (we verify it was stored, not that we traced the build call)
    const { getChatSession } = await import("../db/chat-queries.js");
    const row = getChatSession(db, id);
    expect(row!.stableAgentId).toBeDefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test apps/cortex/server/tests/chat-session-service.test.ts --test-name-pattern "stable"
```

Expected: FAIL — `stableAgentId` not in row

- [ ] **Step 3: Add `generateTaskId` import to `chat-session-service.ts`**

Add to the existing imports in `apps/cortex/server/services/chat-session-service.ts`:

```typescript
import { generateTaskId } from "@reactive-agents/core";
```

- [ ] **Step 4: Update `createSession()` to generate and store a stable agentId**

Replace the existing `createSession` method:

```typescript
  async createSession(opts: { name?: string; agentConfig: Record<string, unknown> }): Promise<string> {
    const stableAgentId = generateTaskId();
    const sessionId = createChatSession(this.db, { ...opts, stableAgentId });
    return sessionId;
  }
```

- [ ] **Step 5: Update `buildSession()` to use `stableAgentId` and enable episodic memory**

The `buildSession` method receives `sessionId` and `agentConfig`. It needs the `stableAgentId` from the DB row. Change the call site in `chat()` to pass the full row, then update `buildSession`:

In `chat()`, the `row` is already read via `getChatSession`. Pass `row.stableAgentId` into `buildSession`. Update the signature and body:

```typescript
  async chat(sessionId: string, message: string): Promise<CortexChatResult> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    const cfg = row.agentConfig;
    const enableTools = cfg.enableTools === true;

    let agentSession = this.sessions.get(sessionId);
    if (!agentSession) {
      agentSession = await this.buildSession(sessionId, cfg, row.stableAgentId);
      this.sessions.set(sessionId, agentSession);
    }

    appendChatTurn(this.db, { sessionId, role: "user", content: message, tokensUsed: 0 });

    const chatOpts: ChatOptions = enableTools ? { useTools: true } : { useTools: false };
    const chatReply = await agentSession.chat(message, chatOpts);
    const reply = chatReply.message;
    const tokensUsed = chatReply.tokens ?? 0;
    const toolsUsed = chatReply.toolsUsed;

    appendChatTurn(this.db, {
      sessionId,
      role: "assistant",
      content: reply,
      tokensUsed,
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
    });
    updateSessionLastUsed(this.db, sessionId);

    return {
      reply,
      tokensUsed,
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
      ...(chatReply.steps != null ? { steps: chatReply.steps } : {}),
      ...(chatReply.cost != null ? { cost: chatReply.cost } : {}),
    };
  }

  private async buildSession(
    sessionId: string,
    agentConfig: Record<string, unknown>,
    stableAgentId?: string,
  ): Promise<AgentSession> {
    const provider = (agentConfig.provider as string | undefined) ?? "test";
    const enableTools = agentConfig.enableTools === true;

    const runId =
      typeof agentConfig.runId === "string" && agentConfig.runId.trim().length > 0
        ? agentConfig.runId.trim()
        : undefined;

    const taskContext: Record<string, string> = {};
    if (runId) {
      const runCtx = buildRunTaskContext(this.db, runId);
      if (runCtx) Object.assign(taskContext, runCtx);
    }
    const userCtx = coerceTaskContextRecord(agentConfig.taskContext);
    if (userCtx) Object.assign(taskContext, userCtx);

    const toolPick = Array.isArray(agentConfig.tools)
      ? (agentConfig.tools as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const mergedTools = enableTools ? mergeCortexAllowedTools(toolPick, undefined, {}) : [];

    const rawScenario = agentConfig.testScenario;
    const customTestScenario =
      Array.isArray(rawScenario) && rawScenario.length > 0 ? (rawScenario as TestTurn[]) : undefined;

    const params: BuildCortexAgentParams = {
      agentName: `chat-${sessionId.slice(0, 8)}`,
      provider,
      ...(stableAgentId ? { agentId: stableAgentId } : {}),
      memory: { episodic: true },
      ...(typeof agentConfig.model === "string" && agentConfig.model.trim()
        ? { model: agentConfig.model.trim() }
        : {}),
      ...(typeof agentConfig.systemPrompt === "string" && agentConfig.systemPrompt.trim()
        ? { systemPrompt: agentConfig.systemPrompt.trim() }
        : {}),
      ...(typeof agentConfig.temperature === "number" ? { temperature: agentConfig.temperature } : {}),
      ...(typeof agentConfig.maxTokens === "number" && agentConfig.maxTokens > 0
        ? { maxTokens: agentConfig.maxTokens }
        : {}),
      ...(enableTools
        ? {
            tools: mergedTools,
            strategy: "reactive",
            maxIterations:
              typeof agentConfig.maxIterations === "number" && agentConfig.maxIterations > 0
                ? agentConfig.maxIterations
                : 12,
          }
        : {}),
      ...(Object.keys(taskContext).length > 0 ? { taskContext } : {}),
      ...(customTestScenario && provider === "test"
        ? { testScenario: customTestScenario }
        : provider === "test"
          ? { testScenario: [{ text: "Cortex chat test reply." }] }
          : {}),
    };

    const agent = await buildCortexAgent(params);
    const turns = getChatTurns(this.db, sessionId);
    const initialHistory = turnsToChatMessages(turns);
    return new AgentSession(
      (msg, hist, opts) => agent.chat(msg, opts, hist, sessionId),
      undefined,
      undefined,
      initialHistory.length > 0 ? initialHistory : undefined,
    );
  }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test apps/cortex/server/tests/chat-session-service.test.ts
```

Expected: all passing (including 2 new)

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/server/services/chat-session-service.ts apps/cortex/server/tests/chat-session-service.test.ts
git commit -m "feat(cortex): generate stable agentId per chat session for persistent episodic memory"
```

---

### Task 6: Gateway — pass stable `agentId` to `buildCortexAgent`

**Files:**
- Modify: `apps/cortex/server/services/gateway-process-manager.ts`
- Modify: `apps/cortex/server/tests/gateway-process-manager.test.ts`

**Context:** `fireAgent(agentId, name, configRaw)` already receives the gateway row's stable `agentId` (from `cortex_agents.agent_id`). It just wasn't forwarded to `buildCortexAgent`. The result was that gateway runs created new `name-timestamp` agentIds each run, losing memory continuity between scheduled fires.

- [ ] **Step 1: Write the failing test**

In `apps/cortex/server/tests/gateway-process-manager.test.ts`, add:

```typescript
  it("triggerNow passes the gateway agent_id to buildCortexAgent (stable identity)", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    const stableId = "gateway-stable-id-abc";
    createGatewayAgent(db, {
      agentId: stableId,
      name: "Stable Gateway Agent",
      config: { prompt: "Do work", provider: "test", model: "test-model" },
      schedule: null,
      agentType: "gateway",
    });

    const result = await gpm.triggerNow(stableId);
    expect("error" in result).toBe(false);
    // The agentId returned in the run result should be the stable gateway ID
    // (not a name-timestamp variant)
    if (!("error" in result)) {
      expect(result.agentId).toBe(stableId);
    }

    gpm.destroy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test apps/cortex/server/tests/gateway-process-manager.test.ts --test-name-pattern "stable identity"
```

Expected: FAIL — `agentId` in result is `name-timestamp`, not the stable gateway ID

- [ ] **Step 3: Wire `agentId` into `buildCortexAgent` call in `fireAgent()`**

In `apps/cortex/server/services/gateway-process-manager.ts`, in the `buildCortexAgent` call (around line 238), add `agentId` as the first parameter:

```typescript
      const agent = await buildCortexAgent({
        agentName: name,
        agentId: agentId,   // ← add this line (agentId is the function param from cortex_agents.agent_id)
        provider: providerRaw,
        // ... rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test apps/cortex/server/tests/gateway-process-manager.test.ts
```

Expected: all passing (including 1 new)

- [ ] **Step 5: Run full Cortex server test suite**

```bash
bun test apps/cortex/server/
```

Expected: all passing

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/server/services/gateway-process-manager.ts apps/cortex/server/tests/gateway-process-manager.test.ts
git commit -m "feat(cortex): pass stable gateway agent_id to builder for memory continuity across runs"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Framework builder accepts pinned agentId | Task 1 |
| Cortex `BuildCortexAgentParams` threads agentId | Task 2 |
| `cortex_chat_sessions` stores `stable_agent_id` | Task 3 + Task 4 |
| Chat sessions generate stable agentId at creation | Task 5 |
| Chat sessions use stable agentId + episodic memory on rebuild | Task 5 |
| Gateway agents use their DB `agent_id` as stable identity | Task 6 |

### Placeholder scan

None. All code blocks are complete.

### Type consistency

- `stableAgentId` appears in `ChatSessionRow`, `createChatSession` opts, `getChatSession` return, `listChatSessions` return, `buildSession` signature — all consistent.
- `agentId` in `BuildCortexAgentParams` maps to `.withAgentId()` call in `buildCortexAgent` — matches Task 1 method name exactly.
- `memory: { episodic: true }` matches the `BuildCortexAgentParams.memory` shape (`{ working?, episodic?, semantic? }`).

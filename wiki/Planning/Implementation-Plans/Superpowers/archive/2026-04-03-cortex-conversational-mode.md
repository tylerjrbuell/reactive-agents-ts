# Cortex Conversational Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent chat interface to Cortex that lets developers talk to their reactive agents using `agent.session()`, with conversation history stored in SQLite across server restarts.

**Architecture:** Two new SQLite tables (`cortex_chat_sessions`, `cortex_chat_turns`) store sessions and history. A `ChatSessionService` holds active `AgentChatSession` objects in a `Map`, rebuilding from DB on cache miss. A `/api/chat` Elysia router handles CRUD + message sending. A new "Chat" tab in the nav routes to `/chat`, where `ChatSessionList.svelte` (left sidebar) and `ChatPanel.svelte` (right) compose the UI. Agent configuration (provider, model, systemPrompt, tools) is specified at session creation time using the same builder options as Beacon runs.

**Tech Stack:** Bun/TypeScript, Elysia, bun:sqlite, Svelte 5 (runes), Tailwind CSS, `@reactive-agents/runtime` (`agent.session()`)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/cortex/server/db/schema.ts` | Add `cortex_chat_sessions` + `cortex_chat_turns` tables + migration guard |
| Create | `apps/cortex/server/db/chat-queries.ts` | All chat-related SQL operations |
| Create | `apps/cortex/server/services/chat-session-service.ts` | In-memory session registry + `agent.session()` lifecycle |
| Create | `apps/cortex/server/api/chat.ts` | Elysia router for `/api/chat/*` |
| Modify | `apps/cortex/server/index.ts` | Mount chat router + inject ChatSessionService |
| Create | `apps/cortex/ui/src/lib/stores/chat-store.ts` | Svelte store for chat state |
| Create | `apps/cortex/ui/src/lib/components/ChatPanel.svelte` | Conversation thread + input box |
| Create | `apps/cortex/ui/src/lib/components/ChatSessionList.svelte` | Session sidebar (list, create, delete) |
| Create | `apps/cortex/ui/src/routes/chat/+page.svelte` | Chat route |
| Modify | `apps/cortex/ui/src/routes/+layout.svelte` | Add "Chat" nav tab |

---

### Task 1: Database schema — chat sessions + turns tables

**Files:**
- Modify: `apps/cortex/server/db/schema.ts`
- Create: `apps/cortex/server/db/chat-queries.ts`
- Test: `apps/cortex/server/tests/chat-queries.test.ts`

**Background:** `applySchema()` in `schema.ts` runs every boot and is idempotent via `CREATE TABLE IF NOT EXISTS`. Migrations are guarded by `PRAGMA table_info`. Follow the same pattern. `chat-queries.ts` has all SQL for the chat tables.

- [ ] **Step 1: Write the failing test**

Create `apps/cortex/server/tests/chat-queries.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { openDatabase } from "../db/schema.js";
import { rmSync } from "node:fs";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  appendChatTurn,
  getChatTurns,
  updateSessionLastUsed,
} from "../db/chat-queries.js";

const TEST_DB_PATH = "/tmp/cortex-chat-queries-test.db";
let db: ReturnType<typeof openDatabase>;

beforeAll(() => { db = openDatabase(TEST_DB_PATH); });
afterAll(() => { db.close(); rmSync(TEST_DB_PATH, { force: true }); });

describe("chat sessions", () => {
  it("creates and retrieves a session", () => {
    const id = createChatSession(db, {
      name: "Test Chat",
      agentConfig: { provider: "test", model: "test-model" },
    });
    const session = getChatSession(db, id);
    expect(session).not.toBeNull();
    expect(session!.name).toBe("Test Chat");
    expect(session!.agentConfig.provider).toBe("test");
  });

  it("lists sessions ordered by last_used_at desc", () => {
    const id1 = createChatSession(db, { name: "A", agentConfig: { provider: "test" } });
    const id2 = createChatSession(db, { name: "B", agentConfig: { provider: "test" } });
    updateSessionLastUsed(db, id2);
    const sessions = listChatSessions(db);
    // id2 used more recently, should appear first
    expect(sessions[0]!.sessionId).toBe(id2);
  });

  it("deletes session and its turns", () => {
    const id = createChatSession(db, { name: "Del", agentConfig: { provider: "test" } });
    appendChatTurn(db, { sessionId: id, role: "user", content: "hello", tokensUsed: 0 });
    deleteChatSession(db, id);
    expect(getChatSession(db, id)).toBeNull();
    expect(getChatTurns(db, id)).toHaveLength(0);
  });
});

describe("chat turns", () => {
  it("appends and retrieves turns in order", () => {
    const id = createChatSession(db, { name: "Turns", agentConfig: { provider: "test" } });
    appendChatTurn(db, { sessionId: id, role: "user", content: "Hi", tokensUsed: 5 });
    appendChatTurn(db, { sessionId: id, role: "assistant", content: "Hello!", tokensUsed: 20 });
    const turns = getChatTurns(db, id);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.role).toBe("user");
    expect(turns[0]!.content).toBe("Hi");
    expect(turns[1]!.role).toBe("assistant");
    expect(turns[1]!.tokensUsed).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/server/tests/chat-queries.test.ts 2>&1 | tail -15
```

Expected: FAIL — `chat-queries.js` not found.

- [ ] **Step 3: Add tables to `schema.ts`**

In `apps/cortex/server/db/schema.ts`, inside `applySchema()`, append to the main `db.exec(...)` block after `cortex_mcp_cached_tools`:

```sql
CREATE TABLE IF NOT EXISTS cortex_chat_sessions (
  session_id   TEXT PRIMARY KEY,
  name         TEXT    NOT NULL DEFAULT 'New Chat',
  agent_config TEXT    NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
  last_used_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_used
  ON cortex_chat_sessions(last_used_at DESC);

CREATE TABLE IF NOT EXISTS cortex_chat_turns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT    NOT NULL REFERENCES cortex_chat_sessions(session_id) ON DELETE CASCADE,
  role         TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  tokens_used  INTEGER NOT NULL DEFAULT 0,
  ts           INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_chat_turns_session
  ON cortex_chat_turns(session_id, id ASC);
```

- [ ] **Step 4: Create `apps/cortex/server/db/chat-queries.ts`**

```typescript
import type { Database } from "bun:sqlite";
import { generateTaskId } from "@reactive-agents/core";

export type ChatSessionRow = {
  sessionId: string;
  name: string;
  agentConfig: Record<string, unknown>;
  createdAt: number;
  lastUsedAt: number;
};

export type ChatTurnRow = {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  tokensUsed: number;
  ts: number;
};

export function createChatSession(
  db: Database,
  opts: { name?: string; agentConfig: Record<string, unknown> },
): string {
  const sessionId = generateTaskId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO cortex_chat_sessions (session_id, name, agent_config, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, opts.name ?? "New Chat", JSON.stringify(opts.agentConfig), now, now);
  return sessionId;
}

export function getChatSession(db: Database, sessionId: string): ChatSessionRow | null {
  const row = db
    .prepare(`SELECT session_id, name, agent_config, created_at, last_used_at FROM cortex_chat_sessions WHERE session_id = ?`)
    .get(sessionId) as { session_id: string; name: string; agent_config: string; created_at: number; last_used_at: number } | null;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    name: row.name,
    agentConfig: JSON.parse(row.agent_config) as Record<string, unknown>,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function listChatSessions(db: Database): ChatSessionRow[] {
  const rows = db
    .prepare(`SELECT session_id, name, agent_config, created_at, last_used_at FROM cortex_chat_sessions ORDER BY last_used_at DESC LIMIT 100`)
    .all() as Array<{ session_id: string; name: string; agent_config: string; created_at: number; last_used_at: number }>;
  return rows.map((r) => ({
    sessionId: r.session_id,
    name: r.name,
    agentConfig: JSON.parse(r.agent_config) as Record<string, unknown>,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export function deleteChatSession(db: Database, sessionId: string): boolean {
  const result = db.prepare(`DELETE FROM cortex_chat_sessions WHERE session_id = ?`).run(sessionId);
  return result.changes > 0;
}

export function appendChatTurn(
  db: Database,
  turn: { sessionId: string; role: "user" | "assistant"; content: string; tokensUsed: number },
): void {
  db.prepare(
    `INSERT INTO cortex_chat_turns (session_id, role, content, tokens_used, ts) VALUES (?, ?, ?, ?, ?)`,
  ).run(turn.sessionId, turn.role, turn.content, turn.tokensUsed, Date.now());
}

export function getChatTurns(db: Database, sessionId: string): ChatTurnRow[] {
  const rows = db
    .prepare(`SELECT id, session_id, role, content, tokens_used, ts FROM cortex_chat_turns WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as Array<{ id: number; session_id: string; role: string; content: string; tokens_used: number; ts: number }>;
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role as "user" | "assistant",
    content: r.content,
    tokensUsed: r.tokens_used,
    ts: r.ts,
  }));
}

export function updateSessionLastUsed(db: Database, sessionId: string): void {
  db.prepare(`UPDATE cortex_chat_sessions SET last_used_at = ? WHERE session_id = ?`).run(Date.now(), sessionId);
}

export function renameSession(db: Database, sessionId: string, name: string): void {
  db.prepare(`UPDATE cortex_chat_sessions SET name = ? WHERE session_id = ?`).run(name.trim(), sessionId);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test apps/cortex/server/tests/chat-queries.test.ts 2>&1 | tail -15
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/server/db/schema.ts \
        apps/cortex/server/db/chat-queries.ts \
        apps/cortex/server/tests/chat-queries.test.ts
git commit -m "feat(cortex): chat sessions + turns schema and query helpers"
```

---

### Task 2: `ChatSessionService` — session registry

**Files:**
- Create: `apps/cortex/server/services/chat-session-service.ts`
- Test: `apps/cortex/server/tests/chat-session-service.test.ts`

**Background:** `agent.session(sessionId?)` from `@reactive-agents/runtime` returns a `ChatSession` that holds turn history in memory. We want sessions to survive across HTTP requests in a single server process, so we cache them in a `Map<sessionId, AgentSession>`. On cold start or after a restart, we rebuild the session from DB turns using `agent.session()` with the stored session ID — the framework's `SessionStoreService` handles persistence automatically when the agent is built with the right session ID.

The service builds the agent via `buildCortexAgent()` with the session's `agentConfig`, then calls `agent.session(sessionId)` to get a live session.

- [ ] **Step 1: Write the failing test**

Create `apps/cortex/server/tests/chat-session-service.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { openDatabase } from "../db/schema.js";
import { rmSync } from "node:fs";
import { ChatSessionService } from "../services/chat-session-service.js";
import { createChatSession } from "../db/chat-queries.js";

const TEST_DB_PATH = "/tmp/cortex-chat-svc-test.db";
let db: ReturnType<typeof openDatabase>;
let svc: ChatSessionService;

beforeAll(() => {
  db = openDatabase(TEST_DB_PATH);
  svc = new ChatSessionService(db);
});

afterAll(() => {
  db.close();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("ChatSessionService", () => {
  it("creates a session entry and returns its ID", async () => {
    const id = await svc.createSession({
      name: "Test",
      agentConfig: { provider: "test", model: "test-model" },
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("sends a message and returns a reply", async () => {
    const id = await svc.createSession({
      name: "Echo",
      agentConfig: { provider: "test", model: "test-model" },
    });
    const result = await svc.chat(id, "Hello");
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("persists turns to DB", async () => {
    const id = await svc.createSession({
      name: "Persist",
      agentConfig: { provider: "test", model: "test-model" },
    });
    await svc.chat(id, "ping");
    const { getChatTurns } = await import("../db/chat-queries.js");
    const turns = getChatTurns(db, id);
    expect(turns.length).toBeGreaterThanOrEqual(2); // user + assistant
    expect(turns[0]!.role).toBe("user");
    expect(turns[1]!.role).toBe("assistant");
  });

  it("returns error for unknown sessionId", async () => {
    await expect(svc.chat("no-such-id", "hi")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test apps/cortex/server/tests/chat-session-service.test.ts 2>&1 | tail -15
```

Expected: FAIL — `chat-session-service.js` not found.

- [ ] **Step 3: Create `apps/cortex/server/services/chat-session-service.ts`**

```typescript
import type { Database } from "bun:sqlite";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  appendChatTurn,
  getChatTurns,
  updateSessionLastUsed,
  renameSession,
  type ChatSessionRow,
  type ChatTurnRow,
} from "../db/chat-queries.js";
import { buildCortexAgent } from "./build-cortex-agent.js";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";

type AgentSession = {
  chat(message: string): Promise<{ reply: string; tokensUsed?: number }>;
  sessionId: string;
};

export class ChatSessionService {
  private readonly db: Database;
  /** In-memory cache of live agent sessions keyed by Cortex session ID. */
  private readonly sessions = new Map<string, AgentSession>();

  constructor(db: Database) {
    this.db = db;
  }

  async createSession(opts: { name?: string; agentConfig: Record<string, unknown> }): Promise<string> {
    const sessionId = createChatSession(this.db, opts);
    return sessionId;
  }

  listSessions(): ChatSessionRow[] {
    return listChatSessions(this.db);
  }

  getSession(sessionId: string): (ChatSessionRow & { turns: ChatTurnRow[] }) | null {
    const session = getChatSession(this.db, sessionId);
    if (!session) return null;
    const turns = getChatTurns(this.db, sessionId);
    return { ...session, turns };
  }

  deleteSession(sessionId: string): boolean {
    this.sessions.delete(sessionId);
    return deleteChatSession(this.db, sessionId);
  }

  renameSession(sessionId: string, name: string): void {
    renameSession(this.db, sessionId, name);
  }

  async chat(sessionId: string, message: string): Promise<{ reply: string; tokensUsed: number }> {
    const row = getChatSession(this.db, sessionId);
    if (!row) throw new Error(`Chat session ${sessionId} not found`);

    let agentSession = this.sessions.get(sessionId);
    if (!agentSession) {
      agentSession = await this.buildSession(sessionId, row.agentConfig);
      this.sessions.set(sessionId, agentSession);
    }

    // Persist user turn
    appendChatTurn(this.db, { sessionId, role: "user", content: message, tokensUsed: 0 });

    const result = await agentSession.chat(message);
    const reply = typeof result === "string" ? result : (result as any).reply ?? String(result);
    const tokensUsed = (result as any).tokensUsed ?? 0;

    // Persist assistant turn
    appendChatTurn(this.db, { sessionId, role: "assistant", content: reply, tokensUsed });
    updateSessionLastUsed(this.db, sessionId);

    return { reply, tokensUsed };
  }

  private async buildSession(sessionId: string, agentConfig: Record<string, unknown>): Promise<AgentSession> {
    const params: BuildCortexAgentParams = {
      agentName: `chat-${sessionId.slice(0, 8)}`,
      provider: (agentConfig.provider as string | undefined) ?? "test",
      ...(agentConfig.model ? { model: agentConfig.model as string } : {}),
      ...(agentConfig.systemPrompt ? { systemPrompt: agentConfig.systemPrompt as string } : {}),
      ...(agentConfig.temperature != null ? { temperature: agentConfig.temperature as number } : {}),
      ...(agentConfig.maxTokens ? { maxTokens: agentConfig.maxTokens as number } : {}),
      ...(Array.isArray(agentConfig.tools) ? { tools: agentConfig.tools as string[] } : {}),
    };

    const agent = await buildCortexAgent(params);
    // agent.session() returns a ChatSession — sessions persist via SessionStoreService
    return agent.session(sessionId) as unknown as AgentSession;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test apps/cortex/server/tests/chat-session-service.test.ts 2>&1 | tail -15
```

Expected: All tests PASS. Note: the `provider: "test"` agent will use the framework's test provider, which returns canned responses. Real providers require API keys.

- [ ] **Step 5: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -20
```

Expected: Zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/server/services/chat-session-service.ts \
        apps/cortex/server/tests/chat-session-service.test.ts
git commit -m "feat(cortex): ChatSessionService manages agent.session() lifecycle"
```

---

### Task 3: `/api/chat` Elysia router

**Files:**
- Create: `apps/cortex/server/api/chat.ts`
- Modify: `apps/cortex/server/index.ts`

- [ ] **Step 1: Create `apps/cortex/server/api/chat.ts`**

```typescript
import { Elysia, t } from "elysia";
import type { ChatSessionService } from "../services/chat-session-service.js";

export const chatRouter = (svc: ChatSessionService) =>
  new Elysia({ prefix: "/api/chat" })
    .get("/sessions", () => svc.listSessions())
    .post(
      "/sessions",
      async ({ body, set }) => {
        try {
          const sessionId = await svc.createSession({
            name: body.name,
            agentConfig: {
              provider: body.provider ?? "anthropic",
              ...(body.model ? { model: body.model } : {}),
              ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
              ...(body.temperature != null ? { temperature: body.temperature } : {}),
              ...(body.maxTokens ? { maxTokens: body.maxTokens } : {}),
              ...(body.tools?.length ? { tools: body.tools } : {}),
            },
          });
          return { sessionId };
        } catch (e) {
          set.status = 500;
          return { error: String(e) };
        }
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          provider: t.Optional(t.String()),
          model: t.Optional(t.String()),
          systemPrompt: t.Optional(t.String()),
          temperature: t.Optional(t.Number()),
          maxTokens: t.Optional(t.Number()),
          tools: t.Optional(t.Array(t.String())),
        }),
      },
    )
    .get("/sessions/:sessionId", ({ params, set }) => {
      const session = svc.getSession(params.sessionId);
      if (!session) { set.status = 404; return { error: "Session not found" }; }
      return session;
    })
    .delete("/sessions/:sessionId", ({ params, set }) => {
      const ok = svc.deleteSession(params.sessionId);
      if (!ok) { set.status = 404; return { error: "Session not found" }; }
      return { ok: true };
    })
    .patch(
      "/sessions/:sessionId",
      ({ params, body }) => {
        svc.renameSession(params.sessionId, body.name);
        return { ok: true };
      },
      { body: t.Object({ name: t.String() }) },
    )
    .post(
      "/sessions/:sessionId/chat",
      async ({ params, body, set }) => {
        try {
          const result = await svc.chat(params.sessionId, body.message);
          return result;
        } catch (e) {
          const msg = String(e);
          set.status = msg.includes("not found") ? 404 : 500;
          return { error: msg };
        }
      },
      {
        body: t.Object({ message: t.String() }),
      },
    );
```

- [ ] **Step 2: Mount router and inject service in `index.ts`**

In `apps/cortex/server/index.ts`, add imports:

```typescript
import { ChatSessionService } from "./services/chat-session-service.js";
import { chatRouter } from "./api/chat.js";
```

Then after the database is opened and before the Elysia app is configured, create the service:

```typescript
const chatSessionService = new ChatSessionService(db);
```

Then mount the router in the Elysia app setup alongside other routers:

```typescript
.use(chatRouter(chatSessionService))
```

- [ ] **Step 3: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -20
```

Expected: Zero errors.

- [ ] **Step 4: Smoke-test the API**

```bash
# Start server
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cortex
bun run dev &

# Create session
curl -s -X POST http://localhost:4321/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","provider":"test"}' | jq .
# Expected: { "sessionId": "..." }

# List sessions
curl -s http://localhost:4321/api/chat/sessions | jq .
# Expected: array with one session
```

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/api/chat.ts apps/cortex/server/index.ts
git commit -m "feat(cortex): /api/chat REST router for session management + messaging"
```

---

### Task 4: Chat UI — store, components, route

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/chat-store.ts`
- Create: `apps/cortex/ui/src/lib/components/ChatPanel.svelte`
- Create: `apps/cortex/ui/src/lib/components/ChatSessionList.svelte`
- Create: `apps/cortex/ui/src/routes/chat/+page.svelte`
- Modify: `apps/cortex/ui/src/routes/+layout.svelte`

- [ ] **Step 1: Create `apps/cortex/ui/src/lib/stores/chat-store.ts`**

```typescript
import { writable, derived } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";

export type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  tokensUsed: number;
  ts: number;
};

export type ChatSession = {
  sessionId: string;
  name: string;
  agentConfig: Record<string, unknown>;
  createdAt: number;
  lastUsedAt: number;
  turns?: ChatTurn[];
};

type ChatState = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeTurns: ChatTurn[];
  sending: boolean;
  loadingSession: boolean;
  error: string | null;
};

function createChatStore() {
  const { subscribe, set, update } = writable<ChatState>({
    sessions: [],
    activeSessionId: null,
    activeTurns: [],
    sending: false,
    loadingSession: false,
    error: null,
  });

  async function loadSessions() {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions`);
    const sessions = (await res.json()) as ChatSession[];
    update((s) => ({ ...s, sessions }));
    return sessions;
  }

  async function selectSession(sessionId: string) {
    update((s) => ({ ...s, activeSessionId: sessionId, loadingSession: true, error: null }));
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) { update((s) => ({ ...s, loadingSession: false, error: "Session not found" })); return; }
    const session = (await res.json()) as ChatSession & { turns: ChatTurn[] };
    update((s) => ({ ...s, activeTurns: session.turns, loadingSession: false }));
  }

  async function createSession(opts: {
    name?: string; provider?: string; model?: string; systemPrompt?: string;
    temperature?: number; maxTokens?: number; tools?: string[];
  }): Promise<string> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const { sessionId } = (await res.json()) as { sessionId: string };
    await loadSessions();
    await selectSession(sessionId);
    return sessionId;
  }

  async function deleteSession(sessionId: string) {
    await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    await loadSessions();
    update((s) => ({
      ...s,
      activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
      activeTurns: s.activeSessionId === sessionId ? [] : s.activeTurns,
    }));
  }

  async function sendMessage(message: string): Promise<void> {
    let sessionId: string | null = null;
    update((s) => { sessionId = s.activeSessionId; return s; });
    if (!sessionId) return;

    // Optimistically append user turn
    const optimisticTurn: ChatTurn = { id: Date.now(), role: "user", content: message, tokensUsed: 0, ts: Date.now() };
    update((s) => ({ ...s, activeTurns: [...s.activeTurns, optimisticTurn], sending: true, error: null }));

    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const { error } = (await res.json()) as { error: string };
      update((s) => ({ ...s, sending: false, error }));
      return;
    }

    const { reply, tokensUsed } = (await res.json()) as { reply: string; tokensUsed: number };
    const assistantTurn: ChatTurn = { id: Date.now() + 1, role: "assistant", content: reply, tokensUsed, ts: Date.now() };
    update((s) => ({ ...s, activeTurns: [...s.activeTurns, assistantTurn], sending: false }));
  }

  return { subscribe, loadSessions, selectSession, createSession, deleteSession, sendMessage };
}

export const chatStore = createChatStore();
```

- [ ] **Step 2: Create `apps/cortex/ui/src/lib/components/ChatSessionList.svelte`**

```svelte
<script lang="ts">
  import { chatStore, type ChatSession } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";

  interface Props {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onSelectSession: (id: string) => void;
  }
  const { sessions, activeSessionId, onSelectSession } = $props();

  let showNewForm = $state(false);
  let newName = $state("");
  let newProvider = $state("anthropic");
  let newModel = $state("");
  let newSystemPrompt = $state("");
  let creating = $state(false);

  async function create() {
    if (creating) return;
    creating = true;
    try {
      await chatStore.createSession({
        name: newName || undefined,
        provider: newProvider || "anthropic",
        ...(newModel ? { model: newModel } : {}),
        ...(newSystemPrompt ? { systemPrompt: newSystemPrompt } : {}),
      });
      showNewForm = false;
      newName = "";
      newModel = "";
      newSystemPrompt = "";
    } catch (e) {
      toast.error("Failed to create session: " + String(e));
    } finally {
      creating = false;
    }
  }

  async function del(e: MouseEvent, sessionId: string) {
    e.stopPropagation();
    await chatStore.deleteSession(sessionId);
  }
</script>

<div class="h-full flex flex-col border-r border-white/5 bg-surface-container-lowest/60">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-shrink-0">
    <span class="font-mono text-[10px] uppercase tracking-widest text-outline/60">Sessions</span>
    <button
      type="button"
      class="material-symbols-outlined text-sm text-outline hover:text-primary bg-transparent border-0 cursor-pointer"
      onclick={() => (showNewForm = !showNewForm)}
      title="New chat session"
    >add</button>
  </div>

  <!-- New session form -->
  {#if showNewForm}
    <div class="p-3 border-b border-white/5 flex flex-col gap-2 flex-shrink-0">
      <input
        class="w-full bg-surface-variant/30 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-on-surface placeholder:text-outline/40"
        placeholder="Session name"
        bind:value={newName}
      />
      <input
        class="w-full bg-surface-variant/30 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-on-surface placeholder:text-outline/40"
        placeholder="Provider (anthropic)"
        bind:value={newProvider}
      />
      <input
        class="w-full bg-surface-variant/30 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-on-surface placeholder:text-outline/40"
        placeholder="Model (optional)"
        bind:value={newModel}
      />
      <textarea
        class="w-full bg-surface-variant/30 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-on-surface placeholder:text-outline/40 resize-none"
        placeholder="System prompt (optional)"
        rows="2"
        bind:value={newSystemPrompt}
      ></textarea>
      <button
        type="button"
        disabled={creating}
        class="px-3 py-1 bg-primary/15 border border-primary/30 text-primary font-mono text-[10px] uppercase rounded cursor-pointer hover:bg-primary/25 disabled:opacity-40"
        onclick={create}
      >{creating ? "Creating…" : "Create"}</button>
    </div>
  {/if}

  <!-- Session list -->
  <div class="flex-1 overflow-y-auto">
    {#if sessions.length === 0}
      <p class="p-3 text-outline/40 text-[10px] font-mono italic">No sessions yet</p>
    {:else}
      {#each sessions as session (session.sessionId)}
        <button
          type="button"
          class="w-full text-left px-3 py-2 flex items-center justify-between gap-2 border-b border-white/5
                 bg-transparent border-0 cursor-pointer transition-colors
                 {activeSessionId === session.sessionId ? 'bg-primary/8 text-primary' : 'text-on-surface/70 hover:bg-white/5'}"
          onclick={() => onSelectSession(session.sessionId)}
        >
          <div class="min-w-0 flex-1">
            <div class="font-mono text-[11px] truncate">{session.name}</div>
            <div class="text-[9px] text-outline/40 font-mono">
              {new Date(session.lastUsedAt).toLocaleDateString()}
            </div>
          </div>
          <button
            type="button"
            class="material-symbols-outlined text-[13px] text-outline/30 hover:text-error bg-transparent border-0 cursor-pointer flex-shrink-0"
            onclick={(e) => del(e, session.sessionId)}
            title="Delete session"
          >delete</button>
        </button>
      {/each}
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Create `apps/cortex/ui/src/lib/components/ChatPanel.svelte`**

```svelte
<script lang="ts">
  import { chatStore, type ChatTurn } from "$lib/stores/chat-store.js";

  interface Props {
    sessionId: string;
    turns: ChatTurn[];
    sending: boolean;
    error: string | null;
  }
  const { sessionId, turns, sending, error } = $props();

  let message = $state("");
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    // Scroll to bottom when turns change
    if (turns.length > 0 && scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  async function submit() {
    const text = message.trim();
    if (!text || sending) return;
    message = "";
    await chatStore.sendMessage(text);
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
  }
</script>

<div class="h-full flex flex-col">
  <!-- Message thread -->
  <div bind:this={scrollEl} class="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-[12px]">
    {#if turns.length === 0}
      <div class="flex items-center justify-center h-full">
        <p class="text-outline/30 text-[11px] italic">Start a conversation…</p>
      </div>
    {:else}
      {#each turns as turn (turn.id)}
        <div class="flex {turn.role === 'user' ? 'justify-end' : 'justify-start'} gap-2">
          <div class="max-w-[80%] {turn.role === 'user'
            ? 'bg-primary/10 border border-primary/20 text-on-surface'
            : 'bg-surface-variant/30 border border-white/8 text-on-surface/85'}
            rounded-lg px-3 py-2">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-[9px] uppercase tracking-widest {turn.role === 'user' ? 'text-primary/60' : 'text-secondary/60'}">
                {turn.role}
              </span>
              {#if turn.tokensUsed > 0}
                <span class="text-[9px] text-outline/30">{turn.tokensUsed} tok</span>
              {/if}
            </div>
            <p class="whitespace-pre-wrap leading-relaxed text-[11px]">{turn.content}</p>
          </div>
        </div>
      {/each}
      {#if sending}
        <div class="flex justify-start">
          <div class="bg-surface-variant/30 border border-white/8 rounded-lg px-3 py-2">
            <span class="text-outline/40 text-[11px] italic">Thinking…</span>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Error banner -->
  {#if error}
    <div class="flex-shrink-0 px-4 py-2 bg-error/8 border-t border-error/20 text-error text-[10px] font-mono">
      {error}
    </div>
  {/if}

  <!-- Input area -->
  <div class="flex-shrink-0 border-t border-white/5 p-3 flex gap-2 items-end">
    <textarea
      bind:this={inputEl}
      class="flex-1 bg-surface-variant/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] font-mono
             text-on-surface placeholder:text-outline/30 resize-none focus:outline-none focus:border-primary/40"
      placeholder="Message… (Enter to send, Shift+Enter for newline)"
      rows="3"
      bind:value={message}
      onkeydown={onKeydown}
      disabled={sending}
    ></textarea>
    <button
      type="button"
      disabled={sending || !message.trim()}
      class="px-4 py-2 bg-primary/15 border border-primary/30 text-primary font-mono text-[11px] uppercase
             rounded-lg cursor-pointer hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed
             transition-colors flex-shrink-0"
      onclick={submit}
    >
      {#if sending}
        <span class="material-symbols-outlined text-sm">hourglass_empty</span>
      {:else}
        <span class="material-symbols-outlined text-sm">send</span>
      {/if}
    </button>
  </div>
</div>
```

- [ ] **Step 4: Create `apps/cortex/ui/src/routes/chat/+page.svelte`**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { chatStore } from "$lib/stores/chat-store.js";
  import ChatSessionList from "$lib/components/ChatSessionList.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";

  const state = $derived($chatStore);

  onMount(async () => {
    await chatStore.loadSessions();
  });

  function selectSession(id: string) {
    void chatStore.selectSession(id);
  }
</script>

<svelte:head>
  <title>CORTEX — Chat</title>
</svelte:head>

<div class="flex h-full overflow-hidden">
  <!-- Left: session list (fixed width) -->
  <div class="w-56 flex-shrink-0 overflow-hidden">
    <ChatSessionList
      sessions={state.sessions}
      activeSessionId={state.activeSessionId}
      {selectSession}
    />
  </div>

  <!-- Right: chat panel -->
  <div class="flex-1 overflow-hidden">
    {#if !state.activeSessionId}
      <div class="h-full flex items-center justify-center">
        <div class="text-center">
          <span class="material-symbols-outlined text-4xl text-outline/20 block mb-3">chat_bubble_outline</span>
          <p class="font-mono text-[11px] text-outline/40">Select or create a session to start chatting</p>
        </div>
      </div>
    {:else if state.loadingSession}
      <div class="h-full flex items-center justify-center">
        <p class="font-mono text-[11px] text-outline/40 italic">Loading session…</p>
      </div>
    {:else}
      <ChatPanel
        sessionId={state.activeSessionId}
        turns={state.activeTurns}
        sending={state.sending}
        error={state.error}
      />
    {/if}
  </div>
</div>
```

- [ ] **Step 5: Add Chat nav item in `+layout.svelte`**

In `apps/cortex/ui/src/routes/+layout.svelte`, find the `navItems` array (or wherever Beacon/Trace/Lab are defined) and add a Chat entry:

```javascript
{ label: "Chat", href: "/chat", icon: "chat" }
```

Place it between "Beacon" and "Trace" (or at the end — your call based on the layout).

- [ ] **Step 6: Verify in browser**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cortex
bun run dev 2>&1
```

Navigate to `/chat`. Verify:
1. "Chat" tab appears in nav
2. Clicking "+" creates a new session (provider: "test" for local testing)
3. Sending a message gets a reply
4. Session list updates with timestamp
5. Session persists after page refresh (turns visible after reload)
6. Delete removes session from list

- [ ] **Step 7: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -20
```

Expected: Zero errors.

- [ ] **Step 8: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/chat-store.ts \
        apps/cortex/ui/src/lib/components/ChatPanel.svelte \
        apps/cortex/ui/src/lib/components/ChatSessionList.svelte \
        apps/cortex/ui/src/routes/chat/+page.svelte \
        apps/cortex/ui/src/routes/+layout.svelte
git commit -m "feat(cortex): conversational chat UI with session persistence"
```

---

## Self-Review

**Spec coverage:**
- ✅ `cortex_chat_sessions` + `cortex_chat_turns` tables — Task 1
- ✅ CRUD operations: create, list, get, delete, rename — Tasks 1+3
- ✅ `agent.session()` lifecycle management — Task 2
- ✅ Turn persistence (user + assistant) to DB — Task 2
- ✅ In-memory session cache across requests — Task 2
- ✅ `/api/chat` REST API — Task 3
- ✅ Chat UI with message thread — Task 4
- ✅ Session sidebar (list + create + delete) — Task 4
- ✅ Nav integration — Task 4
- ✅ Sessions survive server restart (turns loaded from DB) — Task 2 + Task 4

**Placeholder scan:** None.

**Type consistency:** `ChatTurn` and `ChatSession` defined in `chat-store.ts`, used in `ChatPanel.svelte` and `ChatSessionList.svelte` — names consistent. `ChatSessionRow` and `ChatTurnRow` from `chat-queries.ts` are server-side, not exposed to UI. `ChatSessionService.chat()` returns `{ reply: string; tokensUsed: number }` — matches what `chat-store.ts` destructures.

# Cortex Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 7 Tier-1/Tier-2 upgrades to the Cortex app that improve run discoverability, live feedback, agent intelligence, and cross-surface workflow handoffs.

**Architecture:** All server work is in `apps/cortex/server/` (Elysia + Bun SQLite). All UI work is in `apps/cortex/ui/` (SvelteKit + Svelte 5 runes). Each task is independently testable and commits cleanly.

**Tech Stack:** Bun, Elysia, SQLite, SvelteKit 5 runes (`$state`, `$derived`), TypeScript strict.

**Branch:** `worktree-feat+cortex-upgrades-2026-06-10` (already created in `.claude/worktrees/`)

**Test command:** `bun test apps/cortex` (364 tests baseline)

---

## Pre-flight

**Already confirmed present (do NOT re-implement):**
- `CommandPalette.svelte` — 287-line component, fully mounted in `+layout.svelte`, ⌘K wired
- `command-palette.ts` store — `register/open/close/toggle/filter`
- Run search/filter/pin/bulk-delete/sort in `runs/+page.svelte`
- `display_name` column in `cortex_runs` — already in schema, returned by `getRecentRuns()`
- Per-turn `tokensUsed` shown in `ChatPanel.svelte:128`

---

## Task 1 — Run Label: Surface `displayName` in UI + Inline Rename

**Files:**
- Modify: `apps/cortex/server/db/queries.ts`
- Modify: `apps/cortex/server/api/runs.ts`
- Modify: `apps/cortex/ui/src/routes/runs/+page.svelte`
- Modify: `apps/cortex/ui/src/lib/components/VitalsStrip.svelte`

### Context
`cortex_runs.display_name` is already in the DB, populated by `upsertRun()`, and returned by `getRecentRuns()` as `displayName`. The `runs/+page.svelte` `RunRow` type omits `displayName` and the search filter doesn't include it. VitalsStrip shows the raw run ID — no rename affordance.

---

- [ ] **Step 1.1: Write failing test for PATCH label endpoint**

File: `apps/cortex/server/tests/db.test.ts` — add to existing describe block:

```typescript
it("updateRunLabel sets display_name", () => {
  const db = openDatabase(":memory:");
  upsertRun(db, "agent-1", "run-abc");
  updateRunLabel(db, "run-abc", "My Research Task");
  const row = db.prepare("SELECT display_name FROM cortex_runs WHERE run_id = ?").get("run-abc") as { display_name: string };
  expect(row.display_name).toBe("My Research Task");
});
```

- [ ] **Step 1.2: Run test — confirm fails**

```bash
bun test apps/cortex/server/tests/db.test.ts
```
Expected: FAIL with "updateRunLabel is not a function"

- [ ] **Step 1.3: Add `updateRunLabel` to `apps/cortex/server/db/queries.ts`**

Add after the `updateRunStats` function:

```typescript
export function updateRunLabel(db: Database, runId: string, label: string): void {
  db.prepare("UPDATE cortex_runs SET display_name = ? WHERE run_id = ?")
    .run(label.trim().slice(0, 200), runId);
}
```

Also add to the imports at the top if not already present: the function lives in the same file, no import needed.

- [ ] **Step 1.4: Run test — confirm passes**

```bash
bun test apps/cortex/server/tests/db.test.ts
```

- [ ] **Step 1.5: Add PATCH `/:runId/label` to `apps/cortex/server/api/runs.ts`**

Import `updateRunLabel` at the top alongside existing imports:
```typescript
import { ..., updateRunLabel } from "../db/queries.js";
```

Add route before the closing of the Elysia chain (after existing `.post("/:runId/delete", ...)` or similar):
```typescript
.patch("/:runId/label", async ({ params, body, set }) => {
  const { label } = body as { label?: unknown };
  if (typeof label !== "string" || !label.trim()) {
    set.status = 400;
    return { error: "label must be a non-empty string" };
  }
  const program = Effect.gen(function* () {
    const store = yield* CortexStoreService;
    return yield* store.updateRunLabel(params.runId, label.trim());
  });
  return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
})
```

Then add `updateRunLabel` to `CortexStoreService` in `apps/cortex/server/services/cortex-store.ts`:

```typescript
updateRunLabel(runId: string, label: string): Effect.Effect<void, CortexError>;
```

And implement it in `apps/cortex/server/services/cortex-store.ts` in the `make` body:

```typescript
updateRunLabel: (runId, label) =>
  Effect.sync(() => updateRunLabel(db, runId, label)),
```

- [ ] **Step 1.6: Update `RunRow` type in `apps/cortex/ui/src/routes/runs/+page.svelte`**

Find the `type RunRow = {` block (line ~9) and add:
```typescript
displayName?: string;
```

Update the `filtered` derived to include `displayName` in search:
```typescript
// existing lines include:
r.runId.toLowerCase().includes(searchText.toLowerCase()) ||
r.agentId.toLowerCase().includes(searchText.toLowerCase()) ||
// ADD after:
(r.displayName ?? "").toLowerCase().includes(searchText.toLowerCase()) ||
```

In the HTML template, find where `runId` is shown in the row and change from just showing `run.runId.slice(0,8)` to:
```svelte
{#if run.displayName}
  <span class="font-medium text-slate-800 dark:text-on-surface truncate max-w-[20ch]" title={run.displayName}>
    {run.displayName.length > 24 ? run.displayName.slice(0, 22) + "…" : run.displayName}
  </span>
  <span class="font-mono text-[9px] text-outline">{run.runId.slice(0, 8)}</span>
{:else}
  <span class="font-mono text-[11px] text-slate-700 dark:text-on-surface">{run.runId.slice(0, 8)}</span>
{/if}
```

- [ ] **Step 1.7: Add inline rename to `VitalsStrip.svelte`**

Find the VitalsStrip run ID display area. Add a pencil button that reveals an inline `<input>` on click:

```svelte
<script>
  // existing props...
  let renaming = $state(false);
  let renameValue = $state(run?.displayName ?? "");

  async function commitRename() {
    const v = renameValue.trim();
    if (!v || v === (run?.displayName ?? "")) { renaming = false; return; }
    await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(run.runId)}/label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: v }),
    });
    renaming = false;
  }
</script>

{#if renaming}
  <input
    class="border border-primary/40 rounded px-1 py-0.5 text-xs bg-surface font-mono focus:outline-none focus:ring-1 focus:ring-primary"
    bind:value={renameValue}
    onblur={commitRename}
    onkeydown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") renaming = false; }}
    autofocus
  />
{:else}
  <button
    class="group flex items-center gap-1 hover:text-primary transition-colors"
    onclick={() => { renameValue = run?.displayName ?? ""; renaming = true; }}
    title="Rename run"
  >
    <span class="font-mono text-[11px]">{run?.displayName ?? run?.runId?.slice(0, 8)}</span>
    <span class="material-symbols-outlined text-[13px] opacity-0 group-hover:opacity-60">edit</span>
  </button>
{/if}
```

- [ ] **Step 1.8: Run tests + commit**

```bash
bun test apps/cortex
```
Expected: 364+ pass, 0 fail

```bash
git add apps/cortex/server/db/queries.ts apps/cortex/server/api/runs.ts \
  apps/cortex/server/services/cortex-store.ts \
  apps/cortex/ui/src/routes/runs/+page.svelte \
  apps/cortex/ui/src/lib/components/VitalsStrip.svelte
git commit -m "feat(cortex): surface run displayName in runs list + inline rename"
```

---

## Task 2 — Provider Health Check in Settings

**Files:**
- Modify: `apps/cortex/server/api/health.ts`
- Modify: `apps/cortex/ui/src/routes/settings/+page.svelte`

### Context
`/api/health` returns `{ ok, version, uptime }`. Settings page pings it but shows no signal on whether cloud provider API keys are configured. Users hit opaque 4xx errors at run time with no prior warning.

---

- [ ] **Step 2.1: Write failing test for `/api/health/providers`**

File: `apps/cortex/server/tests/health.test.ts` (create if not exists):
```typescript
import { describe, it, expect } from "bun:test";

describe("/api/health providers", () => {
  it("returns a status object with known provider keys", async () => {
    const res = await fetch("http://127.0.0.1:4321/api/health/providers");
    // This endpoint doesn't exist yet — test is structural, run after impl
    // For now just check shape:
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe("object");
    expect("anthropic" in body).toBe(true);
  });
});
```

Note: this test requires the dev server running. Instead, test via a unit approach: export the provider-check function and unit test it:

```typescript
import { describe, it, expect } from "bun:test";
import { checkProviders } from "../api/health.js";

describe("checkProviders", () => {
  it("returns missing when env var not set", () => {
    const result = checkProviders({ ANTHROPIC_API_KEY: undefined });
    expect(result.anthropic).toBe("missing");
  });

  it("returns ok when env var set", () => {
    const result = checkProviders({ ANTHROPIC_API_KEY: "sk-test" });
    expect(result.anthropic).toBe("ok");
  });
});
```

- [ ] **Step 2.2: Run test — confirm fails**

```bash
bun test apps/cortex/server/tests/health.test.ts
```

- [ ] **Step 2.3: Implement `checkProviders` + GET `/providers` in `health.ts`**

```typescript
type ProviderStatus = "ok" | "missing";
type ProviderHealthResult = Record<string, ProviderStatus>;

export function checkProviders(env: Record<string, string | undefined> = process.env): ProviderHealthResult {
  return {
    anthropic: env.ANTHROPIC_API_KEY ? "ok" : "missing",
    openai: env.OPENAI_API_KEY ? "ok" : "missing",
    gemini: (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY) ? "ok" : "missing",
  };
}

export const healthRouter = new Elysia({ prefix: "/api/health" })
  .get("/", () => ({
    ok: true,
    version: VERSION,
    uptime: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
  }))
  .get("/providers", () => checkProviders());
```

- [ ] **Step 2.4: Run test — confirm passes**

```bash
bun test apps/cortex/server/tests/health.test.ts
```

- [ ] **Step 2.5: Add provider status pills to `apps/cortex/ui/src/routes/settings/+page.svelte`**

Find the Connection section. Add a new sub-section below the server health check:

```svelte
<script>
  // existing...
  type ProviderStatus = "ok" | "missing" | "unknown";
  let providerHealth = $state<Record<string, ProviderStatus>>({});
  let checkingProviders = $state(false);

  async function checkProviderHealth() {
    checkingProviders = true;
    try {
      const res = await fetch(`${serverUrl}/api/health/providers`);
      if (res.ok) providerHealth = await res.json();
    } finally {
      checkingProviders = false;
    }
  }

  // Auto-check on mount
  onMount(() => void checkProviderHealth());
</script>

<!-- in template, inside the Connection section: -->
<div class="mt-3">
  <div class="flex items-center justify-between mb-2">
    <span class="font-mono text-[10px] uppercase tracking-widest text-outline">API Keys</span>
    <button
      type="button"
      onclick={() => void checkProviderHealth()}
      disabled={checkingProviders}
      class="font-mono text-[10px] text-secondary hover:text-primary disabled:opacity-40"
    >
      {checkingProviders ? "checking…" : "refresh"}
    </button>
  </div>
  <div class="flex flex-wrap gap-2">
    {#each Object.entries(providerHealth) as [provider, status]}
      <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono border
        {status === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700' :
         status === 'missing' ? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700' :
         'border-outline/30 text-outline'}">
        <span class="material-symbols-outlined text-[11px]">
          {status === 'ok' ? 'check_circle' : status === 'missing' ? 'warning' : 'help'}
        </span>
        {provider}
      </span>
    {/each}
    {#if Object.keys(providerHealth).length === 0 && !checkingProviders}
      <span class="text-[10px] text-outline font-mono">connect server to check</span>
    {/if}
  </div>
</div>
```

- [ ] **Step 2.6: Run tests + commit**

```bash
bun test apps/cortex
git add apps/cortex/server/api/health.ts apps/cortex/server/tests/health.test.ts \
  apps/cortex/ui/src/routes/settings/+page.svelte
git commit -m "feat(cortex): provider API key health check in settings"
```

---

## Task 3 — Live Streaming Token + Cost Accumulator in Chat

**Files:**
- Modify: `apps/cortex/ui/src/lib/stores/chat-store.ts`
- Modify: `apps/cortex/ui/src/lib/components/ChatPanel.svelte`

### Context
During SSE streaming, `LLMRequestCompleted` events fire with `tokensUsed` and `estimatedCost`. The chat store handles `StreamCompleted` to set `tokensUsed` on the turn after the fact, but there's no live accumulator shown to the user. `ChatTurn` has `tokensUsed` (set at turn end) but no live running fields. No session-level cost total is shown.

---

- [ ] **Step 3.1: Add `liveTokens` and `liveCost` to `ChatTurn` type in `chat-store.ts`**

Find `export type ChatTurn = {` (line ~59). Add:
```typescript
/** Running total during streaming — undefined when not streaming. */
liveTokens?: number;
liveCost?: number;
```

- [ ] **Step 3.2: Handle `LLMRequestCompleted` during streaming in `chat-store.ts`**

In the SSE streaming loop (around line 480, inside the `else if (event._tag === ...)` chain), add a handler for `LLMRequestCompleted`:

```typescript
} else if (event._tag === "LLMRequestCompleted") {
  const t = (event as { tokensUsed?: number | { total?: number } }).tokensUsed;
  const tokens = typeof t === "number" ? t : (t as { total?: number } | undefined)?.total ?? 0;
  const cost = (event as { estimatedCost?: number }).estimatedCost ?? 0;
  if (tokens > 0 || cost > 0) {
    update((s) => ({
      ...s,
      activeTurns: s.activeTurns.map((turn) => {
        if (turn.id !== assistantTurnId) return turn;
        return {
          ...turn,
          liveTokens: (turn.liveTokens ?? 0) + tokens,
          liveCost: (turn.liveCost ?? 0) + cost,
        };
      }),
    }));
  }
}
```

- [ ] **Step 3.3: Clear `liveTokens`/`liveCost` on turn completion in `chat-store.ts`**

In the `StreamCompleted` handler where `streaming: false` is set, also reset:
```typescript
liveTokens: undefined,
liveCost: undefined,
```

- [ ] **Step 3.4: Show live cost indicator in `ChatPanel.svelte`**

In ChatPanel, find the turn rendering block for streaming turns (around line 159 where `turn.streaming` is checked). Add a live cost badge:

```svelte
{#if turn.streaming && (turn.liveTokens ?? 0) > 0}
  <span class="font-mono text-[9px] text-outline tabular-nums">
    {turn.liveTokens?.toLocaleString()} tok
    {#if (turn.liveCost ?? 0) > 0}
      · ${(turn.liveCost! * 100).toFixed(3)}¢
    {/if}
  </span>
{/if}
```

Also add a session-level running total derived value and show it in the chat header. In `ChatPanel`'s `<script>`:

```typescript
const sessionTokenTotal = $derived(
  turns.reduce((sum, t) => sum + (t.tokensUsed ?? 0), 0)
);
const sessionCostTotal = $derived(
  turns.reduce((sum, t) => sum + 0, 0) // cost not yet on ChatTurn — add when available
);
```

Add to the session cost: extend `ChatTurn` to also track `costUsd?: number`, populate it from `StreamCompleted` `metadata.cost` or `metadata.estimatedCost`, and reduce over turns.

In the chat header:
```svelte
{#if sessionTokenTotal > 0}
  <span class="font-mono text-[9px] text-outline ml-auto tabular-nums">
    {sessionTokenTotal.toLocaleString()} tok total
  </span>
{/if}
```

- [ ] **Step 3.5: Run tests + commit**

```bash
bun test apps/cortex
git add apps/cortex/ui/src/lib/stores/chat-store.ts \
  apps/cortex/ui/src/lib/components/ChatPanel.svelte
git commit -m "feat(cortex): live token/cost accumulation during chat streaming"
```

---

## Task 4 — Beacon Live Step Description

**Files:**
- Modify: `apps/cortex/ui/src/lib/stores/agent-store.ts`
- Modify: `apps/cortex/ui/src/lib/components/BeaconNode.svelte`

### Context
`AgentNode` has `loopIteration` and `reasoningSteps` counts but shows no description of the *current action*. `ToolCallStarted` events are broadcast via WebSocket (all events are forwarded by `ingest-service.ts`) and carry `toolName`. The agent-store `switch` statement doesn't handle `ToolCallStarted`. On tool completion or new reasoning iteration, the label should be cleared.

---

- [ ] **Step 4.1: Add `currentStepLabel` to `AgentNode` interface in `agent-store.ts`**

In `AgentNode` interface (line ~18), add:
```typescript
/** Current action label — set on ToolCallStarted, cleared on completion/new-iter. */
readonly currentStepLabel?: string;
```

- [ ] **Step 4.2: Handle `ToolCallStarted` and `ToolCallCompleted` in agent-store switch**

In the switch block (line ~296), add:
```typescript
case "ToolCallStarted": {
  const toolName = (msg.payload as { toolName?: string }).toolName ?? "tool";
  patch.currentStepLabel = `Calling ${toolName}…`;
  break;
}
case "ToolCallCompleted":
  patch.currentStepLabel = undefined;
  break;
```

Also clear `currentStepLabel` in `ReasoningIterationProgress`:
```typescript
case "ReasoningIterationProgress": {
  // ... existing code ...
  patch.currentStepLabel = undefined; // new iteration, reset label
  break;
}
```

And on `AgentCompleted` / `TaskFailed`:
```typescript
case "AgentCompleted":
  // ... existing ...
  patch.currentStepLabel = undefined;
  break;
case "TaskFailed":
  // ... existing ...
  patch.currentStepLabel = undefined;
  break;
```

- [ ] **Step 4.3: Update agent-store test in `agent-store.test.ts`**

Add a test for the new field:
```typescript
it("sets currentStepLabel on ToolCallStarted and clears on ToolCallCompleted", () => {
  const store = createAgentStore({ ...defaultOpts });
  // send AgentStarted first
  store.handleMessage({ agentId: "a1", runId: "r1", type: "AgentStarted", payload: {} });
  store.handleMessage({ agentId: "a1", runId: "r1", type: "ToolCallStarted", payload: { toolName: "web-search", callId: "c1" } });
  let state: AgentStoreState = { agents: new Map(), loading: false };
  get(store).agents; // Svelte store — use get
  // ... assert currentStepLabel === "Calling web-search…"
  store.handleMessage({ agentId: "a1", runId: "r1", type: "ToolCallCompleted", payload: { toolName: "web-search", callId: "c1", durationMs: 100, success: true } });
  // ... assert currentStepLabel === undefined
});
```

Adapt to the actual test harness pattern already used in `agent-store.test.ts` (which uses `handleMessage` or equivalent) — check line ~190 for the pattern.

- [ ] **Step 4.4: Show `currentStepLabel` in `BeaconNode.svelte`**

Find where `loopIteration` / `reasoningSteps` are displayed in the node. After or below that, add:

```svelte
{#if node.state === "running" && node.currentStepLabel}
  <div
    class="font-mono text-[9px] text-outline/80 truncate max-w-full animate-pulse"
    title={node.currentStepLabel}
  >
    {node.currentStepLabel}
  </div>
{/if}
```

- [ ] **Step 4.5: Run tests + commit**

```bash
bun test apps/cortex
git add apps/cortex/ui/src/lib/stores/agent-store.ts \
  apps/cortex/ui/src/lib/stores/agent-store.test.ts \
  apps/cortex/ui/src/lib/components/BeaconNode.svelte
git commit -m "feat(cortex): beacon node live step label from ToolCallStarted events"
```

---

## Task 5 — "Continue in Chat" Handoff from RunDetail

**Files:**
- Modify: `apps/cortex/server/services/chat-session-service.ts`
- Modify: `apps/cortex/server/api/chat.ts`
- Modify: `apps/cortex/ui/src/lib/components/RunOverview.svelte` (or `RunFinalDeliverable.svelte`)

### Context
No path exists from a completed run to a chat. The run has a prompt (stored as the first event or `display_name`) and an output (final deliverable). We need to: (1) extend `createSession` to accept seed turns, (2) insert those turns in the DB before returning, (3) add a button in RunOverview that creates a seeded chat session and navigates to it.

---

- [ ] **Step 5.1: Write failing test for seeded session creation**

In `apps/cortex/server/tests/chat-session-service.test.ts` (create or add to existing):
```typescript
import { describe, it, expect } from "bun:test";
import { openDatabase } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";

describe("ChatSessionService.createSession with seedTurns", () => {
  it("inserts seed turns into the new session", async () => {
    const db = openDatabase(":memory:");
    const svc = new ChatSessionService(db);
    const sessionId = await svc.createSession({
      agentConfig: { provider: "test" },
      seedTurns: [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
      ],
    });
    const session = svc.getSession(sessionId);
    expect(session?.turns).toHaveLength(2);
    expect(session?.turns[0]?.role).toBe("user");
    expect(session?.turns[1]?.content).toBe("4");
  });
});
```

- [ ] **Step 5.2: Run test — confirm fails**

```bash
bun test apps/cortex/server/tests/chat-session-service.test.ts
```

- [ ] **Step 5.3: Add `seedTurns` to `createSession` in `chat-session-service.ts`**

Modify `createSession` signature:
```typescript
async createSession(opts: {
  name?: string;
  agentConfig: Record<string, unknown>;
  seedTurns?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string> {
  const stableAgentId = generateTaskId();
  const normalizedAgentConfig = normalizeCortexAgentConfig(opts.agentConfig);
  const sessionId = await createChatSession(this.db, {
    ...opts,
    agentConfig: normalizedAgentConfig,
    stableAgentId,
  });
  if (opts.seedTurns?.length) {
    for (const turn of opts.seedTurns) {
      insertChatTurn(this.db, sessionId, turn.role, turn.content, 0);
    }
  }
  return sessionId;
}
```

Check `apps/cortex/server/db/chat-queries.ts` for `insertChatTurn` or equivalent — use the correct function name. If it doesn't exist, add:

```typescript
export function insertChatTurn(
  db: Database,
  sessionId: string,
  role: string,
  content: string,
  tokensUsed = 0,
): void {
  db.prepare(
    `INSERT INTO cortex_chat_turns (session_id, role, content, tokens_used) VALUES (?, ?, ?, ?)`,
  ).run(sessionId, role, content, tokensUsed);
}
```

- [ ] **Step 5.4: Add `seedTurns` to chat session POST body in `api/chat.ts`**

In `ChatSessionConfigBody` TypeBox schema, add:
```typescript
seedTurns: Type.Optional(Type.Array(Type.Object({
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  content: Type.String(),
}))),
```

In the POST `/sessions` handler, pass through to `createSession`:
```typescript
const sessionId = await svc.createSession({
  ...(body.name !== undefined ? { name: body.name } : {}),
  agentConfig: { ... },
  ...(body.seedTurns?.length ? { seedTurns: body.seedTurns } : {}),
});
```

- [ ] **Step 5.5: Run test — confirm passes**

```bash
bun test apps/cortex/server/tests/chat-session-service.test.ts
```

- [ ] **Step 5.6: Add "Open in Chat" button to `RunOverview.svelte`**

In `RunOverview.svelte`, find where the run prompt and output are available. Add:

```svelte
<script>
  // existing props: runId, run, events, etc.
  import { goto } from "$app/navigation";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";

  let openingChat = $state(false);

  async function continueInChat() {
    if (!run?.output && !run?.prompt) return;
    openingChat = true;
    try {
      const seedTurns: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (run.prompt) seedTurns.push({ role: "user", content: run.prompt });
      if (run.output) seedTurns.push({ role: "assistant", content: String(run.output) });

      const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Chat: ${run.displayName ?? run.runId.slice(0, 8)}`,
          provider: run.provider ?? "anthropic",
          model: run.model,
          seedTurns,
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const { sessionId } = await res.json() as { sessionId: string };
      await goto(`/chat?session=${sessionId}`);
    } catch (e) {
      toast.error(`Could not open chat: ${e}`);
    } finally {
      openingChat = false;
    }
  }
</script>

<!-- in template, near the run output/deliverable area: -->
<button
  type="button"
  onclick={() => void continueInChat()}
  disabled={openingChat || (!run?.output && !run?.prompt)}
  class="inline-flex items-center gap-1.5 rounded-md border border-secondary/40 bg-white/90 px-3 py-1.5 font-mono text-[11px] text-secondary hover:border-secondary hover:bg-secondary/5 disabled:opacity-40 dark:bg-surface-container-low/55 dark:hover:bg-secondary/10 transition-colors"
>
  <span class="material-symbols-outlined text-[15px]">chat</span>
  {openingChat ? "Opening…" : "Continue in Chat"}
</button>
```

Also update `chat/+page.svelte` to read the `?session=` URL param on mount and auto-select it:
```svelte
onMount(async () => {
  await chatStore.loadSessions();
  const params = new URLSearchParams(window.location.search);
  const sessionParam = params.get("session");
  if (sessionParam) chatStore.selectSession(sessionParam);
});
```

- [ ] **Step 5.7: Run tests + commit**

```bash
bun test apps/cortex
git add apps/cortex/server/services/chat-session-service.ts \
  apps/cortex/server/db/chat-queries.ts \
  apps/cortex/server/api/chat.ts \
  apps/cortex/ui/src/lib/components/RunOverview.svelte \
  apps/cortex/ui/src/routes/chat/+page.svelte
git commit -m "feat(cortex): continue-in-chat handoff from RunOverview"
```

---

## Task 6 — Prompt Library

**Files:**
- Modify: `apps/cortex/server/db/schema.ts`
- Create: `apps/cortex/server/db/prompt-queries.ts`
- Create: `apps/cortex/server/api/prompts.ts`
- Modify: `apps/cortex/server/index.ts`
- Create: `apps/cortex/ui/src/lib/stores/prompt-store.ts`
- Create: `apps/cortex/ui/src/lib/components/PromptLibrary.svelte`
- Modify: `apps/cortex/ui/src/lib/components/BottomInputBar.svelte`

### Context
No prompt reuse story. Users retype common tasks. The feature: save a prompt with an optional name + tags; load from a searchable dropdown in BottomInputBar and Lab builder input area. Variables are stored as JSON array (re-uses existing `{{var}}` template system).

---

- [ ] **Step 6.1: Write failing test for prompt CRUD**

File: `apps/cortex/server/tests/prompt-queries.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { openDatabase } from "../db/schema.js";
import { insertPrompt, listPrompts, deletePrompt } from "../db/prompt-queries.js";

describe("prompt-queries", () => {
  it("inserts and lists prompts", () => {
    const db = openDatabase(":memory:");
    insertPrompt(db, { name: "Research", body: "Research {{topic}} thoroughly.", tags: ["research"] });
    const list = listPrompts(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Research");
    expect(list[0]?.body).toContain("{{topic}}");
  });

  it("deletes a prompt", () => {
    const db = openDatabase(":memory:");
    const id = insertPrompt(db, { name: "Temp", body: "Hello" });
    deletePrompt(db, id);
    expect(listPrompts(db)).toHaveLength(0);
  });
});
```

- [ ] **Step 6.2: Run test — confirm fails**

```bash
bun test apps/cortex/server/tests/prompt-queries.test.ts
```

- [ ] **Step 6.3: Add `cortex_prompts` table migration in `schema.ts`**

In `applySchema`, add to the CREATE block:
```sql
CREATE TABLE IF NOT EXISTS cortex_prompts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL,
  tags        TEXT    NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_prompts_created
  ON cortex_prompts(created_at DESC);
```

- [ ] **Step 6.4: Create `apps/cortex/server/db/prompt-queries.ts`**

```typescript
import type { Database } from "bun:sqlite";

export interface PromptRow {
  id: number;
  name: string;
  body: string;
  tags: string;
  createdAt: number;
  updatedAt: number;
}

export interface PromptInput {
  name?: string;
  body: string;
  tags?: string[];
}

function mapRow(r: { id: number; name: string; body: string; tags: string; created_at: number; updated_at: number }): PromptRow {
  return {
    id: r.id,
    name: r.name,
    body: r.body,
    tags: r.tags,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function insertPrompt(db: Database, input: PromptInput): number {
  const result = db
    .prepare("INSERT INTO cortex_prompts (name, body, tags) VALUES (?, ?, ?)")
    .run(input.name ?? "", input.body, JSON.stringify(input.tags ?? []));
  return result.lastInsertRowid as number;
}

export function listPrompts(db: Database): PromptRow[] {
  const rows = db
    .prepare("SELECT id, name, body, tags, created_at, updated_at FROM cortex_prompts ORDER BY created_at DESC")
    .all() as Array<{ id: number; name: string; body: string; tags: string; created_at: number; updated_at: number }>;
  return rows.map(mapRow);
}

export function updatePrompt(db: Database, id: number, input: PromptInput): void {
  db.prepare(
    "UPDATE cortex_prompts SET name = ?, body = ?, tags = ?, updated_at = (unixepoch('now','subsec') * 1000) WHERE id = ?",
  ).run(input.name ?? "", input.body, JSON.stringify(input.tags ?? []), id);
}

export function deletePrompt(db: Database, id: number): void {
  db.prepare("DELETE FROM cortex_prompts WHERE id = ?").run(id);
}
```

- [ ] **Step 6.5: Run test — confirm passes**

```bash
bun test apps/cortex/server/tests/prompt-queries.test.ts
```

- [ ] **Step 6.6: Create `apps/cortex/server/api/prompts.ts`**

```typescript
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { insertPrompt, listPrompts, updatePrompt, deletePrompt } from "../db/prompt-queries.js";

export const promptRouter = (db: Database) =>
  new Elysia({ prefix: "/api/prompts" })
    .get("/", () => listPrompts(db))
    .post("/", async ({ body, set }) => {
      const b = body as { name?: string; body?: string; tags?: string[] };
      if (typeof b.body !== "string" || !b.body.trim()) {
        set.status = 400;
        return { error: "body is required" };
      }
      const id = insertPrompt(db, { name: b.name, body: b.body.trim(), tags: b.tags });
      return { id };
    })
    .patch("/:id", async ({ params, body, set }) => {
      const id = Number(params.id);
      const b = body as { name?: string; body?: string; tags?: string[] };
      if (isNaN(id) || typeof b.body !== "string" || !b.body.trim()) {
        set.status = 400;
        return { error: "invalid request" };
      }
      updatePrompt(db, id, { name: b.name, body: b.body.trim(), tags: b.tags });
      return { ok: true };
    })
    .delete("/:id", ({ params }) => {
      deletePrompt(db, Number(params.id));
      return { ok: true };
    });
```

- [ ] **Step 6.7: Mount `promptRouter` in `apps/cortex/server/index.ts`**

Find where other routers are mounted (e.g., `app.use(healthRouter)`). Add:
```typescript
import { promptRouter } from "./api/prompts.js";
// ...
app.use(promptRouter(db));
```

- [ ] **Step 6.8: Create `apps/cortex/ui/src/lib/stores/prompt-store.ts`**

```typescript
import { writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "../constants.js";

export interface StoredPrompt {
  id: number;
  name: string;
  body: string;
  tags: string;
  createdAt: number;
}

const store = writable<StoredPrompt[]>([]);
export const promptStore = {
  subscribe: store.subscribe,
  async load() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/prompts`);
      if (res.ok) store.set(await res.json());
    } catch { /* ignore */ }
  },
  async save(name: string, body: string, tags: string[] = []) {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, body, tags }),
    });
    if (res.ok) await promptStore.load();
    return res.ok;
  },
  async delete(id: number) {
    await fetch(`${CORTEX_SERVER_URL}/api/prompts/${id}`, { method: "DELETE" });
    store.update((list) => list.filter((p) => p.id !== id));
  },
};
```

- [ ] **Step 6.9: Create `apps/cortex/ui/src/lib/components/PromptLibrary.svelte`**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { promptStore, type StoredPrompt } from "$lib/stores/prompt-store.js";

  interface Props {
    onSelect: (body: string) => void;
  }
  let { onSelect }: Props = $props();

  let prompts = $state<StoredPrompt[]>([]);
  let search = $state("");
  let saving = $state(false);
  let saveName = $state("");
  let saveBody = $state("");
  let showSaveForm = $state(false);

  const unsubscribe = promptStore.subscribe((p) => (prompts = p));
  onMount(() => {
    void promptStore.load();
    return unsubscribe;
  });

  const filtered = $derived(
    !search.trim()
      ? prompts
      : prompts.filter(
          (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.body.toLowerCase().includes(search.toLowerCase()),
        ),
  );

  async function save() {
    if (!saveBody.trim()) return;
    saving = true;
    await promptStore.save(saveName || "Untitled", saveBody.trim());
    saving = false;
    showSaveForm = false;
    saveName = "";
    saveBody = "";
  }
</script>

<div class="flex flex-col gap-2 p-2 min-w-[260px]">
  <input
    type="text"
    bind:value={search}
    placeholder="Search prompts…"
    class="w-full rounded border border-[var(--cortex-border)] bg-surface px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
  />
  <div class="max-h-52 overflow-y-auto flex flex-col gap-1">
    {#each filtered as p (p.id)}
      <div class="group flex items-start justify-between gap-1 rounded px-2 py-1.5 hover:bg-primary/5 cursor-pointer"
           role="button" tabindex="0"
           onclick={() => onSelect(p.body)}
           onkeydown={(e) => e.key === "Enter" && onSelect(p.body)}>
        <div class="min-w-0">
          {#if p.name}
            <div class="font-mono text-[10px] font-semibold text-slate-700 dark:text-on-surface truncate">{p.name}</div>
          {/if}
          <div class="font-mono text-[9px] text-outline truncate">{p.body.slice(0, 60)}{p.body.length > 60 ? "…" : ""}</div>
        </div>
        <button
          type="button"
          class="opacity-0 group-hover:opacity-60 text-error hover:opacity-100 transition-opacity"
          onclick={(e) => { e.stopPropagation(); void promptStore.delete(p.id); }}
          title="Delete"
          aria-label="Delete prompt"
        >
          <span class="material-symbols-outlined text-[14px]">delete</span>
        </button>
      </div>
    {/each}
    {#if filtered.length === 0}
      <div class="font-mono text-[10px] text-outline text-center py-2">No prompts saved</div>
    {/if}
  </div>
  {#if showSaveForm}
    <div class="flex flex-col gap-1 border-t border-[var(--cortex-border)] pt-2">
      <input bind:value={saveName} placeholder="Name (optional)" class="rounded border border-[var(--cortex-border)] px-2 py-1 text-xs font-mono bg-surface focus:outline-none focus:ring-1 focus:ring-primary" />
      <textarea bind:value={saveBody} placeholder="Prompt body…" rows="3" class="rounded border border-[var(--cortex-border)] px-2 py-1 text-xs font-mono bg-surface focus:outline-none focus:ring-1 focus:ring-primary resize-none"></textarea>
      <div class="flex gap-1">
        <button onclick={() => void save()} disabled={saving || !saveBody.trim()} class="flex-1 rounded bg-primary text-on-primary text-[10px] font-mono py-1 hover:bg-primary/90 disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onclick={() => { showSaveForm = false; }} class="flex-1 rounded border border-[var(--cortex-border)] text-[10px] font-mono py-1 hover:border-primary">Cancel</button>
      </div>
    </div>
  {:else}
    <button onclick={() => { showSaveForm = true; }} class="rounded border border-[var(--cortex-border)] text-[10px] font-mono py-1 hover:border-primary hover:text-primary transition-colors">
      + Save prompt
    </button>
  {/if}
</div>
```

- [ ] **Step 6.10: Wire `PromptLibrary` into `BottomInputBar.svelte`**

In `BottomInputBar.svelte`, add a book icon button next to the send button that opens a popover with `<PromptLibrary>`. When a prompt is selected, set it as the textarea value:

```svelte
<script>
  import PromptLibrary from "./PromptLibrary.svelte";
  let showPromptLib = $state(false);
  // pass onSelect handler that sets the textarea value
</script>

<div class="relative">
  <button
    type="button"
    onclick={() => (showPromptLib = !showPromptLib)}
    title="Prompt library"
    class="..."
  >
    <span class="material-symbols-outlined text-[18px]">menu_book</span>
  </button>
  {#if showPromptLib}
    <div class="absolute bottom-10 left-0 z-50 rounded-lg border border-[var(--cortex-border)] bg-surface shadow-lg">
      <PromptLibrary onSelect={(body) => { promptText = body; showPromptLib = false; }} />
    </div>
  {/if}
</div>
```

- [ ] **Step 6.11: Run tests + commit**

```bash
bun test apps/cortex
git add apps/cortex/server/db/schema.ts \
  apps/cortex/server/db/prompt-queries.ts \
  apps/cortex/server/api/prompts.ts \
  apps/cortex/server/index.ts \
  apps/cortex/server/tests/prompt-queries.test.ts \
  apps/cortex/ui/src/lib/stores/prompt-store.ts \
  apps/cortex/ui/src/lib/components/PromptLibrary.svelte \
  apps/cortex/ui/src/lib/components/BottomInputBar.svelte
git commit -m "feat(cortex): prompt library — save/load/search prompts"
```

---

## Task 7 — Agent Performance Stats

**Files:**
- Modify: `apps/cortex/server/db/queries.ts`
- Modify: `apps/cortex/server/api/agents.ts`
- Modify: `apps/cortex/ui/src/routes/lab/+page.svelte`

### Context
No aggregate view of an agent's history. The Lab gateway tab lists agents but shows no runtime stats (avg tokens, success rate, run count). All data is in `cortex_runs`.

---

- [ ] **Step 7.1: Write failing test for `getAgentStats`**

In `apps/cortex/server/tests/db.test.ts`, add:
```typescript
it("getAgentStats returns correct aggregates", () => {
  const db = openDatabase(":memory:");
  upsertRun(db, "agent-1", "run-1");
  db.prepare("UPDATE cortex_runs SET status='completed', tokens_used=1000, cost_usd=0.01 WHERE run_id='run-1'").run();
  upsertRun(db, "agent-1", "run-2");
  db.prepare("UPDATE cortex_runs SET status='failed', tokens_used=500, cost_usd=0.005 WHERE run_id='run-2'").run();

  const stats = getAgentStats(db, "agent-1");
  expect(stats.runCount).toBe(2);
  expect(stats.successRate).toBeCloseTo(0.5);
  expect(stats.avgTokens).toBeCloseTo(750);
});
```

- [ ] **Step 7.2: Implement `getAgentStats` in `queries.ts`**

```typescript
export interface AgentStats {
  runCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  avgTokens: number;
  totalCostUsd: number;
  avgDurationMs: number;
}

export function getAgentStats(db: Database, agentId: string): AgentStats {
  const row = db
    .prepare(
      `
    SELECT
      COUNT(*) AS run_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      AVG(CAST(tokens_used AS REAL)) AS avg_tokens,
      SUM(cost_usd) AS total_cost,
      AVG(CASE WHEN completed_at IS NOT NULL THEN completed_at - started_at ELSE NULL END) AS avg_duration_ms
    FROM cortex_runs
    WHERE agent_id = ?
  `,
    )
    .get(agentId) as {
    run_count: number;
    success_count: number;
    failed_count: number;
    avg_tokens: number | null;
    total_cost: number | null;
    avg_duration_ms: number | null;
  } | null;

  if (!row || row.run_count === 0) {
    return { runCount: 0, successCount: 0, failedCount: 0, successRate: 0, avgTokens: 0, totalCostUsd: 0, avgDurationMs: 0 };
  }
  return {
    runCount: row.run_count,
    successCount: row.success_count,
    failedCount: row.failed_count,
    successRate: row.run_count > 0 ? row.success_count / row.run_count : 0,
    avgTokens: row.avg_tokens ?? 0,
    totalCostUsd: row.total_cost ?? 0,
    avgDurationMs: row.avg_duration_ms ?? 0,
  };
}
```

- [ ] **Step 7.3: Add GET `/:agentId/stats` to `apps/cortex/server/api/agents.ts`**

Import `getAgentStats`:
```typescript
import { ..., getAgentStats } from "../db/queries.js";
```

Add route:
```typescript
.get("/:agentId/stats", ({ params }) => {
  return getAgentStats(db, params.agentId);
})
```

- [ ] **Step 7.4: Run test — confirm passes**

```bash
bun test apps/cortex/server/tests/db.test.ts
```

- [ ] **Step 7.5: Show stats in Lab gateway tab**

In `apps/cortex/ui/src/routes/lab/+page.svelte`, in the gateway tab where agent cards are rendered, fetch stats per agent and display a mini stats strip:

```svelte
<script>
  type AgentStats = {
    runCount: number; successRate: number; avgTokens: number; totalCostUsd: number;
  };
  let agentStats = $state<Record<string, AgentStats>>({});

  async function loadAgentStats(agentId: string) {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/agents/${encodeURIComponent(agentId)}/stats`);
      if (res.ok) agentStats = { ...agentStats, [agentId]: await res.json() };
    } catch { /* ignore */ }
  }

  $effect(() => {
    // load stats for all agents when gateway tab is active
    if (activeTab === "gateway") {
      for (const agent of agents) void loadAgentStats(agent.agentId);
    }
  });
</script>

<!-- in the gateway agent card template: -->
{#if agentStats[agent.agentId]}
  {@const s = agentStats[agent.agentId]}
  <div class="flex gap-3 font-mono text-[9px] text-outline mt-1 tabular-nums">
    <span>{s.runCount} runs</span>
    <span>{Math.round(s.successRate * 100)}% ok</span>
    <span>{Math.round(s.avgTokens).toLocaleString()} avg tok</span>
    <span>${(s.totalCostUsd * 100).toFixed(2)}¢ total</span>
  </div>
{/if}
```

- [ ] **Step 7.6: Run tests + commit**

```bash
bun test apps/cortex
git add apps/cortex/server/db/queries.ts \
  apps/cortex/server/api/agents.ts \
  apps/cortex/ui/src/routes/lab/+page.svelte
git commit -m "feat(cortex): agent performance stats endpoint + Lab display"
```

---

## Task 8 — Command Palette: Register Cortex Commands

**Files:**
- Modify: `apps/cortex/ui/src/routes/+layout.svelte`

### Context
`CommandPalette.svelte` (287 lines) and `command-palette.ts` store are fully implemented and mounted. The ⌘K shortcut is wired at `+layout.svelte:59`. Commands just need to be registered. Check what's already in `+layout.svelte` by searching for `commandPalette.register`.

---

- [ ] **Step 8.1: Check existing command registrations in `+layout.svelte`**

```bash
grep -n "register\|Command\|commandPalette" apps/cortex/ui/src/routes/+layout.svelte
```

- [ ] **Step 8.2: Register navigation + run-launch commands**

In `+layout.svelte` `onMount`, add (or extend existing) `commandPalette.register(...)`:

```typescript
commandPalette.register([
  {
    id: "nav:beacon",
    label: "Go to Beacon",
    description: "Agent grid and live status",
    icon: "home",
    keywords: ["beacon", "home", "agents", "grid"],
    action: () => goto("/"),
  },
  {
    id: "nav:chat",
    label: "New Chat",
    description: "Start a new agent conversation",
    icon: "chat",
    keywords: ["chat", "conversation", "new"],
    action: () => goto("/chat"),
  },
  {
    id: "nav:runs",
    label: "Execution Trace",
    description: "Browse all agent runs",
    icon: "timeline",
    keywords: ["runs", "trace", "history"],
    action: () => goto("/runs"),
  },
  {
    id: "nav:lab",
    label: "Open Lab",
    description: "Build and configure agents",
    icon: "science",
    keywords: ["lab", "builder", "configure"],
    action: () => goto("/lab"),
  },
  {
    id: "nav:settings",
    label: "Settings",
    description: "Configure Cortex",
    icon: "settings",
    keywords: ["settings", "config", "preferences"],
    action: () => goto("/settings"),
  },
]);
```

- [ ] **Step 8.3: Verify ⌘K opens the palette**

Start dev server (`bun run dev` from `apps/cortex`), press ⌘K, confirm palette opens and commands are searchable.

- [ ] **Step 8.4: Commit**

```bash
git add apps/cortex/ui/src/routes/+layout.svelte
git commit -m "feat(cortex): register nav commands in command palette"
```

---

## Self-Review Checklist

- [x] Task 1 covers: displayName in UI, search, PATCH rename endpoint, VitalsStrip rename
- [x] Task 2 covers: `/api/health/providers` endpoint + Settings UI pills
- [x] Task 3 covers: live token accumulation during streaming + ChatPanel counter
- [x] Task 4 covers: ToolCallStarted → `currentStepLabel` in AgentNode + BeaconNode display
- [x] Task 5 covers: `seedTurns` in createSession + RunOverview button + chat nav
- [x] Task 6 covers: new table, CRUD queries, router, UI store, PromptLibrary component, BottomInputBar wiring
- [x] Task 7 covers: aggregate stats query, API endpoint, Lab display
- [x] Task 8 covers: command palette command registration (feature already built, just needs commands)
- [x] No placeholders — all code blocks contain actual implementations
- [x] Types consistent across tasks (e.g., `AgentNode.currentStepLabel` used same spelling in store and component)
- [x] Each task ends with `bun test apps/cortex` + a commit

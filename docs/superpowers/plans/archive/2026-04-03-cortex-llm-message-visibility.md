# Cortex LLM Message Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Messages" tab to the run detail view that shows the raw LLM conversation thread — system prompt, user messages, assistant thoughts with tool calls, and tool results — extracted from stored `ReasoningStepCompleted` events.

**Architecture:** A new `GET /api/runs/:runId/messages` endpoint queries `cortex_events` for `ReasoningStepCompleted` rows, extracts their `messages` arrays grouped by kernel pass (iteration), and returns them as JSON. A new `MessagesPanel.svelte` component fetches and renders the thread as role-colored bubbles with collapsible iteration sections. `RunDetail.svelte` gets a new "Messages" tab that mounts this panel.

**Tech Stack:** Bun/TypeScript, Elysia, SQLite (bun:sqlite), Svelte 5 (runes), Tailwind CSS

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/cortex/server/api/messages.ts` | `GET /api/runs/:runId/messages` — query + parse events |
| Modify | `apps/cortex/server/index.ts` | Mount messages router |
| Create | `apps/cortex/ui/src/lib/components/MessagesPanel.svelte` | Message thread renderer |
| Modify | `apps/cortex/ui/src/lib/components/RunDetail.svelte` | Add "Messages" tab |

---

### Task 1: `GET /api/runs/:runId/messages` endpoint

**Files:**
- Create: `apps/cortex/server/api/messages.ts`

**Background:** `cortex_events` has `type TEXT` and `payload TEXT` (JSON). `ReasoningStepCompleted` events store the full LLM conversation in `payload.messages` as `KernelMessage[]`. Each message has `role: "system" | "user" | "assistant" | "tool"` and `content: string | ContentBlock[]`. The event also has `payload.kernelPass` (the kernel loop/iteration number), `payload.step` (inner strategy step), and `payload.strategy`.

- [ ] **Step 1: Write the failing test**

Create `apps/cortex/server/tests/messages-api.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { openDatabase } from "../db/schema.js";
import { mkdirSync, rmSync } from "node:fs";
import { getRunMessages } from "../db/messages-queries.js";

const TEST_DB_PATH = "/tmp/cortex-messages-test.db";

let db: ReturnType<typeof openDatabase>;

beforeAll(() => {
  db = openDatabase(TEST_DB_PATH);
  // Seed a run and two ReasoningStepCompleted events
  db.prepare(`INSERT OR IGNORE INTO cortex_runs (run_id, agent_id, started_at, status) VALUES (?,?,?,?)`).run("run-msg-1", "agent-1", Date.now(), "completed");

  const msgs1 = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "Let me think.", toolCalls: [] },
  ];
  db.prepare(`INSERT INTO cortex_events (agent_id, run_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?)`).run(
    "agent-1", "run-msg-1", 1, Date.now(), "ReasoningStepCompleted",
    JSON.stringify({ kernelPass: 1, step: 1, totalSteps: 1, strategy: "reactive", thought: "...", messages: msgs1 }),
  );

  const msgs2 = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "The answer is 4.", toolCalls: [] },
  ];
  db.prepare(`INSERT INTO cortex_events (agent_id, run_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?)`).run(
    "agent-1", "run-msg-1", 2, Date.now(), "ReasoningStepCompleted",
    JSON.stringify({ kernelPass: 2, step: 1, totalSteps: 1, strategy: "reactive", thought: "...", messages: msgs2 }),
  );
});

afterAll(() => {
  db.close();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("getRunMessages", () => {
  it("returns grouped message threads for a run", () => {
    const groups = getRunMessages(db, "run-msg-1");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.kernelPass).toBe(1);
    expect(groups[0]!.strategy).toBe("reactive");
    expect(groups[0]!.messages).toHaveLength(3);
    expect(groups[0]!.messages[0]!.role).toBe("system");
    expect(groups[1]!.kernelPass).toBe(2);
  });

  it("returns empty array for unknown run", () => {
    const groups = getRunMessages(db, "no-such-run");
    expect(groups).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/server/tests/messages-api.test.ts 2>&1 | tail -15
```

Expected: FAIL — `../db/messages-queries.js` not found.

- [ ] **Step 3: Create `apps/cortex/server/db/messages-queries.ts`**

```typescript
import type { Database } from "bun:sqlite";

export type KernelMessageRole = "system" | "user" | "assistant" | "tool";

export type KernelMessage = {
  role: KernelMessageRole;
  content: string | Array<{ type: string; [key: string]: unknown }>;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolName?: string;
  toolCallId?: string;
};

export type MessageGroup = {
  seq: number;
  kernelPass: number;
  step: number;
  totalSteps: number;
  strategy: string;
  messages: KernelMessage[];
};

export function getRunMessages(db: Database, runId: string): MessageGroup[] {
  const rows = db
    .prepare(
      `SELECT seq, payload FROM cortex_events
       WHERE run_id = ? AND type = 'ReasoningStepCompleted'
       ORDER BY seq ASC`,
    )
    .all(runId) as Array<{ seq: number; payload: string }>;

  const groups: MessageGroup[] = [];
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const messages = Array.isArray(parsed.messages) ? (parsed.messages as KernelMessage[]) : [];
    if (messages.length === 0) continue;
    groups.push({
      seq: row.seq,
      kernelPass: typeof parsed.kernelPass === "number" ? parsed.kernelPass : groups.length + 1,
      step: typeof parsed.step === "number" ? parsed.step : 1,
      totalSteps: typeof parsed.totalSteps === "number" ? parsed.totalSteps : 1,
      strategy: typeof parsed.strategy === "string" ? parsed.strategy : "unknown",
      messages,
    });
  }
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test apps/cortex/server/tests/messages-api.test.ts 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 5: Create `apps/cortex/server/api/messages.ts`**

```typescript
import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { getRunMessages } from "../db/messages-queries.js";

export const messagesRouter = (db: Database) =>
  new Elysia({ prefix: "/api/runs" }).get("/:runId/messages", ({ params }) => {
    return getRunMessages(db, params.runId);
  });
```

- [ ] **Step 6: Mount the router in `apps/cortex/server/index.ts`**

Find the line where routers are mounted (look for `runsRouter`, `agentsRouter`, etc.) and add:

```typescript
import { messagesRouter } from "./api/messages.js";
```

Then in the Elysia app setup, add `.use(messagesRouter(db))` alongside the other routers.

- [ ] **Step 7: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -20
```

Expected: Zero errors.

- [ ] **Step 8: Commit**

```bash
git add apps/cortex/server/db/messages-queries.ts \
        apps/cortex/server/api/messages.ts \
        apps/cortex/server/tests/messages-api.test.ts \
        apps/cortex/server/index.ts
git commit -m "feat(cortex): GET /api/runs/:runId/messages extracts LLM conversation threads"
```

---

### Task 2: `MessagesPanel.svelte` — LLM thread renderer

**Files:**
- Create: `apps/cortex/ui/src/lib/components/MessagesPanel.svelte`

**Background:** The panel fetches message groups from the API and renders them as a conversation thread. Each `MessageGroup` has a `kernelPass` (iteration number), `strategy`, and `messages` array. Messages have `role` and `content` (string or `ContentBlock[]`). Assistant messages may have `toolCalls` arrays. Tool messages have `toolCallId` and `toolName`.

Color scheme (matches Cortex's dark theme):
- `system` → muted gray, italic
- `user` → blue tint border
- `assistant` → primary tint border
- `tool` → secondary/green tint border for results

- [ ] **Step 1: Write a basic render test (visual smoke test)**

Create `apps/cortex/ui/src/lib/components/MessagesPanel.test.ts` — note: Svelte components don't have a Bun test harness here, so verify by running the UI. Skip to Step 2.

- [ ] **Step 2: Create `MessagesPanel.svelte`**

```svelte
<script lang="ts">
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import type { MessageGroup, KernelMessage } from "$lib/types/messages.js";

  interface Props { runId: string; }
  const { runId } = $props();

  let groups = $state<MessageGroup[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let collapsed = $state<Set<number>>(new Set());

  $effect(() => {
    loading = true;
    error = null;
    fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/messages`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MessageGroup[]>;
      })
      .then((data) => { groups = data; loading = false; })
      .catch((e) => { error = String(e); loading = false; });
  });

  function toggleCollapse(kernelPass: number) {
    const next = new Set(collapsed);
    if (next.has(kernelPass)) next.delete(kernelPass);
    else next.add(kernelPass);
    collapsed = next;
  }

  function contentText(content: KernelMessage["content"]): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((b) => {
          if (typeof b === "string") return b;
          if (b.type === "text" && typeof b.text === "string") return b.text;
          if (b.type === "tool_use") return `[tool_use: ${b.name ?? "?"}]`;
          if (b.type === "tool_result") {
            const c = b.content;
            return `[tool_result: ${typeof c === "string" ? c : JSON.stringify(c)}]`;
          }
          return JSON.stringify(b);
        })
        .join("\n");
    }
    return "";
  }

  const roleStyle: Record<string, { border: string; label: string; labelColor: string }> = {
    system:    { border: "border-white/10",       label: "system",    labelColor: "text-outline/50" },
    user:      { border: "border-primary/25",     label: "user",      labelColor: "text-primary/70" },
    assistant: { border: "border-secondary/25",   label: "assistant", labelColor: "text-secondary/70" },
    tool:      { border: "border-tertiary/25",    label: "tool",      labelColor: "text-tertiary/70" },
  };
</script>

<div class="h-full overflow-y-auto font-mono text-[11px] p-3 space-y-4">
  {#if loading}
    <p class="text-outline/40 italic">Loading messages…</p>
  {:else if error}
    <p class="text-error/70">Failed to load: {error}</p>
  {:else if groups.length === 0}
    <p class="text-outline/40 italic">No LLM messages recorded for this run. Messages are captured from ReasoningStepCompleted events.</p>
  {:else}
    {#each groups as group (group.kernelPass)}
      <!-- Iteration header -->
      <div>
        <button
          type="button"
          class="flex items-center gap-2 w-full text-left text-[10px] text-outline/50 uppercase tracking-widest
                 mb-2 hover:text-outline/80 bg-transparent border-0 cursor-pointer p-0"
          onclick={() => toggleCollapse(group.kernelPass)}
        >
          <span class="material-symbols-outlined text-[11px]">
            {collapsed.has(group.kernelPass) ? "chevron_right" : "expand_more"}
          </span>
          Loop {group.kernelPass}
          {#if group.totalSteps > 1}
            <span class="text-outline/30">· step {group.step}/{group.totalSteps}</span>
          {/if}
          <span class="text-outline/30">· {group.strategy}</span>
          <span class="text-outline/20">· {group.messages.length} messages</span>
        </button>

        {#if !collapsed.has(group.kernelPass)}
          <div class="space-y-1.5 pl-2">
            {#each group.messages as msg, i (i)}
              {@const style = roleStyle[msg.role] ?? roleStyle["system"]!}
              <div class="border-l-2 {style.border} pl-3 py-1">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="text-[9px] uppercase tracking-widest {style.labelColor}">{msg.role}</span>
                  {#if msg.toolName}
                    <span class="text-[9px] text-tertiary/60">← {msg.toolName}</span>
                  {/if}
                  {#if msg.toolCalls && msg.toolCalls.length > 0}
                    <span class="text-[9px] text-secondary/60">
                      calls: {msg.toolCalls.map((tc) => tc.name).join(", ")}
                    </span>
                  {/if}
                </div>
                <pre class="whitespace-pre-wrap text-on-surface/75 leading-relaxed text-[10px] m-0 font-mono">{contentText(msg.content)}</pre>
                {#if msg.toolCalls && msg.toolCalls.length > 0}
                  {#each msg.toolCalls as tc}
                    <details class="mt-1">
                      <summary class="text-[9px] text-secondary/50 cursor-pointer hover:text-secondary/80">
                        tool_use: {tc.name}
                      </summary>
                      <pre class="text-[9px] text-on-surface/50 ml-2 mt-0.5 whitespace-pre-wrap">{JSON.stringify(tc.input, null, 2)}</pre>
                    </details>
                  {/each}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
```

- [ ] **Step 3: Create `apps/cortex/ui/src/lib/types/messages.ts`**

```typescript
export type KernelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; [key: string]: unknown }>;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolName?: string;
  toolCallId?: string;
};

export type MessageGroup = {
  seq: number;
  kernelPass: number;
  step: number;
  totalSteps: number;
  strategy: string;
  messages: KernelMessage[];
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/cortex/ui/src/lib/components/MessagesPanel.svelte \
        apps/cortex/ui/src/lib/types/messages.ts
git commit -m "feat(cortex): MessagesPanel renders LLM conversation thread per iteration"
```

---

### Task 3: Add "Messages" tab to `RunDetail.svelte`

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/RunDetail.svelte`

**Background:** `bottomTab` is typed as a string union on line 181. The tab list is defined inline in the template at line 402. The panel content switch is at line 504. We add `"messages"` to the union, a tab entry, and the panel branch.

- [ ] **Step 1: Add import for MessagesPanel**

In `RunDetail.svelte`, after the `RawEventLog` import (line 12), add:

```typescript
import MessagesPanel from "$lib/components/MessagesPanel.svelte";
```

- [ ] **Step 2: Add "messages" to the bottomTab union type**

Change line 181 from:
```typescript
let bottomTab = $state<"decisions" | "memory" | "context" | "debrief" | "signal" | "events">("decisions");
```
to:
```typescript
let bottomTab = $state<"decisions" | "memory" | "context" | "debrief" | "signal" | "events" | "messages">("decisions");
```

- [ ] **Step 3: Add "Messages" tab button**

In the tab list array starting at line 402, after the `events` entry, add:

```svelte
{ id: "messages",   label: "Messages",     icon: "chat_bubble"  },
```

The full array becomes:
```svelte
{#each [
  { id: "decisions", label: "Decisions",    icon: "analytics"    },
  { id: "memory",    label: "Memory",       icon: "account_tree" },
  { id: "context",   label: "Context",      icon: "data_usage"   },
  { id: "debrief",   label: "Debrief",      icon: "summarize",
    dot: !!$runStore.debrief },
  { id: "signal",    label: "Signal",       icon: "show_chart"   },
  { id: "events",    label: "Events",       icon: "terminal"     },
  { id: "messages",  label: "Messages",     icon: "chat_bubble"  },
] as tab (tab.id)}
```

- [ ] **Step 4: Add panel content branch**

In the `{#if bottomTab === "decisions"}` ... `{/if}` block (line 504), change the final `{:else}` (currently showing `RawEventLog`) to:

```svelte
{:else if bottomTab === "events"}
  <RawEventLog events={panelEvents($runStore.events)} />
{:else if bottomTab === "messages"}
  <MessagesPanel {runId} />
{/if}
```

(The original `{:else}` catch-all becomes explicit `{:else if bottomTab === "events"}`.)

- [ ] **Step 5: Verify UI in browser**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cortex
bun run dev 2>&1 &
```

Navigate to any completed run with reasoning steps. Verify:
1. "Messages" tab appears in the footer tab bar
2. Clicking it loads message groups
3. Iteration headers are collapsible
4. System/user/assistant/tool roles render with correct colors and borders
5. Tool calls show expandable input JSON

- [ ] **Step 6: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -20
```

Expected: Zero errors.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/ui/src/lib/components/RunDetail.svelte
git commit -m "feat(cortex): Messages tab in run detail shows raw LLM conversation thread"
```

---

## Self-Review

**Spec coverage:**
- ✅ API endpoint extracts messages from stored events — Task 1
- ✅ Groups by kernel pass (iteration) — Task 1, `getRunMessages()`
- ✅ Role-colored bubbles (system/user/assistant/tool) — Task 2
- ✅ Tool call inputs expandable — Task 2
- ✅ Collapsible per-iteration sections — Task 2
- ✅ "Messages" tab in RunDetail — Task 3
- ✅ Handles empty state (no messages recorded) — Task 2

**Placeholder scan:** None.

**Type consistency:** `KernelMessage` and `MessageGroup` defined in `apps/cortex/ui/src/lib/types/messages.ts` (UI) and `apps/cortex/server/db/messages-queries.ts` (server) — names match. `getRunMessages()` defined in Task 1 Step 3, used by API in Task 1 Step 5, consistent signature throughout.

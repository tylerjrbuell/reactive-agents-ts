# Cortex Chat ⇄ Builder Tool Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Cortex chat sessions use the same tools as the Lab builder — built-in tools, MCP server tools, dynamic sub-agents, and custom (`agentTools`) tools — configured via the full `AgentConfigPanel` or by snapshotting a saved agent.

**Architecture:** Chat already builds agents through `buildCortexAgent` (same path as the Lab). The gap is purely Cortex-side threading + UI: extend the chat API/config to carry the builder's tool fields, resolve `mcpServerIds → mcpConfigs` in `buildChatAgentParams`, dispose the cached agent on config-change/close so MCP containers don't leak, and surface config via the existing `AgentConfigPanel` + a saved-agent picker.

**Tech Stack:** Bun + Elysia (server), SvelteKit + Svelte 5 runes (UI), bun:test, SQLite, `@reactive-agents/runtime` (`buildCortexAgent`, `AgentSession`).

**Spec:** `wiki/Architecture/Design-Specs/2026-06-09-cortex-chat-tool-parity-design.md`

**Conventions:** No `Co-Authored-By` trailers. Use `rtk proxy git …`, `rtk grep` (bare git/grep can bus-error). Clean strict TS, no `any`. Run cortex server tests from `apps/cortex` (`bun test server/tests …`), ui tests from `apps/cortex/ui` (`bun test src/lib`). `bun run typecheck` from `apps/cortex`; svelte-check via `cd ui && bun run check` (baseline: 20 errors all `bun:test`/vite, 1 a11y warning in AgentCard — your files must add none).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `server/services/chat-tool-params.ts` | Pure mapper: agent config → tool-related `buildCortexAgent` params | Create |
| `server/services/chat-tool-params.test.ts` | Unit tests for the mapper | Create |
| `server/services/chat-session-service.ts` | Resolve `mcpServerIds`, thread tool params, dispose agent on evict | Modify |
| `server/services/chat-session-service.test.ts` | Lifecycle test (dispose on update/delete) | Create |
| `server/api/chat.ts` | Accept the builder tool fields in session config body | Modify |
| `server/tests/chat-config-parity.test.ts` | Body round-trips the new fields | Create |
| `ui/src/lib/stores/chat-store.ts` | `ChatSessionConfigInput` + create/update carry new fields | Modify |
| `ui/src/lib/components/ChatSessionList.svelte` | Embed `AgentConfigPanel` + saved-agent picker | Modify |

---

## Task 1: Pure tool-param mapper

**Files:**
- Create: `apps/cortex/server/services/chat-tool-params.ts`
- Test: `apps/cortex/server/services/chat-tool-params.test.ts`

Mirrors the Lab run path (`runner-service.ts:130-160`): when tools are enabled,
forward `mcpConfigs` (already resolved by the caller), `agentTools`,
`dynamicSubAgents`, `additionalToolNames`. When tools are off, forward none.

- [ ] **Step 1: Write the failing test**

Create `apps/cortex/server/services/chat-tool-params.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { chatToolParams } from "./chat-tool-params.js";
import type { MCPServerConfig } from "./build-cortex-agent.js";

const mcp: MCPServerConfig[] = [{ name: "context7" } as MCPServerConfig];

describe("chatToolParams", () => {
  it("omits all tool fields when tools are off", () => {
    const out = chatToolParams(
      { agentTools: [{ id: "x" }], dynamicSubAgents: { enabled: true }, additionalToolNames: "y" },
      false,
      mcp,
    );
    expect(out).toEqual({});
  });

  it("forwards mcpConfigs, agentTools, dynamicSubAgents, additionalToolNames when on", () => {
    const out = chatToolParams(
      {
        agentTools: [{ id: "x" }],
        dynamicSubAgents: { enabled: true, maxIterations: 3 },
        additionalToolNames: "  my-tool  ",
      },
      true,
      mcp,
    );
    expect(out.mcpConfigs).toEqual(mcp);
    expect(out.agentTools).toEqual([{ id: "x" }]);
    expect(out.dynamicSubAgents).toEqual({ enabled: true, maxIterations: 3 });
    expect(out.additionalToolNames).toBe("my-tool");
  });

  it("omits empty/blank optional fields when on", () => {
    const out = chatToolParams({ additionalToolNames: "   " }, true, []);
    expect("additionalToolNames" in out).toBe(false);
    expect("agentTools" in out).toBe(false);
    expect("dynamicSubAgents" in out).toBe(false);
    expect("mcpConfigs" in out).toBe(false); // empty mcp array → omit
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cortex && rtk proxy bun test server/services/chat-tool-params.test.ts`
Expected: FAIL — "Cannot find module './chat-tool-params.js'".

- [ ] **Step 3: Implement the mapper**

Create `apps/cortex/server/services/chat-tool-params.ts`:

```ts
import type { BuildCortexAgentParams, MCPServerConfig } from "./build-cortex-agent.js";

type ToolParams = Partial<
  Pick<BuildCortexAgentParams, "mcpConfigs" | "agentTools" | "dynamicSubAgents" | "additionalToolNames">
>;

/**
 * Tool-related `buildCortexAgent` params derived from a chat session's agent
 * config — mirrors the Lab run path (`runner-service.ts` start()). When
 * `enableTools` is false the agent runs tool-less, so every tool field is omitted.
 * `mcpConfigs` is resolved by the caller (id → config) and passed in.
 */
export function chatToolParams(
  agentConfig: Record<string, unknown>,
  enableTools: boolean,
  mcpConfigs: readonly MCPServerConfig[],
): ToolParams {
  if (!enableTools) return {};
  const out: ToolParams = {};

  if (mcpConfigs.length > 0) out.mcpConfigs = [...mcpConfigs];

  if (Array.isArray(agentConfig.agentTools) && agentConfig.agentTools.length > 0) {
    out.agentTools = agentConfig.agentTools as BuildCortexAgentParams["agentTools"];
  }

  const dsa = agentConfig.dynamicSubAgents;
  if (dsa && typeof dsa === "object" && !Array.isArray(dsa) && (dsa as { enabled?: unknown }).enabled === true) {
    out.dynamicSubAgents = dsa as BuildCortexAgentParams["dynamicSubAgents"];
  }

  const addl = typeof agentConfig.additionalToolNames === "string" ? agentConfig.additionalToolNames.trim() : "";
  if (addl.length > 0) out.additionalToolNames = addl;

  return out;
}
```

> NOTE: confirm the exact `BuildCortexAgentParams` field types for `agentTools` /
> `dynamicSubAgents` by reading `server/services/build-cortex-agent.ts` (the
> `agentTools?` and `dynamicSubAgents?` members). Match them; do not introduce `any`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cortex && rtk proxy bun test server/services/chat-tool-params.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/cortex && rtk proxy bun run typecheck` → PASS.
```bash
git add apps/cortex/server/services/chat-tool-params.ts apps/cortex/server/services/chat-tool-params.test.ts
git commit -m "feat(cortex): pure chatToolParams mapper for chat tool parity"
```

---

## Task 2: Resolve MCP ids + thread tool params into the chat agent

**Files:**
- Modify: `apps/cortex/server/services/chat-session-service.ts`

`buildChatAgentParams` is synchronous and already returns `BuildCortexAgentParams`.
Resolve `mcpServerIds → mcpConfigs` synchronously (raw db query, same data the
Effect store wraps) and spread `chatToolParams(...)` into the returned object.

- [ ] **Step 1: Add imports**

At the top of `chat-session-service.ts`, with the other imports:

```ts
import { getMcpServersByIds, parseMcpConfig } from "../db/mcp-queries.js";
import { chatToolParams } from "./chat-tool-params.js";
```

- [ ] **Step 2: Resolve MCP configs + merge tool params inside `buildChatAgentParams`**

Find the `enableTools` const and the `return {` object in `buildChatAgentParams`
(around `chat-session-service.ts:284-460`). Just before the `return`, add:

```ts
    const mcpServerIds = Array.isArray(agentConfig.mcpServerIds)
      ? (agentConfig.mcpServerIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const mcpConfigs =
      enableTools && mcpServerIds.length > 0
        ? getMcpServersByIds(this.db, mcpServerIds).map(parseMcpConfig)
        : [];
    const toolParams = chatToolParams(agentConfig, enableTools, mcpConfigs);
```

Then spread `toolParams` into the `return { … }` object (add `...toolParams,`
alongside the existing `...(enableTools ? { tools: mergedTools, … } : {})` block).
The existing built-in `tools` / terminal handling stays unchanged — `toolParams`
only adds `mcpConfigs` / `agentTools` / `dynamicSubAgents` / `additionalToolNames`.

> The mapper logic is unit-tested in Task 1. This task is DB-resolution + wiring;
> it is exercised end-to-end by Task 8's Playwright check (needs a real MCP +
> build, not a unit).

- [ ] **Step 3: Typecheck**

Run: `cd apps/cortex && rtk proxy bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Run existing chat/server tests (no regressions)**

Run: `cd apps/cortex && rtk proxy bun test server/tests --timeout 15000`
Expected: PASS (same count as before this task).

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/services/chat-session-service.ts
git commit -m "feat(cortex): thread MCP/agentTools/sub-agents into chat agent build"
```

---

## Task 3: Chat API body accepts the builder tool fields

**Files:**
- Modify: `apps/cortex/server/api/chat.ts`
- Test: `apps/cortex/server/tests/chat-config-parity.test.ts`

Extend `ChatSessionConfigBody` and the create/patch handlers to accept + persist:
`mcpServerIds`, `agentTools`, `dynamicSubAgents`, `additionalToolNames`, `skills`,
`terminalTools`. Storage is the permissive `agentConfig` blob (already preserved
by `normalizeCortexAgentConfig`), so only the typed API surface + handler spreads change.

- [ ] **Step 1: Write the failing parity test**

Create `apps/cortex/server/tests/chat-config-parity.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { getChatSession } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { Layer } from "effect";

function makeSvc(db: Database): ChatSessionService {
  const ingestLayer = Layer.provide(CortexIngestServiceLive, CortexEventBridgeLive);
  return new ChatSessionService(db, ingestLayer);
}

describe("chat session config — builder tool parity", () => {
  it("persists mcpServerIds / agentTools / dynamicSubAgents / additionalToolNames", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const svc = makeSvc(db);

    const id = await svc.createSession({
      name: "tooled",
      agentConfig: {
        provider: "test",
        enableTools: true,
        mcpServerIds: ["mcp-1"],
        agentTools: [{ id: "custom-x" }],
        dynamicSubAgents: { enabled: true, maxIterations: 2 },
        additionalToolNames: "my-tool",
      },
    });

    const row = getChatSession(db, id);
    const cfg = row!.agentConfig as Record<string, unknown>;
    expect(cfg.mcpServerIds).toEqual(["mcp-1"]);
    expect(cfg.agentTools).toEqual([{ id: "custom-x" }]);
    expect(cfg.dynamicSubAgents).toEqual({ enabled: true, maxIterations: 2 });
    expect(cfg.additionalToolNames).toBe("my-tool");
  });
});
```

> VERIFY the exact constructor signature of `ChatSessionService`, the
> `createSession` option shape, and `getChatSession` import path by reading
> `chat-session-service.ts` + `db/chat-queries.ts` first; adapt the harness to match
> (mirror `server/tests/gateway-process-manager.test.ts` for the layer setup).

- [ ] **Step 2: Run to verify it fails (or reveals the gap)**

Run: `cd apps/cortex && rtk proxy bun test server/tests/chat-config-parity.test.ts --timeout 15000`
Expected: FAIL — the new fields are dropped by `normalizeCortexAgentConfig` only if
it field-maps; if it spreads `{...raw}` they may already persist via `createSession`.
If the test already passes because `createSession` stores the raw blob, KEEP the test
(it pins the contract) and move to Step 3 to wire the HTTP body.

- [ ] **Step 3: Extend `ChatSessionConfigBody` + handlers**

In `apps/cortex/server/api/chat.ts`, add to `ChatSessionConfigBody` (the `t.Object`):

```ts
  mcpServerIds: t.Optional(t.Array(t.String())),
  agentTools: t.Optional(t.Array(t.Unknown())),
  dynamicSubAgents: t.Optional(
    t.Object({ enabled: t.Boolean(), maxIterations: t.Optional(t.Number()) }),
  ),
  additionalToolNames: t.Optional(t.String()),
  terminalTools: t.Optional(t.Boolean()),
  skills: t.Optional(t.Object({ paths: t.Array(t.String()) })),
```

In the create + config-patch handlers, forward these into the stored config
object using the same conditional-spread style as the existing fields, e.g.:

```ts
              ...(body.mcpServerIds?.length ? { mcpServerIds: body.mcpServerIds } : {}),
              ...(body.agentTools?.length ? { agentTools: body.agentTools } : {}),
              ...(body.dynamicSubAgents ? { dynamicSubAgents: body.dynamicSubAgents } : {}),
              ...(body.additionalToolNames ? { additionalToolNames: body.additionalToolNames } : {}),
              ...(body.terminalTools === true ? { terminalTools: true } : {}),
              ...(body.skills ? { skills: body.skills } : {}),
```

> Read the current create handler (`chat.ts` ~L50-70) and mirror exactly where it
> spreads `tools` / `enableTools`. Apply the same spreads to the PATCH `/config`
> handler.

- [ ] **Step 4: Run the parity test (+ existing chat tests)**

Run: `cd apps/cortex && rtk proxy bun test server/tests/chat-config-parity.test.ts server/tests --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/cortex && rtk proxy bun run typecheck` → PASS.
```bash
git add apps/cortex/server/api/chat.ts apps/cortex/server/tests/chat-config-parity.test.ts
git commit -m "feat(cortex): chat session config API accepts MCP/agentTools/sub-agents"
```

---

## Task 4: Dispose the cached agent on config-change + delete (MCP container teardown)

**Files:**
- Modify: `apps/cortex/server/services/chat-session-service.ts`
- Test: `apps/cortex/server/services/chat-session-service.test.ts`

Today `this.sessions` caches only the `AgentSession`; the underlying `agent`
(which owns MCP containers and exposes `.dispose()`) is lost. Retain it and
dispose it on evict.

- [ ] **Step 1: Write the failing lifecycle test**

Create `apps/cortex/server/services/chat-session-service.test.ts`:

```ts
import { describe, it, expect } from "bun:test";

// Minimal seam test: the cache entry must carry a disposable agent, and evicting
// (config update / delete) must call dispose(). We test the eviction helper in
// isolation to avoid spinning a real build + MCP container.
import { disposeCachedSession, type CachedChatSession } from "./chat-session-service.js";

describe("disposeCachedSession", () => {
  it("calls agent.dispose() and swallows errors", async () => {
    let disposed = 0;
    const entry: CachedChatSession = {
      session: {} as CachedChatSession["session"],
      agent: { dispose: async () => { disposed++; } },
    };
    await disposeCachedSession(entry);
    expect(disposed).toBe(1);

    const bad: CachedChatSession = {
      session: {} as CachedChatSession["session"],
      agent: { dispose: async () => { throw new Error("boom"); } },
    };
    await expect(disposeCachedSession(bad)).resolves.toBeUndefined(); // does not throw
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cortex && rtk proxy bun test server/services/chat-session-service.test.ts`
Expected: FAIL — `disposeCachedSession` / `CachedChatSession` not exported.

- [ ] **Step 3: Implement the cache type + disposer + wire eviction**

In `chat-session-service.ts`:

1. Add near the top (exported for the test):

```ts
export interface CachedChatSession {
  readonly session: AgentSession;
  readonly agent: { dispose: () => Promise<void> };
}

/** Dispose a cached chat agent (tears down MCP containers); never throws. */
export async function disposeCachedSession(entry: CachedChatSession): Promise<void> {
  try {
    await entry.agent.dispose();
  } catch {
    /* best-effort: a dispose failure must not block config update / delete */
  }
}
```

2. Change the cache field type:

```ts
  private readonly sessions = new Map<string, CachedChatSession>();
```

3. `buildSession` must return `{ session, agent }`. Change its return type to
   `Promise<CachedChatSession>` and the final statement to:

```ts
    const session = new AgentSession(
      (msg, hist, opts) => agent.chat(msg, opts, hist, sessionId),
      undefined,
      undefined,
      initialHistory.length > 0 ? initialHistory : undefined,
    );
    return { session, agent };
```

4. Everywhere the cache is read (e.g. `let agentSession = this.sessions.get(sessionId)`),
   update to use the entry: `let entry = this.sessions.get(sessionId)`; build with
   `entry = await this.buildSession(...)`; `this.sessions.set(sessionId, entry)`;
   and call chat via `entry.session.chat(...)`. (Search the file for `agentSession`
   and `this.sessions.get` / `.set` — there are ~2 call sites around L115 and L161.)

5. `updateSessionConfig` and `deleteSession`: dispose before dropping:

```ts
  // in updateSessionConfig, replacing `this.sessions.delete(sessionId)`:
  const evicted = this.sessions.get(sessionId);
  if (evicted) { await disposeCachedSession(evicted); this.sessions.delete(sessionId); }
```

```ts
  // deleteSession — make it async if it isn't, dispose then delete:
  async deleteSession(sessionId: string): Promise<boolean> {
    const evicted = this.sessions.get(sessionId);
    if (evicted) await disposeCachedSession(evicted);
    this.sessions.delete(sessionId);
    return deleteChatSession(this.db, sessionId); // keep existing db delete call
  }
```

> If `deleteSession` / `updateSessionConfig` are currently sync, making them async
> means updating their callers (the `chat.ts` route handlers) to `await`. Grep
> callers and adjust; the routes are already `async`.

- [ ] **Step 4: Run the lifecycle test + full server tests**

Run: `cd apps/cortex && rtk proxy bun test server/services/chat-session-service.test.ts server/tests --timeout 15000`
Expected: PASS, no regressions.

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/cortex && rtk proxy bun run typecheck` → PASS.
```bash
git add apps/cortex/server/services/chat-session-service.ts apps/cortex/server/services/chat-session-service.test.ts
git commit -m "fix(cortex): dispose cached chat agent on config-change/delete (MCP teardown)"
```

---

## Task 5: UI store carries the new config fields

**Files:**
- Modify: `apps/cortex/ui/src/lib/stores/chat-store.ts`

- [ ] **Step 1: Extend `ChatSessionConfigInput`**

In `chat-store.ts`, add to the `ChatSessionConfigInput` type (around L89):

```ts
  mcpServerIds?: string[];
  agentTools?: unknown[];
  dynamicSubAgents?: { enabled: boolean; maxIterations?: number };
  additionalToolNames?: string;
  terminalTools?: boolean;
  skills?: { paths: string[] };
```

- [ ] **Step 2: Ensure create/update forward them**

`createSession` / `updateSessionConfig` POST the whole `config` object to the API.
Confirm they spread the full input (they send `JSON.stringify(config)` /
`JSON.stringify({ ...opts })`). If they cherry-pick fields, add the new ones. Read
L168-195 and adjust so the new fields reach the body.

- [ ] **Step 3: Typecheck (svelte-check)**

Run: `cd apps/cortex/ui && rtk proxy bun run check 2>&1 | rtk proxy grep -i chat-store`
Expected: no new errors attributable to `chat-store.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/chat-store.ts
git commit -m "feat(cortex): chat-store config input carries MCP/agentTools/sub-agents"
```

---

## Task 6: Embed `AgentConfigPanel` in the chat session config

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/ChatSessionList.svelte`

Replace the chat-specific tool form with the shared `AgentConfigPanel` bound to a
local `agentConfig` object, so chat gets full builder parity (MCP, sub-agents,
custom tools, persona, reasoning). On change, call `updateSessionConfig` (existing
session) or include it in `createSession` (new session).

- [ ] **Step 1: Read the current config form**

Read `ChatSessionList.svelte` fully. Note the existing config state
(`enableTools`, `selectedTools`, `streamReasoningSteps`, provider/model) and where
`createSession` / `updateSessionConfig` from `chat-store` are called (the new/edit
session flow).

- [ ] **Step 2: Add an `agentConfig` state seeded from `defaultConfig()`**

In `<script>`:

```ts
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import { defaultConfig } from "$lib/types/agent-config.js";

  // Full builder config for the session being created/edited.
  let sessionAgentConfig = $state(defaultConfig());
```

When editing an existing session, seed it from the loaded session config:
`sessionAgentConfig = { ...defaultConfig(), ...loadedConfig }`.

- [ ] **Step 3: Render the panel + wire persistence**

Add to the new/edit-session config area:

```svelte
<AgentConfigPanel bind:config={sessionAgentConfig} />
```

- On **create**: pass the panel config into `createSession`:
  `chatStore.createSession({ name, ...sessionAgentConfig, enableTools })`.
- On **edit / live change**: when `sessionAgentConfig` changes for an existing
  session, call `chatStore.updateSessionConfig(sessionId, { ...sessionAgentConfig, enableTools })`
  (debounce or on a Save button — match the file's existing save UX; do NOT
  fire on every keystroke if the file currently uses an explicit save).

> Keep `enableTools` as the master tool gate (server treats tools-off as tool-less).
> The existing `enableTools` toggle stays; `AgentConfigPanel` supplies the tool
> *selection* (built-in + MCP + sub-agents + custom).

- [ ] **Step 4: Typecheck (svelte-check) — no new problems**

Run: `cd apps/cortex/ui && rtk proxy bun run check 2>&1 | rtk proxy grep -i ChatSessionList`
Expected: no new errors/warnings from `ChatSessionList.svelte`.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/components/ChatSessionList.svelte
git commit -m "feat(cortex): full AgentConfigPanel in chat session config"
```

---

## Task 7: "Start from saved agent" snapshot picker

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/ChatSessionList.svelte`

In the new-session flow, let the user pick a saved Lab agent; snapshot its config
into the session's `agentConfig` (copy, not live-link).

- [ ] **Step 1: Fetch saved agents**

In `<script>`, load saved agents (same endpoint the Lab uses):

```ts
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  type SavedAgent = { agentId: string; name: string; config: Record<string, unknown> };
  let savedAgents = $state<SavedAgent[]>([]);
  async function loadSavedAgents() {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/agents`);
    if (res.ok) savedAgents = (await res.json()) as SavedAgent[];
  }
```

Call `loadSavedAgents()` when the new-session UI opens (`$effect` or on-open handler).

- [ ] **Step 2: Add the picker + snapshot action**

In the new-session config area:

```svelte
<label>Start from saved agent</label>
<select onchange={(e) => snapshotFromAgent((e.currentTarget as HTMLSelectElement).value)}>
  <option value="">Blank (provider/model only)</option>
  {#each savedAgents as a (a.agentId)}
    <option value={a.agentId}>{a.name}</option>
  {/each}
</select>
```

```ts
  function snapshotFromAgent(agentId: string) {
    if (!agentId) return;
    const a = savedAgents.find((x) => x.agentId === agentId);
    if (!a) return;
    // Snapshot: session owns its own copy; later edits don't touch the saved agent.
    sessionAgentConfig = { ...defaultConfig(), ...(a.config as object) };
    enableTools = true; // a tooled agent implies tools on
  }
```

> The `AgentConfigPanel` from Task 6 is bound to `sessionAgentConfig`, so the
> snapshot immediately populates the full panel (model, tools, MCP, sub-agents).

- [ ] **Step 3: Typecheck (svelte-check)**

Run: `cd apps/cortex/ui && rtk proxy bun run check 2>&1 | rtk proxy grep -i ChatSessionList`
Expected: no new problems.

- [ ] **Step 4: Commit**

```bash
git add apps/cortex/ui/src/lib/components/ChatSessionList.svelte
git commit -m "feat(cortex): start a chat session from a saved agent (config snapshot)"
```

---

## Task 8: Full verification + Playwright spot-check + docs

**Files:**
- Modify: `.agents/MEMORY.md`, spec status line

- [ ] **Step 1: Full cortex test suite + typecheck**

Run:
```bash
cd apps/cortex && rtk proxy bun test server/tests --timeout 15000
cd apps/cortex/ui && rtk proxy bun test src/lib
cd apps/cortex && rtk proxy bun run typecheck
cd apps/cortex/ui && rtk proxy bun run check 2>&1 | rtk proxy grep -iE "COMPLETED"
```
Expected: server + ui tests green; typecheck clean; svelte-check totals at baseline
(20 errors all `bun:test`/vite/ws + 1 AgentCard a11y warning — none from new files).

- [ ] **Step 2: Live Playwright spot-check (restart stack first if needed)**

Ensure the dev stack is current (kill stale `bun run server/index.ts`, restart
`bun run start`). Then via Playwright MCP against `http://localhost:5173/chat`:
1. Create a chat session, open the full config panel, enable tools, select an
   already-configured **MCP server** (e.g. `context7`) + confirm the Tools section
   shows it.
2. Send a turn that needs that MCP tool; confirm the assistant turn's `toolsUsed`
   includes the MCP tool name (snapshot the chat panel — it renders `toolsUsed`).
3. New session → "Start from saved agent" → pick a tooled agent → confirm the panel
   populates with that agent's model + tools (snapshot).

Record the result (pass/fail per check) in the commit message / report.

- [ ] **Step 3: Update memory + spec status**

- In `.agents/MEMORY.md`, add a one-line entry: chat tool parity shipped (MCP +
  sub-agents + custom tools via full `AgentConfigPanel` + saved-agent snapshot;
  agent dispose on evict for MCP teardown).
- Flip the spec `Status:` line to `Shipped <date>`.
- Mirror the note into the personal memory index per the project's memory sync rule.

- [ ] **Step 4: Commit**

```bash
git add .agents/MEMORY.md wiki/Architecture/Design-Specs/2026-06-09-cortex-chat-tool-parity-design.md
git commit -m "docs(cortex): chat tool parity shipped — verification + memory"
```

---

## Self-Review notes (author)

- **Spec coverage:** piece 1 → Task 3; piece 2 → Tasks 1+2; piece 3 (lifecycle) →
  Task 4; piece 4a (panel) → Tasks 5+6; piece 4b (saved-agent) → Task 7; testing →
  per-task + Task 8. All spec sections mapped.
- **MCP idle-eviction** (spec risk) is intentionally out of scope — noted as a
  follow-up, not a task.
- **Shared-mapper vs mirror:** resolved as "mirror via the pure `chatToolParams`
  unit" (Task 1) rather than refactoring `runner-service` — smaller blast radius.

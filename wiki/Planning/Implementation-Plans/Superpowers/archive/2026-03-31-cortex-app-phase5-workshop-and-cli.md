# Cortex App — Phase 5: Workshop, Command Palette & CLI Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Phase 4 Run View must be complete.

**Goal:** Build the Workshop view (Builder/Skills/Tools tabs), the global Command Palette (Cmd+K), the `CortexRunnerService` for launching agents from the UI, and the full CLI integration (`rax cortex`, `rax run --cortex`, static asset bundling).

**Design reference:** `docs/superpowers/specs/cortex-design-export.html` — Command Palette overlay (Stage screen).
> ⚠️ The command palette in the mockup shows the visual treatment — dark panel, violet border, backdrop blur, keyboard shortcut badges. The production build must show real Cortex commands (not the sci-fi placeholder labels), correct keyboard bindings, and fuzzy search across all registered commands.

---

## File Map

```
apps/cortex/
  server/
    services/
      runner-service.ts             # CortexRunnerService — launch agents from UI
      gateway-service.ts            # CortexGatewayService — Gateway agent CRUD
    api/
      runs.ts                       # Add POST /api/runs (used by BottomInputBar)
      agents.ts                     # Add full Gateway CRUD

  ui/src/
    lib/
      stores/
        workshop-store.ts           # Builder form state
        command-palette.ts          # Global command registry + fuzzy search
      components/
        CommandPalette.svelte       # Cmd+K overlay
        BuilderForm.svelte          # Progressive disclosure agent builder
        SkillDetail.svelte          # Skill viewer with version history
        ToolDetail.svelte           # Tool viewer + isolation test
    routes/
      workshop/+page.svelte         # Workshop view with tabs

apps/cli/
  src/commands/cortex.ts            # rax cortex command
  src/commands/run.ts               # Add --cortex flag to existing run command
  src/index.ts                      # Register cortex command
```

---

## Task 1: CortexRunnerService

Allows the UI to launch agents directly from the Stage input bar or Workshop Builder.

**Files:**
- Create: `apps/cortex/server/services/runner-service.ts`

- [ ] **Step 1: Write failing test**

Create `apps/cortex/server/tests/runner-service.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { CortexRunnerService, CortexRunnerServiceLive } from "../services/runner-service.js";
import { CortexIngestService } from "../services/ingest-service.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";

describe("CortexRunnerService", () => {
  it("should return an empty active runs map initially", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const layer = CortexRunnerServiceLive.pipe(
      Layer.provide(CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive))),
    );

    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      const active = yield* svc.getActive();
      expect(active.size).toBe(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/cortex && bun test server/tests/runner-service.test.ts 2>&1 | tail -3
```
Expected: FAIL.

- [ ] **Step 3: Implement CortexRunnerService**

Create `apps/cortex/server/services/runner-service.ts`:

```typescript
// apps/cortex/server/services/runner-service.ts
import { Effect, Context, Layer, Ref } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import type { AgentConfig } from "@reactive-agents/runtime";
import type { RunId, RunContext } from "../types.js";
import { makeRunId } from "../types.js";
import { CortexError } from "../errors.js";

export interface LaunchParams {
  readonly prompt: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tools?: string[];
  readonly config?: Partial<AgentConfig>;
}

export class CortexRunnerService extends Context.Tag("CortexRunnerService")<
  CortexRunnerService,
  {
    readonly start: (params: LaunchParams) => Effect.Effect<{ runId: string; agentId: string }, CortexError>;
    readonly pause: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly stop: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly getActive: () => Effect.Effect<ReadonlyMap<string, RunContext>, never>;
  }
>() {}

export const CortexRunnerServiceLive = Layer.effect(
  CortexRunnerService,
  Effect.gen(function* () {
    const activeRef = yield* Ref.make(new Map<string, RunContext & { abort: AbortController }>());

    return {
      start: (params) =>
        Effect.gen(function* () {
          const runId = makeRunId();
          const abort = new AbortController();

          // Build a minimal agent — provider from params or default to "anthropic"
          const agent = yield* Effect.tryPromise({
            try: () =>
              ReactiveAgents.create()
                .withName(`cortex-run-${runId.slice(0, 8)}`)
                .withProvider((params.provider ?? process.env.LLM_DEFAULT_PROVIDER ?? "anthropic") as any)
                .withCortex()   // auto-wires CortexReporterLayer
                .build(),
            catch: (e) => new CortexError({ message: `Failed to build agent: ${String(e)}`, cause: e }),
          });

          const agentId = `cortex-run-${runId.slice(0, 8)}`;

          // Fire-and-forget run — result streams via CortexReporterLayer
          Effect.runFork(
            Effect.tryPromise({
              try: () => agent.run(params.prompt, { signal: abort.signal }),
              catch: () => undefined,
            }),
          );

          yield* Ref.update(activeRef, (m) => {
            const copy = new Map(m);
            copy.set(runId, {
              runId,
              agentId,
              startedAt: Date.now(),
              abortController: abort,
              abort,
            } as any);
            return copy;
          });

          return { runId, agentId };
        }),

      pause: (runId) =>
        Effect.gen(function* () {
          // Pause is best-effort — agents may not support it
          const map = yield* Ref.get(activeRef);
          const ctx = map.get(runId);
          if (!ctx) yield* Effect.fail(new CortexError({ message: `Run ${runId} not found` }));
          // Pause signal not yet implemented in framework — log intent
          yield* Effect.log(`Pause requested for run ${runId}`);
        }),

      stop: (runId) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(activeRef);
          const ctx = map.get(runId) as any;
          if (ctx?.abort) {
            yield* Effect.sync(() => ctx.abort.abort());
          }
          yield* Ref.update(activeRef, (m) => {
            const copy = new Map(m);
            copy.delete(runId);
            return copy;
          });
        }),

      getActive: () =>
        Ref.get(activeRef).pipe(Effect.map((m) => m as ReadonlyMap<string, RunContext>)),
    };
  }),
);
```

- [ ] **Step 4: Wire POST /api/runs to use CortexRunnerService**

In `apps/cortex/server/api/runs.ts`, replace the 501 placeholder with the real implementation:

```typescript
// Add CortexRunnerService import and layer param to runsRouter
export const runsRouter = (
  storeLayer: Layer.Layer<CortexStoreService>,
  runnerLayer: Layer.Layer<CortexRunnerService>,   // add this param
) =>
  new Elysia({ prefix: "/api/runs" })
    // ... existing GET routes ...
    .post("/", async ({ body, set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        return yield* runner.start({
          prompt: body.prompt,
          provider: body.provider,
          tools: body.tools,
        });
      });
      return Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
    }, {
      body: t.Object({
        prompt: t.String(),
        provider: t.Optional(t.String()),
        tools: t.Optional(t.Array(t.String())),
      }),
    })
    .post("/:runId/pause", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        yield* runner.pause(params.runId as any);
        return { ok: true };
      });
      return Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
    })
    .post("/:runId/stop", async ({ params }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        yield* runner.stop(params.runId as any);
        return { ok: true };
      });
      return Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
    });
```

- [ ] **Step 5: Update runtime.ts to include runner service**

In `apps/cortex/server/runtime.ts`, add:

```typescript
import { CortexRunnerServiceLive } from "./services/runner-service.js";

export interface CortexRuntime {
  // ... existing fields ...
  readonly runnerLayer: typeof CortexRunnerServiceLive;
}

export function createCortexRuntime(config: CortexConfig): CortexRuntime {
  // ... existing code ...
  const runnerLayer = CortexRunnerServiceLive;
  return { db, ingestLayer, bridgeLayer, storeLayer, runnerLayer };
}
```

- [ ] **Step 6: Run tests**

```bash
cd apps/cortex && bun test server/tests/
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/server/services/runner-service.ts apps/cortex/server/api/runs.ts apps/cortex/server/runtime.ts apps/cortex/server/tests/runner-service.test.ts
git commit -m "feat(cortex): CortexRunnerService + POST /api/runs — launch agents from UI"
```

---

## Task 2: Command Palette Store and Component

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/command-palette.ts`
- Create: `apps/cortex/ui/src/lib/components/CommandPalette.svelte`

- [ ] **Step 1: Create command-palette.ts**

```typescript
// apps/cortex/ui/src/lib/stores/command-palette.ts
import { writable, derived } from "svelte/store";

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly shortcut?: string;
  readonly action: () => void;
  readonly keywords?: string[];
}

const registered = writable<Command[]>([]);
const query = writable("");
const isOpen = writable(false);

const filtered = derived([registered, query], ([$commands, $query]) => {
  if (!$query.trim()) return $commands.slice(0, 8);
  const q = $query.toLowerCase();
  return $commands
    .filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.keywords?.some(k => k.toLowerCase().includes(q)),
    )
    .slice(0, 8);
});

export function createCommandPalette() {
  return {
    isOpen,
    query,
    filtered,

    open: () => { isOpen.set(true); query.set(""); },
    close: () => { isOpen.set(false); query.set(""); },
    toggle: () => isOpen.update(v => !v),

    register: (commands: Command[]) => {
      registered.update(existing => {
        const ids = new Set(commands.map(c => c.id));
        return [...existing.filter(c => !ids.has(c.id)), ...commands];
      });
      // Return unregister function
      return () => {
        registered.update(existing => existing.filter(c => !commands.some(nc => nc.id === c.id)));
      };
    },
  };
}

// Global singleton
export const commandPalette = createCommandPalette();
```

- [ ] **Step 2: Create CommandPalette.svelte**

From the mockup: center modal, backdrop blur, terminal icon, search input, command list, keyboard shortcut badges, footer legend.

```svelte
<!-- apps/cortex/ui/src/lib/components/CommandPalette.svelte -->
<script lang="ts">
  import { commandPalette } from "$lib/stores/command-palette.js";
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";

  const { isOpen, query, filtered, open, close, register } = commandPalette;

  let selectedIdx = 0;
  let inputEl: HTMLInputElement;

  // Register default commands
  const unregister = register([
    {
      id: "run-agent",
      label: "Run agent...",
      description: "Open Stage and focus the input bar",
      icon: "play_arrow",
      shortcut: "⌘R",
      keywords: ["run", "start", "create"],
      action: () => { close(); goto("/"); },
    },
    {
      id: "view-last-run",
      label: "View last run",
      description: "Navigate to the most recent execution",
      icon: "analytics",
      shortcut: "⌘L",
      keywords: ["last", "recent", "run"],
      action: async () => {
        close();
        const runs = await fetch(`${CORTEX_SERVER_URL}/api/runs?limit=1`).then(r => r.json()) as Array<{ runId: string }>;
        if (runs[0]) goto(`/run/${runs[0].runId}`);
      },
    },
    {
      id: "workshop",
      label: "Open Workshop",
      description: "Build and configure agents",
      icon: "build",
      shortcut: "⌘W",
      keywords: ["workshop", "builder", "create"],
      action: () => { close(); goto("/workshop"); },
    },
    {
      id: "connect-agent",
      label: "Connect agent",
      description: "Show .withCortex() snippet",
      icon: "link",
      keywords: ["connect", "link", "cortex"],
      action: async () => {
        close();
        await navigator.clipboard.writeText(`.withCortex() // or CORTEX_URL=${CORTEX_SERVER_URL}`);
        // Could show a toast here
      },
    },
    {
      id: "skills",
      label: "Browse skills",
      description: "View living skills in Workshop",
      icon: "psychology",
      keywords: ["skills", "knowledge"],
      action: () => { close(); goto("/workshop#skills"); },
    },
    {
      id: "tools",
      label: "Browse tools",
      description: "View tool registry in Workshop",
      icon: "construction",
      keywords: ["tools", "registry"],
      action: () => { close(); goto("/workshop#tools"); },
    },
  ]);

  onDestroy(unregister);

  // Keyboard handler
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, $filtered.length - 1); }
    if (e.key === "ArrowUp")   { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); }
    if (e.key === "Enter")     { e.preventDefault(); $filtered[selectedIdx]?.action(); }
    if (e.key === "Escape")    { close(); }
  }

  $: if ($isOpen) { selectedIdx = 0; setTimeout(() => inputEl?.focus(), 50); }

  // Global Cmd+K listener
  function handleGlobal(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); commandPalette.toggle(); }
  }
  onMount(() => {
    window.addEventListener("keydown", handleGlobal);
    return () => window.removeEventListener("keydown", handleGlobal);
  });
</script>

{#if $isOpen}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
    on:click={close}
  >
    <!-- Panel (from mockup: dark bg, violet border, neural glow) -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="w-full max-w-xl bg-surface-container rounded-lg border border-primary/50
             shadow-neural-strong overflow-hidden animate-fade-up"
      on:click|stopPropagation={() => {}}
    >
      <!-- Search input -->
      <div class="flex items-center gap-4 px-5 py-4 border-b border-outline-variant/20">
        <span class="material-symbols-outlined text-primary flex-shrink-0">terminal</span>
        <input
          bind:this={inputEl}
          bind:value={$query}
          on:keydown={handleKeydown}
          class="w-full bg-transparent border-none outline-none text-on-surface font-body placeholder:text-outline/50"
          placeholder="Search commands..."
          type="text"
        />
        <span class="px-2 py-1 rounded bg-surface-container-highest text-[10px] font-mono text-outline flex-shrink-0">
          ESC
        </span>
      </div>

      <!-- Command list -->
      <div class="p-2 max-h-72 overflow-y-auto">
        {#if $filtered.length === 0}
          <p class="text-center font-mono text-xs text-outline py-4">No commands found.</p>
        {:else}
          {#each $filtered as cmd, i}
            <button
              class="w-full flex items-center justify-between px-4 py-3 rounded transition-colors group
                     {i === selectedIdx ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-surface-container-highest'}"
              on:click={cmd.action}
              on:mouseenter={() => selectedIdx = i}
            >
              <div class="flex items-center gap-4">
                {#if cmd.icon}
                  <span class="material-symbols-outlined {i === selectedIdx ? 'text-primary' : 'text-outline group-hover:text-secondary'} transition-colors">
                    {cmd.icon}
                  </span>
                {/if}
                <div class="text-left">
                  <div class="font-body text-sm {i === selectedIdx ? 'text-on-surface font-medium' : 'text-on-surface/70 group-hover:text-on-surface'} transition-colors">
                    {cmd.label}
                  </div>
                  {#if cmd.description}
                    <div class="text-[10px] font-mono text-outline">{cmd.description}</div>
                  {/if}
                </div>
              </div>
              {#if cmd.shortcut}
                <span class="font-mono text-[10px] {i === selectedIdx ? 'text-primary bg-primary/20' : 'text-outline'} px-2 py-0.5 rounded flex-shrink-0">
                  {cmd.shortcut}
                </span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <!-- Footer legend (from mockup) -->
      <div class="px-5 py-3 bg-surface-container-lowest border-t border-outline-variant/10 flex justify-between items-center">
        <div class="flex gap-4">
          {#each [["↑↓", "Navigate"], ["↵", "Execute"], ["ESC", "Close"]] as [key, label]}
            <div class="flex items-center gap-1.5 font-mono text-[9px] text-outline">
              <span class="px-1 bg-surface-container rounded border border-outline-variant/30">{key}</span>
              {label}
            </div>
          {/each}
        </div>
        <span class="font-mono text-[9px] text-primary uppercase">Cortex v1</span>
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Mount CommandPalette in layout**

In `apps/cortex/ui/src/routes/+layout.svelte`, add before the closing `</div>`:

```svelte
<script>
  // add at top of existing script:
  import CommandPalette from "$lib/components/CommandPalette.svelte";
</script>

<!-- Before closing div in template: -->
<CommandPalette />
```

- [ ] **Step 4: Update the ⌘K button in layout to use commandPalette.open()**

In `+layout.svelte`, update the button's `on:click`:

```svelte
import { commandPalette } from "$lib/stores/command-palette.js";
// ...
<button on:click={() => commandPalette.open()} ...>
```

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/command-palette.ts apps/cortex/ui/src/lib/components/CommandPalette.svelte apps/cortex/ui/src/routes/+layout.svelte
git commit -m "feat(cortex-ui): Command Palette (Cmd+K) with fuzzy search and registered commands"
```

---

## Task 3: Workshop View

**Files:**
- Modify: `apps/cortex/ui/src/routes/workshop/+page.svelte` (replace placeholder)
- Create: `apps/cortex/ui/src/lib/components/BuilderForm.svelte`

- [ ] **Step 1: Create BuilderForm.svelte**

```svelte
<!-- apps/cortex/ui/src/lib/components/BuilderForm.svelte -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";

  const dispatch = createEventDispatcher<{ run: { prompt: string; provider: string }; save: { name: string; prompt: string; provider: string } }>();

  let provider = "anthropic";
  let model = "";
  let prompt = "";
  let agentName = "";
  let loading = false;
  let enabledCapabilities: Set<string> = new Set();

  const capabilities = [
    { id: "reasoning",       label: "Reasoning",        icon: "psychology" },
    { id: "tools",           label: "Tools",            icon: "construction" },
    { id: "guardrails",      label: "Guardrails",       icon: "security" },
    { id: "memory",          label: "Memory",           icon: "account_tree" },
    { id: "harness",         label: "Harness Controls", icon: "tune" },
    { id: "streaming",       label: "Streaming",        icon: "stream" },
    { id: "health",          label: "Health Check",     icon: "monitor_heart" },
    { id: "gateway",         label: "Gateway Schedule", icon: "schedule" },
  ];

  const providers = ["anthropic", "openai", "gemini", "ollama", "litellm"];

  function toggleCapability(id: string) {
    const next = new Set(enabledCapabilities);
    if (next.has(id)) next.delete(id); else next.add(id);
    enabledCapabilities = next;
  }

  async function handleRun() {
    if (!prompt.trim()) return;
    loading = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), provider }),
      });
      if (res.ok) {
        const { runId } = await res.json() as { runId: string };
        dispatch("run", { prompt, provider });
        import("$app/navigation").then(({ goto }) => goto(`/run/${runId}`));
      }
    } finally { loading = false; }
  }
</script>

<div class="gradient-border rounded-lg p-6 space-y-5">
  <!-- Entry point row -->
  <div class="flex items-center gap-3 text-[10px] font-mono">
    <button class="px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors">
      New Agent
    </button>
    <button class="px-3 py-1.5 border border-outline-variant/20 text-outline rounded hover:border-primary/30 hover:text-primary transition-colors">
      Load Config ▾
    </button>
    <button class="px-3 py-1.5 border border-outline-variant/20 text-outline rounded hover:border-primary/30 hover:text-primary transition-colors">
      Import JSON
    </button>
  </div>

  <!-- Provider + Model -->
  <div class="flex gap-3">
    <select
      bind:value={provider}
      class="flex-1 bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
             text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
    >
      {#each providers as p}
        <option value={p}>{p}</option>
      {/each}
    </select>
    <input
      bind:value={model}
      placeholder="Model (optional)"
      class="flex-1 bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
             text-sm font-mono text-on-surface placeholder:text-outline/40 focus:border-primary/50 focus:outline-none"
    />
  </div>

  <!-- Prompt -->
  <textarea
    bind:value={prompt}
    placeholder="Describe what you want the agent to do..."
    rows="4"
    class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-4 py-3
           text-sm font-mono text-on-surface placeholder:text-outline/40 resize-none
           focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
  ></textarea>

  <!-- Capabilities -->
  <div>
    <label class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-2">Capabilities</label>
    <div class="flex flex-wrap gap-2">
      {#each capabilities as cap}
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono border transition-all
                 {enabledCapabilities.has(cap.id)
                   ? 'bg-primary/10 border-primary/40 text-primary'
                   : 'bg-surface-container border-outline-variant/20 text-outline hover:border-primary/30 hover:text-primary'}"
          on:click={() => toggleCapability(cap.id)}
        >
          <span class="material-symbols-outlined text-xs">{cap.icon}</span>
          {cap.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Actions -->
  <div class="flex items-center justify-end gap-3 pt-2">
    <button
      class="px-4 py-2 border border-outline-variant/20 text-outline font-mono text-xs uppercase
             hover:border-primary/30 hover:text-primary transition-colors rounded"
      disabled={!prompt.trim()}
    >
      Save as Gateway Agent
    </button>
    <button
      on:click={handleRun}
      disabled={!prompt.trim() || loading}
      class="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-primary-container to-primary
             text-on-primary font-mono text-xs uppercase rounded shadow-glow-primary
             hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {#if loading}
        <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
      {:else}
        <span class="material-symbols-outlined text-sm">play_arrow</span>
      {/if}
      Run Agent
    </button>
  </div>
</div>
```

- [ ] **Step 2: Replace Workshop placeholder**

```svelte
<!-- apps/cortex/ui/src/routes/workshop/+page.svelte -->
<script lang="ts">
  import BuilderForm from "$lib/components/BuilderForm.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { onMount } from "svelte";

  let activeTab: "builder" | "skills" | "tools" = "builder";
  let skills: any[] = [];
  let tools: any[] = [];
  let selectedSkill: any = null;
  let selectedTool: any = null;

  onMount(async () => {
    [skills, tools] = await Promise.all([
      fetch(`${CORTEX_SERVER_URL}/api/skills`).then(r => r.json()).catch(() => []),
      fetch(`${CORTEX_SERVER_URL}/api/tools`).then(r => r.json()).catch(() => []),
    ]);
  });
</script>

<svelte:head>
  <title>CORTEX — Workshop</title>
</svelte:head>

<div class="h-full flex flex-col overflow-hidden p-6 gap-4">
  <!-- Tab bar -->
  <div class="flex items-center gap-1 border-b border-outline-variant/20 pb-0 flex-shrink-0">
    {#each [
      { id: "builder", label: "Builder",  icon: "build" },
      { id: "skills",  label: "Skills",   icon: "psychology" },
      { id: "tools",   label: "Tools",    icon: "construction" },
    ] as tab}
      <button
        class="flex items-center gap-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider
               transition-colors border-b-2 -mb-px
               {activeTab === tab.id
                 ? 'border-primary text-primary'
                 : 'border-transparent text-outline hover:text-primary'}"
        on:click={() => activeTab = tab.id as typeof activeTab}
      >
        <span class="material-symbols-outlined text-sm">{tab.icon}</span>
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab content -->
  <div class="flex-1 overflow-y-auto min-h-0">
    {#if activeTab === "builder"}
      <div class="max-w-2xl mx-auto">
        <BuilderForm />
      </div>

    {:else if activeTab === "skills"}
      <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 h-full">
        <!-- Skills list -->
        <div class="space-y-1 overflow-y-auto">
          {#if skills.length === 0}
            <p class="font-mono text-xs text-outline text-center mt-8">
              No skills found. Enable memory in an agent to generate skills.
            </p>
          {:else}
            {#each skills as skill}
              <button
                class="w-full text-left p-3 rounded border transition-all hover-lift
                       {selectedSkill?.id === skill.id
                         ? 'bg-primary/10 border-primary/30'
                         : 'bg-surface-container-low border-outline-variant/10 hover:border-primary/20'}"
                on:click={() => selectedSkill = skill}
              >
                <div class="font-mono text-xs text-on-surface font-medium">{skill.name ?? skill.id}</div>
                <div class="font-mono text-[10px] text-outline mt-0.5">{skill.description ?? ""}</div>
              </button>
            {/each}
          {/if}
        </div>
        <!-- Skill detail -->
        {#if selectedSkill}
          <div class="gradient-border rounded-lg p-4 overflow-y-auto">
            <h3 class="font-headline text-sm font-bold text-primary mb-3">{selectedSkill.name}</h3>
            <pre class="font-mono text-[10px] text-on-surface/70 whitespace-pre-wrap leading-relaxed">
              {selectedSkill.content ?? "No content available."}
            </pre>
          </div>
        {:else}
          <div class="flex items-center justify-center text-outline font-mono text-xs">
            Select a skill to view its content.
          </div>
        {/if}
      </div>

    {:else if activeTab === "tools"}
      <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 h-full">
        <!-- Tools list -->
        <div class="space-y-1 overflow-y-auto">
          {#if tools.length === 0}
            <p class="font-mono text-xs text-outline text-center mt-8">
              No tools registered. Add tools to an agent to see them here.
            </p>
          {:else}
            {#each tools as tool}
              <button
                class="w-full text-left p-3 rounded border transition-all hover-lift
                       {selectedTool?.name === tool.name
                         ? 'bg-primary/10 border-primary/30'
                         : 'bg-surface-container-low border-outline-variant/10 hover:border-primary/20'}"
                on:click={() => selectedTool = tool}
              >
                <div class="font-mono text-xs text-on-surface font-medium">{tool.name}</div>
                <div class="font-mono text-[10px] text-outline mt-0.5">{tool.description ?? ""}</div>
              </button>
            {/each}
          {/if}
        </div>
        <!-- Tool detail -->
        {#if selectedTool}
          <div class="gradient-border rounded-lg p-4 overflow-y-auto">
            <h3 class="font-headline text-sm font-bold text-primary mb-3">{selectedTool.name}</h3>
            <pre class="font-mono text-[10px] text-on-surface/70 whitespace-pre-wrap">
              {JSON.stringify(selectedTool.schema ?? selectedTool, null, 2)}
            </pre>
          </div>
        {:else}
          <div class="flex items-center justify-center text-outline font-mono text-xs">
            Select a tool to view its schema.
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Build verify**

```bash
cd apps/cortex/ui && bun run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cortex/ui/src/routes/workshop/ apps/cortex/ui/src/lib/components/BuilderForm.svelte
git commit -m "feat(cortex-ui): Workshop view — Builder, Skills, Tools tabs"
```

---

## Task 4: CLI Integration

**Files:**
- Create: `apps/cli/src/commands/cortex.ts`
- Modify: `apps/cli/src/commands/run.ts` (add --cortex flag)
- Modify: `apps/cli/src/index.ts` (register cortex command)

- [ ] **Step 1: Create rax cortex command**

First check what existing commands look like:

```bash
cat apps/cli/src/commands/run.ts | head -40
```

Then create `apps/cli/src/commands/cortex.ts` following the same pattern:

```typescript
// apps/cli/src/commands/cortex.ts
import { spawn } from "bun";
import { existsSync } from "node:fs";
import path from "node:path";

export interface CortexCommandOptions {
  port?: number;
  noOpen?: boolean;
  attach?: string;
}

export async function cortexCommand(options: CortexCommandOptions = {}): Promise<void> {
  const port = options.port ?? parseInt(process.env.CORTEX_PORT ?? "4321");

  // Resolve static assets path — bundled alongside the CLI
  const cliDir = path.dirname(new URL(import.meta.url).pathname);
  const staticPath = path.resolve(cliDir, "../assets/cortex");
  const hasStaticAssets = existsSync(staticPath);

  console.log(`\n◈ CORTEX`);
  console.log(`  Starting on http://localhost:${port}\n`);

  if (!hasStaticAssets) {
    console.warn(`  ⚠  UI assets not found at ${staticPath}`);
    console.warn(`  Run: cd apps/cortex/ui && bun run build first\n`);
  }

  // Start the Cortex server inline
  const serverPath = path.resolve(cliDir, "../../cortex/server/index.ts");

  const proc = spawn(
    ["bun", "run", serverPath],
    {
      env: {
        ...process.env,
        CORTEX_PORT: String(port),
        CORTEX_NO_OPEN: options.noOpen ? "1" : "0",
        CORTEX_STATIC_PATH: staticPath,
        CORTEX_ATTACH_AGENT: options.attach ?? "",
      },
      stdio: ["inherit", "inherit", "inherit"],
    }
  );

  // Keep process alive
  process.on("SIGINT", () => { proc.kill(); process.exit(0); });
  await proc.exited;
}
```

- [ ] **Step 2: Add --cortex flag to rax run**

In `apps/cli/src/commands/run.ts`, find where the agent is built and add:

```typescript
// After building the agent, before agent.run():
if (options.cortex) {
  process.env.CORTEX_URL = process.env.CORTEX_URL ?? "http://localhost:4321";
  // The agent's builder will pick up CORTEX_URL via CortexReporterLayer if .withCortex() is called.
  // For rax run, we auto-wire it:
  builder = builder.withCortex();
}
```

If the builder is not directly accessible, add this note to the command:
```typescript
if (options.cortex && !process.env.CORTEX_URL) {
  process.env.CORTEX_URL = "http://localhost:4321";
}
```

- [ ] **Step 3: Register cortex command in CLI**

In `apps/cli/src/index.ts`, find where other commands are registered and add:

```typescript
import { cortexCommand } from "./commands/cortex.js";

// In the command definitions:
.command("cortex", "Launch Cortex companion studio")
.option("--port <port>", "Port to listen on (default: 4321)")
.option("--no-open", "Don't open browser automatically")
.option("--attach <agentId>", "Attach to a specific agent on launch")
.action(async (options: any) => {
  await cortexCommand({
    port: options.port ? parseInt(options.port) : undefined,
    noOpen: options.noOpen,
    attach: options.attach,
  });
})
```

- [ ] **Step 4: Configure static asset bundling in CLI package.json**

In `apps/cli/package.json`, add a build step that copies the Cortex UI build:

```json
{
  "scripts": {
    "build": "bun run build:ui && tsup --config tsup.config.ts",
    "build:ui": "cd ../cortex/ui && bun run build && cp -r build ../../cli/assets/cortex",
    "build:cli-only": "tsup --config tsup.config.ts"
  }
}
```

Add to `apps/cli/tsup.config.ts` (or create it):

```typescript
// In tsup config, ensure assets are included:
export default {
  // ... existing config ...
  publicDir: "assets",
};
```

- [ ] **Step 5: Test the CLI command registration**

```bash
cd apps/cli && bun run build:cli-only 2>&1 | tail -5
rax help 2>&1 | grep cortex
```
Expected: `cortex` command appears in help output.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/cortex.ts apps/cli/src/commands/run.ts apps/cli/src/index.ts apps/cli/package.json
git commit -m "feat(cli): rax cortex command + --cortex flag on rax run"
```

---

## Task 5: End-to-End Smoke Test

- [ ] **Step 1: Build the UI**

```bash
cd apps/cortex/ui && bun run build
```
Expected: `build/` directory created.

- [ ] **Step 2: Start Cortex server**

```bash
cd apps/cortex && CORTEX_NO_OPEN=1 bun run server/index.ts &
CORTEX_PID=$!
```
Expected: `◈ CORTEX running at http://localhost:4321`

- [ ] **Step 3: Connect a test agent**

```bash
CORTEX_URL=http://localhost:4321 bun -e "
import { ReactiveAgents } from './packages/runtime/src/index.ts';
const agent = await ReactiveAgents.create()
  .withProvider('test')
  .withCortex()
  .build();
await agent.run('hello');
console.log('done');
" 2>&1 | tail -5
```
Expected: agent runs and "done" prints.

- [ ] **Step 4: Verify events were persisted**

```bash
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('.cortex/cortex.db');
const count = db.prepare('SELECT COUNT(*) as c FROM cortex_events').get();
console.log('Events persisted:', count.c);
"
```
Expected: count > 0.

- [ ] **Step 5: Kill the server and run full test suite**

```bash
kill $CORTEX_PID
bun test
```
Expected: all tests pass.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(cortex): Phase 5 complete — Workshop, Command Palette, CLI integration, E2E smoke test passing"
```

---

## All Phases Complete

Cortex is fully built. Summary of what shipped:

| Phase | Deliverable |
|-------|-------------|
| Prerequisites | 9 framework events + CortexReporterLayer + .withCortex() |
| Phase 1 | Bun + Elysia server, SQLite persistence, WS ingest + live, REST API |
| Phase 2 | SvelteKit scaffold, design tokens from mockup, WS client store, layout + nav |
| Phase 3 | Stage view — agent grid, sonar rings, empty state, bottom input bar |
| Phase 4 | Run view — D3 signal monitor, trace panel, vitals strip, debrief card |
| Phase 5 | Workshop, Command Palette (Cmd+K), CortexRunnerService, rax cortex CLI |

**Success criteria verification:**
- [ ] `.withCortex()` on any agent → appears in Cortex with zero other changes
- [ ] Stage screenshot shows sonar rings on running agents
- [ ] Run view shows signal monitor with real D3 data from live events
- [ ] Debrief card appears after run completes
- [ ] Command palette opens with Cmd+K and registers real Cortex commands
- [ ] `rax cortex` starts the server and opens the browser

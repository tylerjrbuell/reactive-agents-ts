# Cortex App — Phase 3: Stage View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Phase 2 UI Foundation must be complete.

**Goal:** Build the Stage view — the home screen showing all connected agents as a bento grid of cards with sonar ring animations, cognitive state color coding, the connection moment UX, and the persistent bottom input bar.

**Design reference:** `docs/superpowers/specs/cortex-design-export.html` — Stage screen (first `<!DOCTYPE html>` block).
> ⚠️ The mockup is a starting point. Exceed it: add real entropy-driven color transitions, proper idle/running/error states, smoother connection animations, and responsive layout. The mockup uses a side nav — the production build uses the top nav established in Phase 2.

**Key visual elements from mockup to implement:**
- Bento grid of agent cards (2–4 columns responsive)
- Running node: sonar ring animation (3 concentric rings), `--ring-color` CSS variable
- Ambient neural glow blobs (absolute positioned blur circles)
- Command palette overlay (shell only — commands wired in Phase 5)
- Bottom input bar as a pill with backdrop blur and violet glow
- Notification toast on agent connect (implemented in Phase 2)

---

## File Map

```
apps/cortex/ui/src/
  routes/
    +page.svelte                        # Stage view (replaces placeholder)
  lib/
    components/
      AgentCard.svelte                  # Individual agent node card
      AgentGrid.svelte                  # Bento grid layout
      BottomInputBar.svelte             # Persistent "What should your agent do?" input
      EmptyStage.svelte                 # Empty state with onboarding message
      CommandPaletteShell.svelte        # Palette overlay (commands wired in Phase 5)
    stores/
      stage-store.ts                    # Stage-specific state (first-connect auto-nav)
```

---

## Task 1: AgentCard Component

The core visual unit. Matches the mockup's bento card design with sonar rings for running agents.

**Files:**
- Create: `apps/cortex/ui/src/lib/components/AgentCard.svelte`

- [ ] **Step 1: Create AgentCard.svelte**

```svelte
<!-- apps/cortex/ui/src/lib/components/AgentCard.svelte -->
<script lang="ts">
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import { AGENT_STATE_COLORS } from "$lib/constants.js";
  import { goto } from "$app/navigation";
  import { createEventDispatcher } from "svelte";

  export let agent: AgentNode;
  const dispatch = createEventDispatcher<{ click: AgentNode }>();

  $: stateColor = AGENT_STATE_COLORS[agent.state] ?? AGENT_STATE_COLORS.idle;
  $: isRunning = agent.state === "running" || agent.state === "exploring" || agent.state === "stressed";
  $: isCompleted = agent.state === "completed";
  $: isError = agent.state === "error";
  $: isIdle = agent.state === "idle";

  function handleClick() {
    dispatch("click", agent);
    goto(`/run/${agent.runId}`);
  }

  // Icon per state
  const stateIcon: Record<string, string> = {
    running:   "science",
    exploring: "psychology",
    stressed:  "warning",
    completed: "check_circle",
    error:     "error",
    idle:      "schedule",
  };

  // Label per state
  const stateLabel: Record<string, string> = {
    running:   "RUNNING",
    exploring: "EXPLORING",
    stressed:  "STRESSED",
    completed: "SETTLED",
    error:     "HALTED",
    idle:      "IDLE",
  };

  // CSS color class per state for the status label
  const stateLabelClass: Record<string, string> = {
    running:   "text-primary",
    exploring: "text-tertiary",
    stressed:  "text-error",
    completed: "text-secondary",
    error:     "text-error",
    idle:      "text-outline",
  };
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="relative p-6 rounded-xl flex flex-col items-center justify-center min-h-[280px]
         cursor-pointer transition-all duration-300 group
         {isRunning ? 'gradient-border-glow shadow-neural' : ''}
         {isCompleted ? 'bg-surface-container-low border border-secondary/10 hover:border-secondary/30' : ''}
         {isError ? 'bg-surface-container-low border border-error/10' : ''}
         {isIdle ? 'bg-surface-container-lowest border border-outline-variant/5 opacity-60' : ''}
         {!isRunning && !isCompleted && !isError && !isIdle ? 'bg-surface-container-low border border-outline-variant/10' : ''}
         hover:scale-[1.02]"
  on:click={handleClick}
  style="--ring-color: {stateColor.ring};"
>
  <!-- Running: sonar rings (from mockup) -->
  {#if isRunning}
    <div class="relative w-24 h-24 mb-6 flex items-center justify-center">
      <div class="sonar-ring w-full h-full absolute"></div>
      <div class="sonar-ring w-full h-full absolute"></div>
      <div class="sonar-ring w-full h-full absolute"></div>
      <!-- Core node -->
      <div
        class="w-12 h-12 rounded-full flex items-center justify-center border relative z-10
               {agent.state === 'stressed' ? 'bg-error/20 border-error' : ''}
               {agent.state === 'exploring' ? 'bg-tertiary/20 border-tertiary' : ''}
               {agent.state === 'running' ? 'bg-primary/20 border-primary' : ''}"
        style="box-shadow: 0 0 20px {stateColor.glow};"
      >
        <span
          class="material-symbols-outlined
                 {agent.state === 'stressed' ? 'text-error' : ''}
                 {agent.state === 'exploring' ? 'text-tertiary' : ''}
                 {agent.state === 'running' ? 'text-primary' : ''}"
          style="font-variation-settings: 'FILL' 1;"
        >
          {stateIcon[agent.state] ?? "science"}
        </span>
      </div>
    </div>
  {:else}
    <!-- Non-running: static icon circle -->
    <div
      class="w-12 h-12 rounded-full flex items-center justify-center border mb-6
             transition-all duration-300
             {isCompleted ? 'bg-secondary/10 border-secondary/40 group-hover:shadow-glow-secondary' : ''}
             {isError ? 'bg-error/10 border-error/40' : ''}
             {isIdle ? 'bg-surface-container-highest border-outline-variant/20' : ''}"
    >
      <span
        class="material-symbols-outlined
               {isCompleted ? 'text-secondary' : ''}
               {isError ? 'text-error' : ''}
               {isIdle ? 'text-outline' : ''}"
      >
        {stateIcon[agent.state] ?? "hub"}
      </span>
    </div>
  {/if}

  <!-- Text content -->
  <div class="text-center">
    <span class="font-mono text-[10px] uppercase tracking-[0.2em] block mb-1 {stateLabelClass[agent.state] ?? 'text-outline'}">
      {stateLabel[agent.state] ?? agent.state.toUpperCase()}
    </span>
    <h3 class="font-headline text-sm font-bold {isIdle ? 'text-slate-500' : 'text-on-surface'}">
      {agent.name}
    </h3>

    <!-- Running: iteration bar visualization (from mockup) -->
    {#if isRunning && agent.maxIterations > 0}
      <div class="mt-4 flex gap-1 justify-center items-end h-5">
        {#each Array(Math.min(agent.iteration, 8)) as _, i}
          <div
            class="w-1 rounded-full transition-all"
            class:bg-primary={agent.state === 'running'}
            class:bg-tertiary={agent.state === 'exploring'}
            class:bg-error={agent.state === 'stressed'}
            style="height: {Math.random() * 60 + 40}%; opacity: {0.4 + (i / 8) * 0.6};"
          ></div>
        {/each}
      </div>
      <div class="mt-2 text-[10px] font-mono text-outline">
        iter {agent.iteration}/{agent.maxIterations}
      </div>
    {/if}

    <!-- Completed: latency info (from mockup) -->
    {#if isCompleted}
      <div class="mt-4 text-xs font-mono text-outline">
        {agent.tokensUsed.toLocaleString()} tok · ${agent.cost.toFixed(4)}
      </div>
    {/if}

    <!-- Error: error badge (from mockup) -->
    {#if isError}
      <div class="mt-4 text-[10px] font-mono px-2 py-0.5 bg-error/10 text-error rounded border border-error/20 uppercase">
        Halted
      </div>
    {/if}

    <!-- Idle: countdown (from mockup) -->
    {#if isIdle}
      <div class="mt-4 text-xs font-mono text-slate-700">
        {agent.name}
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/cortex/ui/src/lib/components/AgentCard.svelte
git commit -m "feat(cortex-ui): AgentCard — sonar rings, cognitive state, entropy-driven colors"
```

---

## Task 2: AgentGrid and EmptyStage

**Files:**
- Create: `apps/cortex/ui/src/lib/components/AgentGrid.svelte`
- Create: `apps/cortex/ui/src/lib/components/EmptyStage.svelte`

- [ ] **Step 1: Create AgentGrid.svelte**

```svelte
<!-- apps/cortex/ui/src/lib/components/AgentGrid.svelte -->
<script lang="ts">
  import AgentCard from "./AgentCard.svelte";
  import type { AgentNode } from "$lib/stores/agent-store.js";

  export let agents: AgentNode[];
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 relative z-10">
  {#each agents as agent (agent.runId)}
    <div class="animate-fade-up">
      <AgentCard {agent} />
    </div>
  {/each}
</div>
```

- [ ] **Step 2: Create EmptyStage.svelte**

```svelte
<!-- apps/cortex/ui/src/lib/components/EmptyStage.svelte -->
<script lang="ts">
  export let onFocusInput: () => void;
</script>

<div class="flex flex-col items-center justify-center h-full text-center animate-fade-up">
  <div
    class="w-16 h-16 rounded-full border border-outline-variant/20 flex items-center
           justify-center mb-8 bg-surface-container-low"
  >
    <span class="material-symbols-outlined text-2xl text-outline">hub</span>
  </div>

  <p class="font-mono text-xs text-outline uppercase tracking-widest mb-6">
    No agents connected yet.
  </p>

  <div class="space-y-3 text-center">
    <div class="px-4 py-2 bg-primary/5 border border-primary/10 rounded-lg">
      <code class="font-mono text-xs text-primary">
        rax run "your prompt" --cortex
      </code>
    </div>
    <div class="px-4 py-2 bg-surface-container-low border border-outline-variant/10 rounded-lg">
      <code class="font-mono text-xs text-on-surface/50">
        # or add .withCortex() to any agent
      </code>
    </div>
  </div>

  <button
    class="mt-8 text-xs font-mono text-secondary hover:underline transition-colors"
    on:click={onFocusInput}
  >
    Or type below ↓
  </button>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add apps/cortex/ui/src/lib/components/AgentGrid.svelte apps/cortex/ui/src/lib/components/EmptyStage.svelte
git commit -m "feat(cortex-ui): AgentGrid bento layout + EmptyStage onboarding"
```

---

## Task 3: Bottom Input Bar

**Files:**
- Create: `apps/cortex/ui/src/lib/components/BottomInputBar.svelte`

- [ ] **Step 1: Create BottomInputBar.svelte**

From the mockup: pill shape, backdrop blur, violet glow on focus, arrow button.

```svelte
<!-- apps/cortex/ui/src/lib/components/BottomInputBar.svelte -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let placeholder = "What should your agent do?";
  export let loading = false;

  let value = "";
  let inputEl: HTMLInputElement;
  const dispatch = createEventDispatcher<{ submit: string }>();

  export function focus() {
    inputEl?.focus();
  }

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    dispatch("submit", trimmed);
    value = "";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<div
  class="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-40"
>
  <div
    class="bg-surface-container-low/80 backdrop-blur-md rounded-full
           border border-primary/20 p-1.5 flex items-center
           shadow-[0_0_30px_rgba(208,188,255,0.1)]
           focus-within:shadow-[0_0_40px_rgba(208,188,255,0.2)]
           focus-within:border-primary/40
           transition-all duration-300"
  >
    <div class="flex items-center gap-3 w-full px-4">
      <span class="material-symbols-outlined text-primary text-xl flex-shrink-0">
        keyboard_command_key
      </span>
      <input
        bind:this={inputEl}
        bind:value
        type="text"
        {placeholder}
        disabled={loading}
        on:keydown={handleKeydown}
        class="w-full bg-transparent border-none outline-none
               text-on-surface font-mono text-xs uppercase tracking-widest py-3
               placeholder:text-outline/40 placeholder:normal-case placeholder:tracking-normal"
      />
    </div>

    <button
      on:click={handleSubmit}
      disabled={!value.trim() || loading}
      class="bg-primary text-on-primary h-10 w-10 rounded-full flex items-center
             justify-center hover:scale-105 active:scale-95 transition-all
             shadow-glow-primary disabled:opacity-40 disabled:cursor-not-allowed
             flex-shrink-0"
    >
      {#if loading}
        <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
      {:else}
        <span class="material-symbols-outlined font-bold">arrow_forward</span>
      {/if}
    </button>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/cortex/ui/src/lib/components/BottomInputBar.svelte
git commit -m "feat(cortex-ui): BottomInputBar — pill input with violet glow and submit handler"
```

---

## Task 4: Stage Store

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/stage-store.ts`

- [ ] **Step 1: Create stage-store.ts**

Handles the "first-connect auto-navigate" logic and run submission:

```typescript
// apps/cortex/ui/src/lib/stores/stage-store.ts
import { writable } from "svelte/store";
import { goto } from "$app/navigation";
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import type { AgentNode } from "./agent-store.js";

export interface StageState {
  readonly submitting: boolean;
  readonly lastSubmitError: string | null;
  readonly firstConnectHandled: boolean;
}

export function createStageStore() {
  const state = writable<StageState>({
    submitting: false,
    lastSubmitError: null,
    firstConnectHandled: false,
  });

  // Called by layout when AgentConnected event fires
  function handleAgentConnected(agent: AgentNode, totalAgentCount: number) {
    state.update((s) => {
      if (!s.firstConnectHandled && totalAgentCount === 1) {
        // Auto-navigate to Run view for the first connection
        goto(`/run/${agent.runId}`);
        return { ...s, firstConnectHandled: true };
      }
      return s;
    });
  }

  // Submit a prompt from the bottom input bar
  async function submitPrompt(prompt: string): Promise<void> {
    state.update((s) => ({ ...s, submitting: true, lastSubmitError: null }));
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          provider: "anthropic",  // default provider
          tools: ["web-search"],  // sensible default
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { runId, agentId } = await res.json() as { runId: string; agentId: string };
      // Navigate to Run view — the agent will connect via CortexReporterLayer
      goto(`/run/${runId}`);
    } catch (e) {
      state.update((s) => ({ ...s, lastSubmitError: String(e) }));
    } finally {
      state.update((s) => ({ ...s, submitting: false }));
    }
  }

  return {
    subscribe: state.subscribe,
    handleAgentConnected,
    submitPrompt,
  };
}
```

Also add `POST /api/runs` to the server (quick addition to `apps/cortex/server/api/runs.ts`):

```typescript
// Add to runsRouter in apps/cortex/server/api/runs.ts:
.post("/", async ({ body, set }) => {
  // Placeholder — CortexRunnerService (Phase 6) will handle this properly
  // For now return a 501 so the UI handles it gracefully
  set.status = 501;
  return { error: "Run submission requires CortexRunnerService (Phase 6)" };
}, {
  body: t.Object({
    prompt: t.String(),
    provider: t.Optional(t.String()),
    tools: t.Optional(t.Array(t.String())),
  }),
})
```

- [ ] **Step 2: Update stores/index.ts**

```typescript
export { createStageStore } from "./stage-store.js";
export type { StageState } from "./stage-store.js";
```

- [ ] **Step 3: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/stage-store.ts
git commit -m "feat(cortex-ui): stage store — first-connect auto-navigate and prompt submission"
```

---

## Task 5: Stage Page

**Files:**
- Modify: `apps/cortex/ui/src/routes/+page.svelte` (replace placeholder)

- [ ] **Step 1: Replace placeholder with full Stage view**

```svelte
<!-- apps/cortex/ui/src/routes/+page.svelte -->
<script lang="ts">
  import { getContext, onMount } from "svelte";
  import AgentGrid from "$lib/components/AgentGrid.svelte";
  import EmptyStage from "$lib/components/EmptyStage.svelte";
  import BottomInputBar from "$lib/components/BottomInputBar.svelte";
  import { createStageStore } from "$lib/stores/stage-store.js";

  const agentStore = getContext<ReturnType<typeof import("$lib/stores/agent-store.js").createAgentStore>>("agentStore");
  const stageStore = createStageStore();

  let inputBarRef: BottomInputBar;

  $: agents = $agentStore;
  $: hasAgents = agents.length > 0;
  $: submitting = $stageStore.submitting;

  function handlePromptSubmit(e: CustomEvent<string>) {
    stageStore.submitPrompt(e.detail);
  }
</script>

<svelte:head>
  <title>CORTEX — Stage</title>
</svelte:head>

<div class="relative h-full flex flex-col overflow-hidden">
  <!-- Ambient neural glow blobs (from mockup) -->
  <div class="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-primary/5 blur-[120px] rounded-full pointer-events-none"></div>
  <div class="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/5 blur-[100px] rounded-full pointer-events-none"></div>

  <!-- Stage header (from mockup) -->
  <div class="flex justify-between items-start px-8 pt-8 pb-6 relative z-10 flex-shrink-0">
    <div>
      <h1 class="font-headline text-3xl font-light tracking-tight text-on-surface">
        Cortex <span class="font-bold text-primary">Stage</span>
      </h1>
      <p class="font-mono text-[10px] text-outline uppercase tracking-widest mt-1">
        {hasAgents
          ? `${agents.length} node${agents.length !== 1 ? "s" : ""} · ${agents.filter(a => a.state === "running" || a.state === "exploring" || a.state === "stressed").length} active`
          : "Awaiting connections"}
      </p>
    </div>

    {#if hasAgents}
      <div class="flex flex-col items-end">
        <span class="font-mono text-[10px] text-outline uppercase tracking-widest">Active Nodes</span>
        <span class="font-headline text-xl text-secondary">
          {String(agents.filter(a => ["running","exploring","stressed"].includes(a.state)).length).padStart(2, "0")}
        </span>
      </div>
    {/if}
  </div>

  <!-- Main canvas area -->
  <div class="flex-1 relative overflow-y-auto px-8 pb-32 z-10">
    {#if hasAgents}
      <AgentGrid {agents} />
    {:else}
      <div class="h-full flex items-center justify-center">
        <EmptyStage onFocusInput={() => inputBarRef?.focus()} />
      </div>
    {/if}
  </div>

  <!-- Persistent bottom input bar -->
  <BottomInputBar
    bind:this={inputBarRef}
    loading={submitting}
    on:submit={handlePromptSubmit}
  />
</div>
```

- [ ] **Step 2: Verify UI builds**

```bash
cd apps/cortex/ui && bun run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Smoke test — start both server and UI dev server**

Terminal 1:
```bash
cd apps/cortex && bun run server/index.ts &
```

Terminal 2:
```bash
cd apps/cortex/ui && bun run dev
```

Open `http://localhost:5173` — should see the Stage view with empty state and input bar.

- [ ] **Step 4: Commit**

```bash
git add apps/cortex/ui/src/routes/+page.svelte apps/cortex/ui/src/lib/
git commit -m "feat(cortex-ui): Stage view complete — agent grid, sonar rings, empty state, bottom input bar"
```

---

## Phase 3 Complete

The Stage view is live. Agent nodes appear with sonar rings when running, settle to cyan on completion, show red on error. The empty state guides new users. The bottom input bar is always available.

**Next:** `2026-03-31-cortex-app-phase4-run-view.md` — Signal monitor D3 visualization, trace panel, vitals strip, reactive decisions/memory/context panels, debrief card.

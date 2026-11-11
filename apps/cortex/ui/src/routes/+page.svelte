<script lang="ts">
  /**
   * Beacon (Bench spec section 8, `beacon.html`): what your agents are doing
   * right now. Board (default) or Field, chosen by `?view=field` (wins) or the
   * stored choice; the first-run hero when Cortex has seen no agent yet. The
   * layout's `agentStore` / `stageStore` are the data (one instance per app);
   * the rules are pure in `lib/beacon-board.ts`.
   */
  import { getContext, onDestroy, onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import BeaconCanvas from "$lib/components/BeaconCanvas.svelte";
  import BottomInputBar from "$lib/components/BottomInputBar.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import BeaconBoard from "$lib/components/beacon/BeaconBoard.svelte";
  import BeaconViewSwitch from "$lib/components/beacon/BeaconViewSwitch.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import PageHeader from "$lib/components/kit/PageHeader.svelte";
  import {
    beaconStatusOf,
    beaconViewSearch,
    boardOf,
    needsYouByRun,
    readStoredBeaconView,
    resolveBeaconView,
    storeBeaconView,
    type AgentFilter,
    type BeaconView,
  } from "$lib/beacon-board.js";
  import { pendingApprovals } from "$lib/stores/approval-watcher.js";
  import { pendingInteractions } from "$lib/stores/interaction-watcher.js";
  import type { AgentNode, AgentStore } from "$lib/stores/agent-store.js";
  import type { StageStore } from "$lib/stores/stage-store.js";

  const agentStore = getContext<AgentStore>("agentStore");
  /** Explicit cast — SvelteKit `getContext` typing can widen store methods. */
  const stageStore = getContext("stageStore") as StageStore;
  const storeState = agentStore.state;

  let inputBarRef = $state<{ focus: () => void } | undefined>(undefined);
  let storedView = $state<BeaconView | undefined>(undefined);
  let filter = $state<AgentFilter>("all");
  let now = $state(Date.now());
  /** The first REST load finished: before it, an empty list is not "no agents yet". */
  let loaded = $state(false);

  const view = $derived(resolveBeaconView($page.url.searchParams.get("view"), storedView));
  const needsYou = $derived(needsYouByRun($agentStore, $pendingApprovals, $pendingInteractions));
  const board = $derived(boardOf($agentStore, needsYou, filter, now));
  const empty = $derived(loaded && $agentStore.length === 0);
  const statusOf = (a: AgentNode) => beaconStatusOf(a, needsYou.has(a.runId));

  $effect(() => {
    if (!$storeState.loading || $agentStore.length > 0) loaded = true;
  });

  // A run that was live before this page loaded: fill its entropy line and loop cap from its stored events (once per run).
  $effect(() => {
    for (const card of board.live) void agentStore.hydrateLive(card.runId);
  });

  function setView(next: BeaconView) {
    storedView = next;
    storeBeaconView(typeof localStorage === "undefined" ? null : localStorage, next);
    const search = beaconViewSearch($page.url.search, next);
    void goto(`${$page.url.pathname}${search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // R shortcut from the layout (after a tick so the bar is bound, first run included).
  async function handleFocusInput() {
    await tick();
    if (typeof inputBarRef?.focus === "function") {
      inputBarRef.focus();
      return;
    }
    document.querySelector<HTMLInputElement>("[data-cortex-beacon-prompt]")?.focus();
  }

  let clock: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    storedView = readStoredBeaconView(localStorage);
    window.addEventListener("cortex:focus-input", handleFocusInput);
    // Live cards show run time; relative times in the grid tick too.
    clock = setInterval(() => (now = Date.now()), 1_000);
  });
  onDestroy(() => {
    window.removeEventListener("cortex:focus-input", handleFocusInput);
    if (clock) clearInterval(clock);
  });

  function submit(prompt: string, cfg: Parameters<StageStore["submitPrompt"]>[1]) {
    void stageStore.submitPrompt(prompt, cfg);
  }
</script>

<svelte:head>
  <title>Beacon · Cortex</title>
</svelte:head>

<!-- Opaque canvas: the line grid shows only on the header band, the dot grid only in Field (spec 5.2). -->
<CortexDeskShell ambient class="bg-background">
  <div class="beacon" data-state={empty ? "empty" : "default"}>
    {#if empty}
      <div></div>
      <div class="hero">
        <EmptyState hero markSize={132} title="Welcome to" brandWord="Cortex">
          {#snippet body()}
            Your agents show up here while they work. Start one below, open a chat, or point an app at Cortex with
            <code class="code-accent">.withCortex()</code>.
          {/snippet}
          {#snippet actions()}
            <Button variant="primary" icon="chat" href="/chat">Open a chat</Button>
            <Button icon="lab" href="/lab">Build an agent</Button>
            <Button variant="ghost" icon="book" href="https://docs.reactiveagents.dev/features/cortex/">Connect an app</Button>
          {/snippet}
        </EmptyState>
      </div>
    {:else}
      <div class="wrap">
        <PageHeader title="Beacon" description="What your agents are doing right now.">
          {#snippet actions()}
            <BeaconViewSwitch {view} onchange={setView} />
          {/snippet}
        </PageHeader>
      </div>
      <div class="body" class:field={view === "field"}>
        <div class="wrap inner">
          {#if view === "field"}
            <BeaconCanvas agents={$agentStore} {statusOf} />
          {:else}
            <BeaconBoard {board} {filter} {now} onfilter={(f) => (filter = f)} />
          {/if}
        </div>
      </div>
    {/if}

    <BottomInputBar
      bind:this={inputBarRef}
      library={!empty}
      loading={$stageStore.submitting}
      onSubmit={submit}
    />
  </div>
</CortexDeskShell>

<style>
  .beacon {
    position: relative;
    z-index: 1;
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .wrap { width: 100%; max-width: 1280px; margin: 0 auto; box-sizing: border-box; }
  .body { min-height: 0; overflow-y: auto; }
  .inner { padding: 0 32px 32px; }
  .body.field { overflow: hidden; display: flex; }
  .body.field .inner { display: flex; padding-bottom: 8px; }
  .hero { align-self: center; overflow-y: auto; }
  .code-accent {
    font-family: var(--cortex-font-data);
    font-size: 0.92em;
    padding: 1px 5px;
    border-radius: var(--cortex-r-chip);
    color: var(--cortex-accent);
    background: var(--cortex-accent-tint);
  }
  @media (max-width: 640px) {
    .inner { padding: 0 12px 16px; }
  }
</style>

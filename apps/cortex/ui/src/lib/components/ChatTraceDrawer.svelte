<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { formatCost } from "$lib/stores/chat-cost.js";
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";
  import TracePanel from "$lib/components/TracePanel.svelte";
  import { buildRunTrees, traceUrl, type RunTraceView } from "$lib/chat-export.js";
  import { saveTextFile } from "$lib/chat-download.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";

  interface Props {
    /** The assistant turn to inspect; absent until one exists. */
    turn: ChatTurn | undefined;
    /** Needed to fetch the turn's real run trace. */
    sessionId?: string;
    onClose: () => void;
  }
  const { turn, sessionId, onClose }: Props = $props();

  type Tab = "overview" | "steps" | "trace";
  const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "steps", label: "Steps" },
    { id: "trace", label: "Run trace" },
  ];
  let tab = $state<Tab>("overview");

  // ── Width: wide enough to read tool args, user-resizable, remembered ────────
  const WIDTH_KEY = "cortex.chat.traceWidth";
  const MIN_W = 320;
  const MAX_W = 760;
  const readWidth = (): number => {
    try {
      const n = Number(localStorage.getItem(WIDTH_KEY));
      return Number.isFinite(n) && n >= MIN_W && n <= MAX_W ? n : 448;
    } catch {
      return 448;
    }
  };
  let width = $state(readWidth());
  const setWidth = (w: number) => {
    width = Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* storage unavailable: the width still applies for this visit */
    }
  };
  function startResize(e: PointerEvent) {
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(startW + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  }
  function resizeKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") setWidth(width + 24);
    else if (e.key === "ArrowRight") setWidth(width - 24);
    else return;
    e.preventDefault();
  }

  // ── Overview data ───────────────────────────────────────────────────────────
  const calls = $derived(turn?.toolCalls ?? []);
  const failed = $derived(calls.filter((c) => c.status === "failed").length);
  const toolMs = $derived(calls.reduce((sum, c) => sum + (c.durationMs ?? 0), 0));
  const ctx = $derived(turn?.context);
  const status = $derived(turn?.streaming ? "Running" : turn?.cancelled ? "Stopped" : "Done");
  const rows = $derived.by(() => {
    if (!turn) return [] as Array<{ group: string; items: Array<[string, string]> }>;
    return [
      {
        group: "Run",
        items: [
          ["Status", status],
          ["Steps", String(turn.steps ?? turn.streamProgress?.iteration ?? "–")],
          ["Tool calls", calls.length > 0 ? `${calls.length}${failed ? ` (${failed} failed)` : ""}` : "None"],
          ["Tool time", toolMs > 0 ? `${(toolMs / 1000).toFixed(1)}s` : "–"],
        ] as Array<[string, string]>,
      },
      {
        group: "Usage",
        items: [
          ["Tokens", (turn.streaming ? (turn.liveTokens ?? 0) : turn.tokensUsed).toLocaleString()],
          ["Cost", turn.streaming ? formatCost(turn.liveCost ?? 0, true) : formatCost(turn.costUsd ?? 0, turn.costKnown !== false)],
        ] as Array<[string, string]>,
      },
      {
        group: "Model",
        items: [
          ["Model", turn.model ?? "–"],
          ...(turn.provider ? ([["Provider", turn.provider]] as Array<[string, string]>) : []),
        ] as Array<[string, string]>,
      },
    ];
  });

  // ── Run trace (real framework JSONL) ────────────────────────────────────────
  type TraceState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "empty"; reason: string }
    | { kind: "error"; message: string }
    | { kind: "ready"; text: string; runs: RunTraceView[] };
  let trace = $state<TraceState>({ kind: "idle" });
  let loadedKey = "";
  let openRuns = $state<Record<string, boolean>>({});

  $effect(() => {
    if (tab !== "trace") return;
    const t = turn;
    if (!t) {
      trace = { kind: "empty", reason: "Send a message to record a run trace." };
      return;
    }
    if (t.streaming) {
      trace = { kind: "empty", reason: "The trace is written when the run finishes." };
      return;
    }
    if (!t.runId || !sessionId) {
      trace = { kind: "empty", reason: "Tracing was off for this turn, or it predates run traces." };
      return;
    }
    const key = `${sessionId}:${t.id}:${t.runId}`;
    if (key === loadedKey) return;
    loadedKey = key;
    trace = { kind: "loading" };
    const turnId = t.id;
    void fetch(traceUrl(CORTEX_SERVER_URL, sessionId, turnId))
      .then(async (res) => {
        if (loadedKey !== key) return;
        if (res.status === 404) {
          trace = { kind: "empty", reason: "No trace file was found for this turn. It may have been cleaned up." };
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const runs = buildRunTrees(text);
        trace = runs.length === 0 ? { kind: "empty", reason: "The trace file is empty." } : { kind: "ready", text, runs };
        openRuns = Object.fromEntries(runs.map((r) => [r.runId, true]));
      })
      .catch((e: unknown) => {
        if (loadedKey === key) {
          loadedKey = "";
          trace = { kind: "error", message: e instanceof Error ? e.message : String(e) };
        }
      });
  });

  async function copyJsonl() {
    if (trace.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(trace.text);
      toast.success("Trace copied", "Raw tracer JSONL");
    } catch {
      toast.error("Copy failed");
    }
  }
  function downloadJsonl() {
    if (trace.kind !== "ready" || !turn?.runId) return;
    saveTextFile(trace.text, `${turn.runId}.jsonl`, "application/x-ndjson");
    toast.success("Trace saved", "Raw tracer JSONL");
  }
  const toggleRun = (id: string) => (openRuns = { ...openRuns, [id]: !(openRuns[id] ?? false) });
</script>

{#snippet runBlock(run: RunTraceView)}
  {@const open = openRuns[run.runId] ?? false}
  <section class="rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)]/50">
    <button
      type="button"
      onclick={() => toggleRun(run.runId)}
      aria-expanded={open}
      class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[var(--cortex-text)] transition-colors hover:bg-[var(--cortex-surface-mid)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span class="material-symbols-outlined text-[16px] leading-none transition-transform motion-reduce:transition-none" style="transform: rotate({open ? '90deg' : '0deg'})">chevron_right</span>
      <span class="min-w-0 flex-1 truncate" title={run.name}>{run.depth === 0 ? "Main run" : `Sub-agent: ${run.name}`}</span>
      <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] {run.status === 'failed' ? 'bg-error/15 text-error' : run.status === 'running' ? 'bg-secondary/15 text-secondary' : 'bg-[var(--cortex-surface-mid)] text-[var(--cortex-text-muted)]'}">{run.status}</span>
      <span class="shrink-0 tabular-nums text-[11px] text-[var(--cortex-text-muted)]">{run.frames.length} {run.frames.length === 1 ? "frame" : "frames"}</span>
    </button>
    {#if open}
      <div class="space-y-2 border-t border-[color:var(--cortex-border)] p-2">
        {#if run.frames.length > 0}
          <div class="h-[26rem]">
            <TracePanel frames={run.frames} frame={run.frames.at(-1) ?? null} status={run.status === "running" ? "live" : "done"} />
          </div>
        {:else}
          <p class="m-0 px-1 py-2 text-[12px] text-[var(--cortex-text-muted)]">This run recorded no reasoning steps.</p>
        {/if}
        {#each run.children as child (child.runId)}
          <div class="ml-3 border-l border-[color:var(--cortex-border)] pl-2">
            {@render runBlock(child)}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/snippet}

<aside
  class="chat-drawer-in relative flex h-full flex-shrink-0 flex-col border-l border-[color:var(--cortex-border)] bg-surface-container-lowest/90 dark:bg-surface/90"
  style="width: min({width}px, 70vw)"
  aria-label="Turn inspector"
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize inspector"
    aria-valuenow={width}
    aria-valuemin={MIN_W}
    aria-valuemax={MAX_W}
    tabindex="0"
    onpointerdown={startResize}
    onkeydown={resizeKey}
    class="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none"
  ></div>

  <div class="flex flex-shrink-0 items-center justify-between px-4 pt-3">
    <h3 class="m-0 text-[13px] font-semibold text-[var(--cortex-text)]">Turn inspector</h3>
    <button
      type="button"
      onclick={onClose}
      aria-label="Close inspector"
      class="flex cursor-pointer items-center rounded p-1 text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span class="material-symbols-outlined text-[18px] leading-none">close</span>
    </button>
  </div>

  <div role="tablist" aria-label="Inspector sections" class="flex flex-shrink-0 gap-1 border-b border-[color:var(--cortex-border)] px-3 pt-2">
    {#each TABS as t (t.id)}
      <button
        type="button"
        role="tab"
        id="chat-trace-tab-{t.id}"
        aria-selected={tab === t.id}
        aria-controls="chat-trace-panel"
        onclick={() => (tab = t.id)}
        class="-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-2.5 py-2 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary
               {tab === t.id ? 'border-primary font-medium text-[var(--cortex-text)]' : 'border-transparent text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)]'}"
      >{t.label}</button>
    {/each}
  </div>

  <div id="chat-trace-panel" role="tabpanel" aria-labelledby="chat-trace-tab-{tab}" class="flex min-h-0 flex-1 flex-col">
    {#if !turn && tab !== "trace"}
      <p class="m-0 p-4 text-[12px] leading-relaxed text-[var(--cortex-text-muted)]">Send a message to see what the agent did: its thinking, each tool call, and how much context it used.</p>
    {:else if tab === "overview" && turn}
      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {#each rows as g (g.group)}
          <section>
            <h4 class="m-0 mb-1.5 text-[11px] font-medium text-[var(--cortex-text-muted)]">{g.group}</h4>
            <dl class="m-0 divide-y divide-[color:var(--cortex-border)] rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)]/50">
              {#each g.items as [label, value] (label)}
                <div class="flex items-baseline justify-between gap-4 px-3 py-2 text-[12px]">
                  <dt class="flex-shrink-0 text-[var(--cortex-text-muted)]">{label}</dt>
                  <dd class="m-0 min-w-0 truncate text-right tabular-nums text-[var(--cortex-text)]" title={value}>{value}</dd>
                </div>
              {/each}
            </dl>
          </section>
        {/each}
        {#if ctx}
          <section>
            <h4 class="m-0 mb-1.5 text-[11px] font-medium text-[var(--cortex-text-muted)]">Context window</h4>
            <div class="rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)]/50 px-3 py-2.5">
              <div class="mb-1.5 flex items-baseline justify-between text-[12px]">
                <span class="text-[var(--cortex-text-muted)]">Used</span>
                <span class="tabular-nums text-[var(--cortex-text)]">{Math.round(ctx.utilizationPct)}%</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-[var(--cortex-surface-mid)]" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(ctx.utilizationPct)} aria-label="Context window used">
                <div class="h-full rounded-full bg-primary" style="width: {Math.min(100, Math.max(0, ctx.utilizationPct))}%"></div>
              </div>
            </div>
          </section>
        {/if}
      </div>
    {:else if tab === "steps" && turn}
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {#key turn.id}
          <ChatTurnTimeline {turn} />
        {/key}
        {#if calls.length === 0 && !(turn.reasoningSteps?.length)}
          <p class="m-0 text-[12px] leading-relaxed text-[var(--cortex-text-muted)]">This turn was answered directly: no thinking or tool calls were recorded.</p>
        {/if}
      </div>
    {:else if tab === "trace"}
      {#if trace.kind === "ready"}
        <div class="flex flex-shrink-0 items-center gap-2 px-4 py-2.5">
          <button
            type="button"
            onclick={copyJsonl}
            class="flex cursor-pointer items-center gap-1 rounded-md border border-[color:var(--cortex-border)] bg-transparent px-2.5 py-1 text-[12px] text-[var(--cortex-text)] transition-colors hover:bg-[var(--cortex-surface-mid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          ><span class="material-symbols-outlined text-[15px] leading-none">content_copy</span>Copy JSONL</button>
          <button
            type="button"
            onclick={downloadJsonl}
            class="flex cursor-pointer items-center gap-1 rounded-md border border-[color:var(--cortex-border)] bg-transparent px-2.5 py-1 text-[12px] text-[var(--cortex-text)] transition-colors hover:bg-[var(--cortex-surface-mid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          ><span class="material-symbols-outlined text-[15px] leading-none">download</span>Download .jsonl</button>
        </div>
        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
          {#each trace.runs as run (run.runId)}
            {@render runBlock(run)}
          {/each}
        </div>
      {:else if trace.kind === "loading"}
        <p class="m-0 p-4 text-[12px] text-[var(--cortex-text-muted)]" role="status">Loading trace…</p>
      {:else if trace.kind === "error"}
        <p class="m-0 p-4 text-[12px] text-error" role="alert">Could not load the trace ({trace.message}). Reopen this tab to retry.</p>
      {:else if trace.kind === "empty"}
        <p class="m-0 p-4 text-[12px] leading-relaxed text-[var(--cortex-text-muted)]">{trace.reason}</p>
      {/if}
    {/if}
  </div>
</aside>

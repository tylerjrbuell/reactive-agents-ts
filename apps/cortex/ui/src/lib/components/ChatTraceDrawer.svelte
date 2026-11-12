<script lang="ts">
  import Tooltip from "$lib/components/Tooltip.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { onMount, untrack } from "svelte";
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import type { ChatSession } from "$lib/stores/chat-store.js";
  import type { ChatTotals } from "$lib/stores/chat-cost.js";
  import { buildSessionContext } from "$lib/chat-session-context.js";
  import { formatSessionCost as formatCost } from "$lib/stores/chat-cost.js";
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";
  import ContextSources from "$lib/components/ContextSources.svelte";
  import TracePanel from "$lib/components/TracePanel.svelte";
  import { buildRunTrees, runViewHref, traceUrl, type RunTraceView } from "$lib/chat-export.js";
  import { saveTextFile } from "$lib/chat-download.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";

  interface Props {
    /** The assistant turn to inspect; absent until one exists. */
    turn: ChatTurn | undefined;
    /** Session row used by the Context tab. */
    session?: ChatSession;
    /** Server-summed totals used by the Context tab. */
    totals?: ChatTotals;
    /** All turns, used by the Context tab and the turn selector. */
    turns?: readonly ChatTurn[];
    /** Needed to fetch the turn's real run trace. */
    sessionId?: string;
    onClose: () => void;
    /** Float over the conversation (narrow windows) instead of sharing the row. */
    overlay?: boolean;
    /** Effective width after the parent clamps for available room. */
    width: number;
    /** Reports a user-chosen width back to the parent. */
    onWidth: (w: number) => void;
    /** Initial tab to show when the drawer mounts. */
    initialTab?: "context" | "steps" | "trace";
    /** Called when the user picks a turn from the Context tab or selector. */
    onSelectTurn?: (id: number) => void;
  }
  const { turn, session, totals, turns = [], sessionId, onClose, overlay = false, width, onWidth, initialTab = "context", onSelectTurn }: Props = $props();

  type Tab = "context" | "steps" | "trace";
  const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: "context", label: "Context" },
    { id: "steps", label: "Steps" },
    { id: "trace", label: "Run trace" },
  ];
  // Initial tab only: the user's tab choice wins after the drawer opens.
  let tab = $state<Tab>(untrack(() => initialTab));

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
  let desired = $state(readWidth());
  onMount(() => onWidth(desired));
  const setWidth = (w: number) => {
    desired = Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));
    onWidth(desired);
    try {
      localStorage.setItem(WIDTH_KEY, String(desired));
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
  function onEsc(e: KeyboardEvent) {
    if (overlay && e.key === "Escape") onClose();
  }
  function resizeKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") setWidth(width + 24);
    else if (e.key === "ArrowRight") setWidth(width - 24);
    else return;
    e.preventDefault();
  }

  // ── Context tab data ───────────────────────────────────────────────────────
  const calls = $derived(turn?.toolCalls ?? []);
  const latestContextFor = (ts: readonly ChatTurn[]) => [...ts].reverse().find((t) => t.context)?.context;
  const sessionContext = $derived(buildSessionContext({ session, totals, turns, latestContext: turn?.context ?? latestContextFor(turns) }));
  const assistantTurns = $derived(turns.filter((t) => t.role === "assistant"));
  const formatTs = (ts: number) => (ts ? new Date(ts).toLocaleString() : "–");
  const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

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
  <!-- One surface per run: the trace inside is `embedded` (no card of its own). -->
  <section class="min-w-0 overflow-hidden rounded-lg border border-[color:var(--cortex-line)] bg-[var(--cortex-surface-1)]">
    <div class="flex items-center">
    <button
      type="button"
      onclick={() => toggleRun(run.runId)}
      aria-expanded={open}
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[var(--cortex-text)] transition-colors hover:bg-[var(--cortex-surface-3)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-fill"
    >
      <span class="inline-flex transition-transform motion-reduce:transition-none" style="transform: rotate({open ? '90deg' : '0deg'})"><Icon name="chevron" size="sm" /></span>
      <Tooltip text={run.name} class="min-w-0 flex-1"><span class="block truncate">{run.depth === 0 ? "Main run" : `Sub-agent: ${run.name}`}</span></Tooltip>
      <span class="shrink-0 rounded px-1.5 py-0.5 text-[11px] {run.status === 'failed' ? 'bg-[var(--cortex-bad-tint)] text-[var(--cortex-bad)]' : run.status === 'running' ? 'bg-[var(--cortex-accent-tint)] text-[var(--cortex-accent)]' : 'bg-[var(--cortex-surface-2)] text-[var(--cortex-text-2)]'}">{run.status}</span>
      <span class="shrink-0 tabular-nums text-[11px] text-[var(--cortex-text-2)]">{run.frames.length} {run.frames.length === 1 ? "frame" : "frames"}</span>
    </button>
    <!-- Chat runs are ingested under their task id, which is the tracer's run id, so the run view has them. -->
    <Tooltip text="Open this run in the run view"><a
      href={runViewHref(run.runId)}
      data-testid="chat-trace-run-link"
      aria-label={`Open ${run.depth === 0 ? "main run" : `sub-agent run ${run.name}`} in the run view`}
      class="mr-1.5 flex flex-shrink-0 items-center rounded p-1 text-[var(--cortex-text-2)] transition-colors hover:bg-[var(--cortex-surface-3)] hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-fill"
    ><Icon name="external" size="sm" /></a></Tooltip>
    </div>
    {#if open}
      <div class="border-t border-[color:var(--cortex-line)]">
        {#if run.frames.length > 0}
          <div class="h-[26rem]">
            <TracePanel bounded embedded frames={run.frames} timeline={run.timeline} frame={run.frames.at(-1) ?? null} status={run.status === "running" ? "live" : "done"} />
          </div>
        {:else}
          <p class="m-0 px-3 py-2 text-[12px] text-[var(--cortex-text-2)]">This run recorded no reasoning steps.</p>
        {/if}
        {#if run.children.length > 0}
          <div class="space-y-2 border-t border-[color:var(--cortex-line)] p-2">
            {#each run.children as child (child.runId)}
              {@render runBlock(child)}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </section>
{/snippet}

<svelte:window onkeydown={onEsc} />
<aside
  class="chat-drawer-in flex flex-shrink-0 flex-col border-l border-[color:var(--cortex-line)]
         {overlay ? 'absolute inset-y-0 right-0 z-drawer bg-[var(--cortex-surface-1)] shadow-2xl' : 'relative h-full bg-[var(--cortex-surface-1)]'}"
  style="width: {width}px"
  aria-label="Inspector"
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize inspector"
    aria-valuenow={desired}
    aria-valuemin={MIN_W}
    aria-valuemax={MAX_W}
    tabindex="0"
    onpointerdown={startResize}
    onkeydown={resizeKey}
    class="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-accent-fill/30 focus-visible:bg-accent-fill/40 focus-visible:outline-none"
  ></div>

  <div class="flex flex-shrink-0 items-center justify-between px-4 pt-3">
    <h3 class="m-0 text-[15px] font-semibold text-[var(--cortex-text)]">Inspector</h3>
    <IconButton icon="x" label="Close inspector" onclick={onClose} />
  </div>

  <div role="tablist" aria-label="Inspector sections" class="flex flex-shrink-0 gap-1 border-b border-[color:var(--cortex-line)] px-3 pt-2">
    {#each TABS as t (t.id)}
      <button
        type="button"
        role="tab"
        id="chat-trace-tab-{t.id}"
        aria-selected={tab === t.id}
        aria-controls="chat-trace-panel"
        onclick={() => (tab = t.id)}
        class="-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-2.5 py-2 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-fill
               {tab === t.id ? 'border-accent-fill font-medium text-[var(--cortex-text)]' : 'border-transparent text-[var(--cortex-text-2)] hover:text-[var(--cortex-text)]'}"
      >{t.label}</button>
    {/each}
  </div>

  <div id="chat-trace-panel" role="tabpanel" aria-labelledby="chat-trace-tab-{tab}" class="flex min-h-0 flex-1 flex-col">
    {#if (tab === "steps" || tab === "trace") && assistantTurns.length > 1}
      <div class="flex-shrink-0 border-b border-[color:var(--cortex-line)] px-4 py-2">
        <label class="text-[11px] text-[var(--cortex-text-2)]">
          Turn
          <select
            class="ml-2 rounded border border-[color:var(--cortex-line)] bg-[var(--cortex-surface-2)] px-2 py-1 text-[12px] text-[var(--cortex-text)]"
            value={turn?.id}
            onchange={(e) => {
              const id = Number((e.currentTarget as HTMLSelectElement).value);
              if (Number.isFinite(id)) onSelectTurn?.(id);
            }}
          >
            {#each assistantTurns as t (t.id)}
              <option value={t.id}>#{t.id} · {formatTs(t.ts)} · {t.tokensUsed} tok</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}
    {#if tab === "context"}
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <ContextSources skills={turn?.skills} recall={turn?.recalled ? { reported: true, items: turn.recalled } : undefined} agentId={session?.stableAgentId} runId={turn?.runId} settledKey={turn?.streaming ? "" : "done"} />
        <section>
          <h4 class="m-0 mb-1.5 text-[11px] font-medium text-[var(--cortex-text-2)]">Session</h4>
          <dl class="m-0 divide-y divide-[color:var(--cortex-line)] rounded-lg border border-[color:var(--cortex-line)] bg-[var(--cortex-surface-2)]/50">
            {#each [
              ["Session", sessionContext.sessionName],
              ["Provider", sessionContext.provider],
              ["Model", sessionContext.model],
              ["Context limit", sessionContext.contextLimit ? sessionContext.contextLimit.toLocaleString() : "–"],
              ["Usage", sessionContext.usagePct === null ? "–" : `${sessionContext.estimated ? "~" : ""}${sessionContext.usagePct}%`],
              ["Total tokens", fmtNum(sessionContext.totalTokens)],
              ["Input tokens", `${sessionContext.inputEstimated ? "~" : ""}${sessionContext.inputTokens.toLocaleString()}`],
              ["Output tokens", `${sessionContext.outputEstimated ? "~" : ""}${sessionContext.outputTokens.toLocaleString()}`],
              ["Cache read", sessionContext.cacheReadTokens ? `${sessionContext.cachePartial ? "~" : ""}${sessionContext.cacheReadTokens.toLocaleString()}` : "–"],
              ["Cache write", sessionContext.cacheWriteTokens ? `${sessionContext.cachePartial ? "~" : ""}${sessionContext.cacheWriteTokens.toLocaleString()}` : "–"],
              ["Billed tokens", sessionContext.billedTokens ? sessionContext.billedTokens.toLocaleString() : "–"],
              ["Reasoning", sessionContext.reasoningTokens ? `${sessionContext.reasoningEstimated ? "~" : ""}${sessionContext.reasoningTokens.toLocaleString()}` : "–"],
              ["Sub-agent tokens", sessionContext.subAgentCount ? `${sessionContext.subAgentTokens.toLocaleString()} (${sessionContext.subAgentCount})` : "–"],
              ["Sub-agent cost", sessionContext.subAgentCount ? formatCost(sessionContext.subAgentCostUsd, sessionContext.subAgentCostKnown) : "–"],
              ["Thinking (~)", sessionContext.thinkingTokens ? `~${sessionContext.thinkingTokens.toLocaleString()}` : "–"],
              ["Total cost", formatCost(sessionContext.costUsd, sessionContext.costKnown)],
              ["Messages", String(sessionContext.messageCount)],
              ["User messages", String(sessionContext.userCount)],
              ["Assistant messages", String(sessionContext.assistantCount)],
              ["Session created", sessionContext.createdAt ? formatTs(sessionContext.createdAt) : "–"],
              ["Last activity", sessionContext.lastActivity ? formatTs(sessionContext.lastActivity) : "–"],
            ] as [label, value] (label)}
              <div class="flex items-baseline justify-between gap-4 px-3 py-2 text-[12px]">
                <dt class="flex-shrink-0 text-[var(--cortex-text-2)]">{label}</dt>
                <dd class="m-0 min-w-0 text-right tabular-nums text-[var(--cortex-text)]"><Tooltip text={value} class="min-w-0 max-w-full"><span class="block truncate">{value}</span></Tooltip></dd>
              </div>
            {/each}
          </dl>
        </section>

        {#if sessionContext.contextLimit}
          <section>
            <h4 class="m-0 mb-1.5 text-[11px] font-medium text-[var(--cortex-text-2)]">Context window</h4>
            <div class="rounded-lg border border-[color:var(--cortex-line)] bg-[var(--cortex-surface-2)]/50 px-3 py-2.5">
              <div class="mb-1.5 flex items-baseline justify-between text-[12px]">
                <span class="text-[var(--cortex-text-2)]">Used</span>
                <span class="tabular-nums text-[var(--cortex-text)]">{sessionContext.usagePct ?? 0}%{sessionContext.estimated ? " ~" : ""}</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-[var(--cortex-surface-3)]" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={sessionContext.usagePct ?? 0} aria-label="Context window used">
                <div class="h-full rounded-full bg-accent-fill" style="width: {Math.min(100, Math.max(0, sessionContext.usagePct ?? 0))}%"></div>
              </div>
            </div>
          </section>
        {/if}

        <section>
          <h4 class="m-0 mb-1.5 text-[11px] font-medium text-[var(--cortex-text-2)]">Raw messages</h4>
          <div class="space-y-2">
            {#each sessionContext.rawMessages as m (m.id)}
              <details class="rounded-lg border border-[color:var(--cortex-line)] bg-[var(--cortex-surface-2)]/50">
                <summary class="cursor-pointer px-3 py-2 text-[12px] text-[var(--cortex-text)]">
                  <span class="font-medium">{m.role}</span> · #{m.id} · {formatTs(m.ts)}
                  {#if m.tokens} · {m.tokens} tok{/if}
                </summary>
                <div class="border-t border-[color:var(--cortex-line)] px-3 py-2">
                  <p class="m-0 mb-2 whitespace-pre-wrap break-words text-[12px] text-[var(--cortex-text-2)]">{m.content.slice(0, 400)}{m.content.length > 400 ? "…" : ""}</p>
                  {#if m.role === "assistant"}
                    <button
                      type="button"
                      onclick={() => { onSelectTurn?.(m.id); tab = "steps"; }}
                      class="rounded-md border border-[color:var(--cortex-line)] px-2 py-1 text-[11px] text-[var(--cortex-text)] hover:bg-[var(--cortex-surface-3)]"
                    >Inspect turn</button>
                  {/if}
                </div>
              </details>
            {/each}
            {#if sessionContext.rawMessages.length === 0}
              <p class="m-0 text-[12px] text-[var(--cortex-text-2)]">No messages yet.</p>
            {/if}
          </div>
        </section>
      </div>
    {:else if tab === "steps" && turn}
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {#key turn.id}
          <ChatTurnTimeline {turn} />
        {/key}
        {#if calls.length === 0 && !(turn.reasoningSteps?.length)}
          <p class="m-0 text-[12px] leading-relaxed text-[var(--cortex-text-2)]">This turn was answered directly: no thinking or tool calls were recorded.</p>
        {/if}
      </div>
    {:else if tab === "trace"}
      {#if trace.kind === "ready"}
        <div class="flex flex-shrink-0 items-center gap-2 px-4 py-2.5">
          <Button size="sm" icon="copy" onclick={copyJsonl}>Copy JSONL</Button>
          <Button size="sm" icon="download" onclick={downloadJsonl}>Download .jsonl</Button>
        </div>
        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
          {#each trace.runs as run (run.runId)}
            {@render runBlock(run)}
          {/each}
        </div>
      {:else if trace.kind === "loading"}
        <p class="m-0 p-4 text-[12px] text-[var(--cortex-text-2)]" role="status">Loading trace…</p>
      {:else if trace.kind === "error"}
        <p class="m-0 p-4 text-[12px] text-bad" role="alert">Could not load the trace ({trace.message}). Reopen this tab to retry.</p>
      {:else if trace.kind === "empty"}
        <p class="m-0 p-4 text-[12px] leading-relaxed text-[var(--cortex-text-2)]">{trace.reason}</p>
      {/if}
    {/if}
  </div>
</aside>

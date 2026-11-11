<script lang="ts">
  /**
   * The run view (Bench spec section 8, `run.html`). This component owns the
   * run's stores, replay state and actions; `components/run/` lay it out:
   * header (breadcrumb, name, status, actions), vitals, then the Answer and
   * Trace on the left and the inspector on the right (stacked under 1360px).
   * There is no Chat tab: "Continue in chat" opens or seeds a chat session
   * (`lib/run-to-chat-session.ts`). Rules are pure in `lib/run-view.ts`.
   */
  import { getContext, onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import { goto } from "$app/navigation";
  import RunHeader from "$lib/components/run/RunHeader.svelte";
  import RunVitals from "$lib/components/run/RunVitals.svelte";
  import RunReplayBar from "$lib/components/run/RunReplayBar.svelte";
  import RunInspector from "$lib/components/run/RunInspector.svelte";
  import type { RunMenuItem } from "$lib/components/run/RunMenu.svelte";
  import SkillStrip from "$lib/components/SkillStrip.svelte";
  import RunEndingBanner from "$lib/components/RunEndingBanner.svelte";
  import TracePanel from "$lib/components/TracePanel.svelte";
  import RunFinalDeliverable from "$lib/components/RunFinalDeliverable.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import { runEnding } from "$lib/turn-ending.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import { createRunStore, isRunSettled, type CortexLiveMsg, type RunState } from "$lib/stores/run-store.js";
  import { createSignalStore } from "$lib/stores/signal-store.js";
  import { createTraceStore } from "$lib/stores/trace-store.js";
  import { createTimelineStore } from "$lib/stores/timeline-store.js";
  import type { AgentStore } from "$lib/stores/agent-store.js";
  import { settings } from "$lib/stores/settings.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { countReasoningStepDisplayMessagesInRunEvents } from "@cortex/messages-extract";
  import {
    entropySeriesOf,
    loopsLabel,
    replayLoopCount,
    replaySlice,
    runHeaderStatus,
    runTaskOf,
    runTitleOf,
    type InspectorTabId,
  } from "$lib/run-view.js";
  import { runToChatSession } from "$lib/run-to-chat-session.js";
  import { loadCapabilities, strategyOptions } from "$lib/capabilities.js";

  interface Props {
    runId: string;
  }
  const { runId }: Props = $props();

  // svelte-ignore state_referenced_locally — parent uses {#key runId} to remount on change
  const runStore = createRunStore(runId);
  const agentStore = getContext<AgentStore>("agentStore");

  // ── Replay ─────────────────────────────────────────────────────────────
  // null = live; a number = the 1-based kernel loop the views below show.
  let replayLoop = $state<number | null>(null);
  let replayPlaying = $state(false);
  let replayTimer: ReturnType<typeof setInterval> | null = null;

  // What the signal / trace / timeline stores read: the run, or its replay slice.
  const activeState = writable<RunState>({ ...$runStore });
  $effect(() => {
    const run = $runStore;
    activeState.set(replayLoop === null ? run : { ...run, events: replaySlice(run.events, replayLoop) });
  });

  const signalStore = createSignalStore(activeState);
  const traceStore = createTraceStore(activeState);
  const timelineStore = createTimelineStore(activeState);

  const replayMax = $derived(replayLoopCount($runStore.events));

  function enterReplay() {
    if (replayMax > 0) replayLoop = replayMax;
  }
  function stopReplayPlay() {
    replayPlaying = false;
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
  }
  function exitReplay() {
    stopReplayPlay();
    replayLoop = null;
  }
  function startReplayPlay() {
    replayLoop = 1;
    replayPlaying = true;
    replayTimer = setInterval(() => {
      if (replayLoop !== null && replayLoop < replayMax) replayLoop++;
      else stopReplayPlay();
    }, 800);
  }

  // ── Derived run facts ──────────────────────────────────────────────────
  const finalTraceFrame = $derived($traceStore.findLast((f) => f.kind === "final") ?? null);
  const finalDeliverableText = $derived.by(() => {
    const fromTrace = finalTraceFrame?.thought?.trim() ?? "";
    if (fromTrace) return fromTrace;
    for (let i = $runStore.events.length - 1; i >= 0; i--) {
      const e = $runStore.events[i];
      if (e?.type === "FinalAnswerProduced" && typeof e.payload.answer === "string" && e.payload.answer.trim()) return e.payload.answer.trim();
    }
    return "";
  });
  /** How the run ended when it did not succeed (failed, partial, abstained), from `AgentCompleted`. */
  const ending = $derived(runEnding($runStore.events));
  const failureMessage = $derived.by(() => {
    if ($runStore.status !== "failed") return "";
    const ev = $runStore.events.find((e) => e.type === "TaskFailed" || (e.type === "AgentCompleted" && e.payload.success === false));
    if (ev && typeof ev.payload.error === "string") return ev.payload.error;
    if (ev && typeof ev.payload.reason === "string") return ev.payload.reason;
    return $runStore.errorMessage ?? "";
  });
  const finalMeta = $derived(
    finalTraceFrame
      ? { model: finalTraceFrame.model, tokensUsed: finalTraceFrame.tokensUsed, estimatedCost: finalTraceFrame.estimatedCost, durationMs: finalTraceFrame.durationMs }
      : undefined,
  );
  const task = $derived(runTaskOf($runStore.events) ?? (typeof $runStore.launchParams?.prompt === "string" ? $runStore.launchParams.prompt : undefined));
  let renamedTo = $state<string | null>(null);
  const title = $derived(
    runTitleOf({ displayName: renamedTo ?? $runStore.displayName, chatSessionName: $runStore.chatSessionName, task, runId }),
  );
  const headerView = $derived(runHeaderStatus($runStore.status, ending?.ending));
  const entropy = $derived(entropySeriesOf($signalStore.entropy));
  const messageCount = $derived(countReasoningStepDisplayMessagesInRunEvents($runStore.events));
  const panelEvents = $derived($runStore.events.map((m: CortexLiveMsg) => ({ type: m.type, payload: m.payload, ts: m.ts })));
  // Strategy display names from the framework manifest (`reactive` reads `ReAct`).
  let strategyLabels = $state<ReadonlyMap<string, string>>(new Map());
  const strategyLabel = (id: string): string => strategyLabels.get(id) ?? id;
  loadCapabilities()
    .then((m) => (strategyLabels = new Map(strategyOptions(m).map((o) => [o.value, o.label]))))
    .catch(() => {
      /* ids stay as reported */
    });

  let selectedIteration = $state<number | null>(null);
  const selectedFrame = $derived(
    selectedIteration === null ? ($traceStore[$traceStore.length - 1] ?? null) : ($traceStore.find((f) => f.iteration === selectedIteration) ?? null),
  );
  let tab = $state<InspectorTabId>("summary");

  // ── Actions ────────────────────────────────────────────────────────────
  let openingChat = $state(false);
  async function continueInChat() {
    if (openingChat) return;
    const s = settings.get();
    const plan = runToChatSession(
      {
        runId,
        title,
        ...(task ? { task } : {}),
        answer: finalDeliverableText,
        ...($runStore.vitals.provider ? { provider: $runStore.vitals.provider } : {}),
        ...($runStore.vitals.model ? { model: $runStore.vitals.model } : {}),
        launchParams: $runStore.launchParams,
        ...($runStore.chatSessionId ? { chatSessionId: $runStore.chatSessionId } : {}),
      },
      { provider: s.defaultProvider, model: s.defaultModel },
    );
    if (plan.kind === "open") {
      await goto(`/chat?session=${encodeURIComponent(plan.sessionId)}`);
      return;
    }
    openingChat = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan.body),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const { sessionId } = (await res.json()) as { sessionId: string };
      if (!plan.configRecorded) toast.info("Opened with chat defaults", "This run did not record its settings, so the chat uses the run's model and your defaults.");
      await goto(`/chat?session=${encodeURIComponent(sessionId)}`);
    } catch (e) {
      toast.error("Could not open a chat", e instanceof Error ? e.message : String(e));
    } finally {
      openingChat = false;
    }
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportJSON() {
    try {
      const [runRes, eventsRes] = await Promise.all([
        fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}`),
        fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/events`),
      ]);
      download(new Blob([JSON.stringify({ run: await runRes.json(), events: await eventsRes.json() }, null, 2)], { type: "application/json" }), `cortex-run-${runId.slice(0, 8)}.json`);
      toast.success("Run exported", "Saved as JSON");
    } catch {
      toast.error("Export failed");
    }
  }

  /** Raw JSONL trace (tracer file, else the persisted event log), for troubleshooting. */
  async function fetchRawTrace(): Promise<{ text: string; source: string } | null> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/trace`);
    if (!res.ok) return null;
    return { text: await res.text(), source: res.headers.get("x-trace-source") ?? "tracer" };
  }
  const traceSourceNote = (source: string) => (source === "tracer" ? "Raw tracer JSONL" : "Event log (no tracer file for this run)");

  async function downloadTrace() {
    try {
      const trace = await fetchRawTrace();
      if (!trace) return toast.error("No trace available", "This run has no trace file or events");
      download(new Blob([trace.text], { type: "application/x-ndjson" }), `${runId}.jsonl`);
      toast.success("Trace saved", traceSourceNote(trace.source));
    } catch {
      toast.error("Trace download failed");
    }
  }

  async function copyTrace() {
    try {
      const trace = await fetchRawTrace();
      if (!trace) return toast.error("No trace available", "This run has no trace file or events");
      await navigator.clipboard.writeText(trace.text);
      toast.success("Trace copied", traceSourceNote(trace.source));
    } catch {
      toast.error("Copy failed");
    }
  }

  async function copyMarkdown() {
    if (finalDeliverableText) {
      await navigator.clipboard.writeText(finalDeliverableText);
      toast.success("Copied", "Final answer copied to clipboard");
      return;
    }
    const md = ($runStore.debrief as { markdown?: string } | null)?.markdown;
    if (typeof md === "string" && md) {
      await navigator.clipboard.writeText(md);
      toast.success("Copied debrief markdown");
      return;
    }
    const lines = [`# ${title}`, `Status: ${headerView.label}`, `Tokens: ${$runStore.vitals.tokensUsed.toLocaleString()}`, `Model: ${$runStore.vitals.provider ?? "unknown"} / ${$runStore.vitals.model ?? "unknown"}`, ""];
    for (const f of $traceStore) lines.push(`## Loop ${f.iteration}`, f.thought, "");
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Copied run as markdown");
  }

  /** Terminate is irreversible: in-flight work is aborted, so ask first. */
  async function confirmTerminate() {
    const ok = await confirmAction({ title: "Terminate run?", message: "In-flight work is aborted immediately.", confirmLabel: "Terminate" });
    if (ok) void runStore.terminate();
  }

  let showDeleteConfirm = $state(false);
  let deletingRun = $state(false);
  async function confirmDeleteRun() {
    showDeleteConfirm = false;
    deletingRun = true;
    try {
      if (await runStore.deleteRun()) {
        await agentStore.refresh();
        await goto("/runs");
      }
    } finally {
      deletingRun = false;
    }
  }

  let rerunning = $state(false);
  async function doRerun() {
    if (rerunning) return;
    rerunning = true;
    try {
      const newRunId = await runStore.rerun();
      if (newRunId) await goto(`/run/${newRunId}`);
      else toast.error("Rerun failed", "No stored config for this run.");
    } finally {
      rerunning = false;
    }
  }

  let renaming = $state(false);
  async function rename(label: string) {
    renaming = false;
    const next = label.trim();
    if (!next || next === title) return;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("Rename failed", body.error ?? `Server returned ${res.status}`);
        return;
      }
      renamedTo = next;
      toast.success("Run renamed", next);
    } catch (e) {
      toast.error("Rename failed", String(e));
    }
  }

  const exportItems = $derived<readonly RunMenuItem[]>([
    { label: "Run and events (JSON)", icon: "download", onSelect: exportJSON },
    { label: "Raw trace (JSONL)", icon: "download", onSelect: downloadTrace },
    { label: "Copy raw trace", icon: "copy", onSelect: copyTrace },
    { label: "Copy answer as Markdown", icon: "copy", onSelect: copyMarkdown },
  ]);

  const moreItems = $derived<readonly RunMenuItem[]>([
    ...(isRunSettled($runStore.status) && replayMax > 0 ? [{ label: `Replay (${loopsLabel(replayMax)})`, icon: "replay" as const, onSelect: enterReplay }] : []),
    ...($runStore.launchParams ? [{ label: rerunning ? "Rerunning…" : "Rerun as is", icon: "retry" as const, disabled: rerunning, onSelect: doRerun }] : []),
    { label: "Rename", icon: "edit", onSelect: () => (renaming = true) },
    { label: "Copy run id", icon: "copy", onSelect: async () => { await navigator.clipboard.writeText(runId); toast.success("Run id copied", runId); } },
    { label: deletingRun ? "Deleting…" : "Delete run", icon: "trash", danger: true, disabled: deletingRun, onSelect: () => (showDeleteConfirm = true) },
  ]);

  onDestroy(() => {
    stopReplayPlay();
    runStore.destroy();
  });
</script>

<svelte:head>
  <title>{title} · Cortex</title>
</svelte:head>

<div class="run">
  <RunHeader
    {runId}
    {title}
    status={$runStore.status}
    view={headerView}
    tolerated={$runStore.status === "completed" && $runStore.vitals.toleratedBy
      ? `The kernel ended partial and the runtime shipped success (${$runStore.vitals.toleratedBy})${$runStore.vitals.statusReason ? `: ${$runStore.vitals.statusReason}` : ""}`
      : undefined}
    chatSessionId={$runStore.chatSessionId}
    chatSessionName={$runStore.chatSessionName}
    canRerun={$runStore.launchParams !== null}
    busy={{ chat: openingChat, rerun: rerunning, delete: deletingRun }}
    {exportItems}
    {moreItems}
    {renaming}
    onRename={(label) => void rename(label)}
    onCancelRename={() => (renaming = false)}
    onContinueInChat={() => void continueInChat()}
    onEditAndRerun={() => void goto(`/lab?fromRun=${encodeURIComponent(runId)}`)}
    onPause={() => void runStore.pause()}
    onResume={() => void runStore.resume()}
    onStop={() => void runStore.stop()}
    onTerminate={() => void confirmTerminate()}
  />

  <RunVitals vitals={$runStore.vitals} status={$runStore.status} {entropy} {replayLoop} {replayMax} {strategyLabel} />
  {#if replayLoop !== null}
    <RunReplayBar
      loop={replayLoop}
      max={replayMax}
      playing={replayPlaying}
      onBack={() => { if (replayLoop !== null && replayLoop > 1) replayLoop--; }}
      onForward={() => { if (replayLoop !== null && replayLoop < replayMax) replayLoop++; }}
      onPlay={startReplayPlay}
      onPause={stopReplayPlay}
      onExit={exitReplay}
    />
  {/if}
  <SkillStrip events={$runStore.events} />

  <div class="body">
    <div class="left">
      {#if $runStore.status === "failed"}
        <RunEndingBanner {ending} cause={failureMessage} />
      {/if}
      <RunFinalDeliverable
        status={$runStore.status}
        deliverableText={finalDeliverableText}
        streamText={$runStore.streamText}
        failureMessage=""
        abstained={ending?.ending === "abstained"}
        meta={finalMeta}
        structuredObject={$runStore.structuredObject}
        structuredError={$runStore.structuredError}
      />
      <!-- The Answer panel above shows the final answer, so the trace does not open it again. -->
      <TracePanel autoOpenFinal={false} frames={$traceStore} timeline={$timelineStore} status={$runStore.status} streamText={$runStore.streamText} frame={selectedFrame} />
    </div>
    <RunInspector
      bind:tab
      {runId}
      agentId={$runStore.agentId}
      status={$runStore.status}
      vitals={$runStore.vitals}
      signal={$signalStore}
      {entropy}
      debrief={$runStore.debrief}
      launchParams={$runStore.launchParams}
      events={panelEvents}
      {messageCount}
      {strategyLabel}
      onSelectIteration={(n) => {
        selectedIteration = n;
        signalStore.selectIteration(n);
      }}
    />
  </div>
</div>

{#if showDeleteConfirm}
  <ConfirmModal
    title="Delete run"
    message="Delete {title}? This permanently removes the run and all its events from Cortex."
    confirmLabel="Delete"
    onConfirm={confirmDeleteRun}
    onCancel={() => (showDeleteConfirm = false)}
  />
{/if}

<style>
  .run { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; background: var(--cortex-canvas); }
  .body { display: grid; grid-template-columns: minmax(0, 1fr) 420px; flex: 1; min-height: 0; }
  .left { display: grid; grid-auto-rows: max-content; gap: 20px; align-content: start; min-height: 0; overflow-y: auto; padding: 20px 24px 40px; }
  .body > :global(.insp) { border-left: 1px solid var(--cortex-line); }
  /* Below 1360px the inspector stacks under the trace in one scroll. */
  @media (max-width: 1359px) {
    /* max-content rows: in a height-bounded grid, auto rows would shrink to fit and overlap. */
    .body { grid-template-columns: minmax(0, 1fr); grid-auto-rows: max-content; overflow-y: auto; align-content: start; }
    .left { overflow: visible; padding-bottom: 20px; }
    .body > :global(.insp) { border-left: 0; border-top: 1px solid var(--cortex-line); }
    /* Stacked, the inspector spans the page: cap its content to a readable width so label and value stay together. */
    .body > :global(.insp .content) { overflow: visible; max-width: 720px; }
  }
</style>

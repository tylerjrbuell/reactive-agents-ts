<script lang="ts">
  import type { ChatToolCall, ChatTurn } from "$lib/stores/chat-store.js";
  import { turnSteps, turnSummary, turnTranscript } from "$lib/stores/chat-timeline.js";
  import { groupToolNames } from "$lib/tool-groups.js";
  import { toolBadgesOf, type TranscriptTools } from "@reactive-agents/ui-core";
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";
  import ChatSubAgentCards from "$lib/components/ChatSubAgentCards.svelte";
  import ChatPlanCard from "$lib/components/ChatPlanCard.svelte";
  import ChatRunEndingNote from "$lib/components/ChatRunEndingNote.svelte";
  import ChatStructuredOutput from "$lib/components/ChatStructuredOutput.svelte";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";

  interface Props {
    turn: ChatTurn;
    /** Hide the goal-checks card (the user hid the plan). */
    planHidden?: boolean;
    /** Copy button on the answer; off when the host's action row already copies the turn. */
    answerCopy?: boolean;
  }
  const { turn, planHidden = false, answerCopy = true }: Props = $props();

  // The turn read as the agent talking (ui-core `buildTurnTranscript`): prose between
  // iterations, tool work between prose collapsed to one row each, then the answer.
  // Thinking, step detail and failure reasons live inside the groups.
  const steps = $derived(turnSteps(turn));
  const segments = $derived(turnTranscript(turn, steps));
  const body = $derived(segments.filter((s) => s.kind === "prose" || s.kind === "tools"));
  const answer = $derived(segments.find((s) => s.kind === "answer"));
  // How the run ended when it did not simply answer (failed, partial, abstained, files only).
  const ending = $derived(segments.find((s) => s.kind === "ending"));
  const summary = $derived(turnSummary(turn, steps));
  const hasToolGroups = $derived(body.some((s) => s.kind === "tools"));
  const lastIsRunningGroup = $derived.by(() => {
    const last = body.at(-1);
    return last?.kind === "tools" && last.running;
  });

  // Groups start collapsed; a click pins the viewer's choice.
  let open = $state<Record<string, boolean>>({});
  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

  /** What the agent is doing when no tool runs and no text streams yet. */
  const idleStatus = $derived(
    turn.streamProgress && turn.streamProgress.maxIterations > 0
      ? `Working, step ${turn.streamProgress.iteration} of ${turn.streamProgress.maxIterations}`
      : "Thinking",
  );
  const showIdle = $derived(turn.streaming === true && answer === undefined && !lastIsRunningGroup);
</script>

{#snippet toolGroup(g: TranscriptTools<ChatToolCall>)}
  {@const isOpen = open[g.key] ?? false}
  {@const b = toolBadgesOf(g.steps)}
  <div class="my-1.5" data-testid="tool-group">
    <button
      type="button"
      onclick={() => (open = { ...open, [g.key]: !isOpen })}
      class="group/tg flex w-full max-w-full cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-left font-mono text-[10px] text-[var(--cortex-text-muted)] transition-colors hover:text-[var(--cortex-text)]"
      aria-expanded={isOpen}
    >
      <span
        class="material-symbols-outlined text-[12px] leading-none {g.running
          ? 'animate-spin text-secondary'
          : b.unfixed > 0
            ? 'text-error'
            : ''}"
        aria-hidden="true">{g.running ? "progress_activity" : b.unfixed > 0 ? "error" : "build"}</span
      >
      <span class="shrink-0 text-[var(--cortex-text)]">{g.running ? "Running" : `Ran ${g.calls.length}`}</span>
      <!-- One badge per tool (ui-core toolBadgesOf): failures colour their tool, fixed ones read fixed. -->
      <span class="tool-badges flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-label={b.badges.map((x) => x.label).join(", ")}>
        {#each b.badges as badge (badge.name)}
          <span class="tool-badge" data-tone={badge.tone} title={badge.label} data-testid="tool-badge">
            {#if badge.tone === "failed"}<span class="material-symbols-outlined" aria-hidden="true">close</span>{:else if badge.tone === "fixed"}<span class="material-symbols-outlined" aria-hidden="true">check</span>{/if}{badge.name}{#if badge.count > 1}<span class="opacity-70">×{badge.count}</span>{/if}
          </span>
        {/each}
        {#if b.overflow > 0}<span class="tool-badge" title={b.overflowNames.join(", ")}>+{b.overflow}</span>{/if}
        {#if b.unfixed > 0}<span class="shrink-0 text-error">{b.unfixed} failed</span>{/if}
      </span>
      {#if !g.running && g.durationMs !== undefined}
        <span class="shrink-0 tabular-nums">{fmtMs(g.durationMs)}</span>
      {/if}
      <span
        class="material-symbols-outlined text-[12px] leading-none transition-transform duration-150"
        style="transform: rotate({isOpen ? '90deg' : '0deg'})"
        aria-hidden="true">chevron_right</span
      >
    </button>
    {#if isOpen}
      <div class="mt-1 pl-4">
        <ChatTurnTimeline {turn} only={g.steps} />
      </div>
    {/if}
  </div>
{/snippet}

<div data-testid="chat-transcript">
  {#each body as seg (seg.key)}
    {#if seg.kind === "prose"}
      <div class="my-1" data-testid="transcript-prose"><GuardedMarkdown markdown={seg.text} showCopy={false} class="text-[11px]" /></div>
    {:else if seg.kind === "tools"}
      {@render toolGroup(seg)}
    {/if}
  {/each}

  {#if !hasToolGroups && !turn.streaming && turn.toolsUsed && turn.toolsUsed.length > 0}
    <!-- History loaded from the server keeps only tool names, not per-call detail. -->
    <div class="my-1.5 flex flex-wrap gap-1 font-mono text-[9px]">
      {#each groupToolNames(turn.toolsUsed) as tool (tool.name)}
        <span class="rounded bg-[var(--cortex-surface-mid)] px-1.5 py-0.5 text-[var(--cortex-text)]">{tool.name}{tool.count > 1 ? ` ×${tool.count}` : ""}</span>
      {/each}
    </div>
  {/if}

  {#if (turn.subAgents?.length ?? 0) > 0}
    <ChatSubAgentCards agents={turn.subAgents ?? []} checklist={turn.checklist} />
  {/if}

  {#if showIdle}
    <p class="my-1 font-mono text-[11px] italic text-[var(--cortex-text-muted)]">
      {idleStatus}<span class="chat-dots ml-1 inline-flex items-center gap-0.5 align-middle" aria-hidden="true"><i></i><i></i><i></i></span>
    </p>
  {/if}

  {#if answer !== undefined}
    {#if answer.final === false}
      <!-- Text in flight may still turn out to be narration before a tool call: muted, unrendered. -->
      <p class="m-0 mt-1 whitespace-pre-wrap text-[11px] italic leading-relaxed text-[var(--cortex-text-muted)]">{answer.text}<span class="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-secondary/60 align-middle"></span></p>
    {:else if turn.streaming}
      <p class="m-0 mt-1 whitespace-pre-wrap text-[11px] leading-relaxed">{answer.text}<span class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-secondary/80 align-middle"></span></p>
    {:else}
      <div class="mt-1" data-testid="transcript-answer">
        <GuardedMarkdown markdown={answer.text} showCopy={answerCopy} class="text-[11px]" />
      </div>
    {/if}
  {/if}
  {#if ending && !turn.streaming}<ChatRunEndingNote outcome={ending.outcome} />{/if}
  <ChatStructuredOutput value={turn.liveObject} />

  <!-- Quiet footer: goal checks (open while a plan runs or a check fails), then the turn's rollup. -->
  {#if turn.checklist && !planHidden}
    <div class="mt-2"><ChatPlanCard checklist={turn.checklist} exitGate={turn.exitGate} turnComplete={!turn.streaming} /></div>
  {/if}
  {#if steps.length > 0 && !turn.streaming}
    <p data-testid="turn-summary" class="m-0 mt-1.5 font-mono text-[9px] tabular-nums text-[var(--cortex-text-muted)]">{summary.line}</p>
  {/if}
</div>

<style>
  .tool-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    max-width: 14rem;
    padding: 0 0.3125rem;
    border: 1px solid var(--cortex-border);
    border-radius: 4px;
    background: var(--cortex-surface-mid);
    color: var(--cortex-text);
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tool-badge .material-symbols-outlined { font-size: 10px; line-height: 1; }
  .tool-badge[data-tone="failed"] {
    border-color: color-mix(in srgb, var(--color-error, #ff6b6b) 55%, transparent);
    background: color-mix(in srgb, var(--color-error, #ff6b6b) 14%, transparent);
    color: var(--color-error, #ff6b6b);
  }
  .tool-badge[data-tone="fixed"] .material-symbols-outlined { color: var(--color-secondary, #7ee3c3); }
  .tool-badge[data-tone="running"] { border-color: color-mix(in srgb, var(--color-secondary, #7ee3c3) 55%, transparent); }
</style>

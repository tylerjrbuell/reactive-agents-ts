<script lang="ts">
  import type { ChatToolCall, ChatTurn } from "$lib/stores/chat-store.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { previewArgs, turnSteps, turnSummary, turnTranscript } from "$lib/stores/chat-timeline.js";
  import ChatLiveApproval from "$lib/components/ChatLiveApproval.svelte";
  import { groupToolNames } from "$lib/tool-groups.js";
  import { toolBadgesOf, type TranscriptTools } from "@reactive-agents/ui-core";
  import ChatModelWait from "$lib/components/ChatModelWait.svelte";
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";
  import ChatSubAgentCards from "$lib/components/ChatSubAgentCards.svelte";
  import ChatPlanCard from "$lib/components/ChatPlanCard.svelte";
  import ChatRunEndingNote from "$lib/components/ChatRunEndingNote.svelte";
  import ChatRunFailedNote from "$lib/components/ChatRunFailedNote.svelte";
  import { abstentionInAnswer, bareEnding } from "$lib/turn-ending.js";
  import ChatStructuredOutput from "$lib/components/ChatStructuredOutput.svelte";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Status from "$lib/components/kit/Status.svelte";

  interface Props {
    turn: ChatTurn;
    /** Hide the goal-checks card (the user hid the plan). */
    planHidden?: boolean;
    /** Copy button on the answer; off when the host's action row already copies the turn. */
    answerCopy?: boolean;
    /** Retry from the ending note of a turn that did not finish (the latest turn only). */
    onRetry?: () => void;
  }
  const { turn, planHidden = false, answerCopy = true, onRetry }: Props = $props();

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

  /** Where the agent is when no tool runs and no text streams yet. */
  const stepLine = $derived(
    turn.streamProgress && turn.streamProgress.maxIterations > 0
      ? `step ${turn.streamProgress.iteration} of ${turn.streamProgress.maxIterations}`
      : undefined,
  );
  // A run waiting on the user's approval is not thinking: the approval card says what it waits for.
  const waitingOnYou = $derived(turn.streaming === true && turn.liveApproval !== undefined);
  const showIdle = $derived(turn.streaming === true && answer === undefined && !lastIsRunningGroup && !waitingOnYou);
</script>

{#snippet toolGroup(g: TranscriptTools<ChatToolCall>)}
  {@const isOpen = open[g.key] ?? false}
  {@const b = toolBadgesOf(g.steps)}
  <!-- What the running call was called with, before it completes. -->
  {@const runningArgs = g.running ? previewArgs(g.calls.findLast((c) => c.status === "running")?.args) : ""}
  <div class="tool-group" data-testid="tool-group">
    <!-- One quiet row (spec section 8); expands into the step rows. -->
    <button
      type="button"
      class="toolrow"
      onclick={() => (open = { ...open, [g.key]: !isOpen })}
      aria-expanded={isOpen}
      aria-label="{g.running ? 'Running tools' : `${g.calls.length} tool call${g.calls.length === 1 ? '' : 's'}`}{b.unfixed > 0 ? `, ${b.unfixed} failed` : ''}. {isOpen ? 'Hide' : 'Show'} steps"
    >
      {#if g.running}
        <Status tone="running" label="Running" dotOnly />
      {:else if b.unfixed > 0}
        <span class="bad"><Icon name="alert" size="sm" /></span>
      {:else}
        <Icon name="tool" size="sm" />
      {/if}
      <span class="lead">{g.running ? "Running" : `Ran ${g.calls.length}`}</span>
      <!-- One badge per tool (ui-core toolBadgesOf): failures colour their tool, fixed ones read fixed. -->
      {#each b.badges as badge (badge.name)}
        <span class="t" data-tone={badge.tone} use:tooltip={badge.label} data-testid="tool-badge">
          {#if badge.tone === "failed"}<Icon name="x" size="sm" />{:else if badge.tone === "fixed"}<Icon name="check" size="sm" />{/if}{badge.name}{#if badge.count > 1}&nbsp;×{badge.count}{/if}
        </span>
      {/each}
      {#if b.overflow > 0}<span class="t" use:tooltip={b.overflowNames.join(", ")}>+{b.overflow}</span>{/if}
      {#if runningArgs !== ""}<span class="args" data-testid="running-tool-args">{runningArgs}</span>{/if}
      {#if b.unfixed > 0}<span class="bad">{b.unfixed} failed</span>{/if}
      {#if !g.running && g.durationMs !== undefined}<span class="dur">{fmtMs(g.durationMs)}</span>{/if}
      <span class="chev" class:open={isOpen}><Icon name="chevron" size="sm" /></span>
    </button>
    {#if isOpen}
      <div class="tool-steps">
        <ChatTurnTimeline {turn} only={g.steps} />
      </div>
    {/if}
  </div>
{/snippet}

<div class="transcript" data-testid="chat-transcript">
  {#each body as seg (seg.key)}
    {#if seg.kind === "prose"}
      <div class="prose" data-testid="transcript-prose"><GuardedMarkdown markdown={seg.text} showCopy={false} /></div>
    {:else if seg.kind === "tools"}
      {@render toolGroup(seg)}
    {/if}
  {/each}

  {#if !hasToolGroups && !turn.streaming && turn.toolsUsed && turn.toolsUsed.length > 0}
    <!-- History loaded from the server keeps only tool names, not per-call detail. -->
    <div class="names">
      {#each groupToolNames(turn.toolsUsed) as tool (tool.name)}
        <span class="t">{tool.name}{tool.count > 1 ? ` ×${tool.count}` : ""}</span>
      {/each}
    </div>
  {/if}

  {#if (turn.subAgents?.length ?? 0) > 0}
    <ChatSubAgentCards agents={turn.subAgents ?? []} checklist={turn.checklist} />
  {/if}

  {#if waitingOnYou && turn.liveApproval}
    <ChatLiveApproval approval={turn.liveApproval} />
  {/if}

  {#if showIdle && turn.awaitingModelSince !== undefined}
    <ChatModelWait since={turn.awaitingModelSince} provider={turn.provider} {stepLine} />
  {:else if showIdle}
    <p class="thinking" data-testid="turn-thinking">
      <Icon name="think" size="sm" />Thinking{#if stepLine}<span class="wait">{stepLine}</span>{/if}<span class="chat-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </p>
  {/if}

  {#if answer !== undefined}
    {#if answer.final === false}
      <!-- Text in flight may still turn out to be narration before a tool call: muted, unrendered. -->
      <p class="prose draft live-text">{answer.text}<span class="caret"></span></p>
    {:else if turn.streaming}
      <p class="prose live-text">{answer.text}<span class="caret"></span></p>
    {:else}
      <div class="prose" data-testid="transcript-answer">
        <GuardedMarkdown markdown={answer.text} showCopy={answerCopy} />
      </div>
    {/if}
  {/if}
  {#if ending && !turn.streaming}
    <ChatRunEndingNote outcome={ending.outcome} reasonInAnswer={abstentionInAnswer(answer?.text, ending.outcome)} {onRetry} />
  {:else if bareEnding(turn)}
    <!-- Ended with no recorded outcome (older rows): still a cause line and Retry, never a bare tick. -->
    <ChatRunFailedNote error={undefined} {onRetry} />
  {/if}
  <ChatStructuredOutput value={turn.liveObject} />

  <!-- Quiet footer: goal checks (open while a plan runs or a check fails), then the turn's rollup. -->
  {#if (turn.checklist && !planHidden) || (steps.length > 0 && !turn.streaming)}
    <div class="turn-foot">
      {#if turn.checklist && !planHidden}<ChatPlanCard checklist={turn.checklist} exitGate={turn.exitGate} turnComplete={!turn.streaming} />{/if}
      {#if steps.length > 0 && !turn.streaming}<p data-testid="turn-summary" class="summary">{summary.line}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .transcript { display: grid; gap: 12px; min-width: 0; }
  /* Answers and narration: 15px Geist. Text lines stop at the prose measure; code
     blocks, tables and other blocks use the full chat column. */
  .prose {
    margin: 0;
    font-family: var(--cortex-font-ui);
    font-size: var(--cortex-t-md);
    line-height: var(--cortex-lh-read);
    color: var(--cortex-text);
    min-width: 0;
  }
  p.prose,
  .prose :global(:is(p, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, dl)) { max-width: var(--cortex-prose-measure); }
  .live-text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .draft { color: var(--cortex-text-2); }
  .caret {
    display: inline-block;
    width: 7px;
    height: 1em;
    margin-left: 2px;
    vertical-align: -0.15em;
    border-radius: 2px;
    background: var(--cortex-accent);
    animation: caret-blink 1s steps(2, start) infinite;
  }
  @keyframes caret-blink { to { visibility: hidden; } }
  :global(html[data-motion="reduce"]) .caret { animation: none; }

  .tool-group { display: grid; gap: 8px; min-width: 0; }
  .toolrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    width: fit-content;
    max-width: 100%;
    padding: 5px 10px 5px 8px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    color: var(--cortex-text-2);
    font: inherit;
    font-size: var(--cortex-t-xs);
    text-align: left;
    cursor: pointer;
  }
  .toolrow:hover { border-color: var(--cortex-line-strong); color: var(--cortex-text); }
  .lead { font-weight: 600; color: var(--cortex-text); }
  .t {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 14rem;
    padding: 1px 6px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-io);
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t[data-tone="failed"] { color: var(--cortex-bad); background: var(--cortex-bad-tint); }
  .t[data-tone="fixed"] { color: var(--cortex-ok); background: var(--cortex-ok-tint); }
  .t[data-tone="running"] { color: var(--cortex-accent); background: var(--cortex-accent-tint); }
  .bad { display: inline-flex; color: var(--cortex-bad); }
  .dur { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .args {
    max-width: 28rem;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    color: var(--cortex-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev { display: inline-flex; color: var(--cortex-text-3); transition: transform var(--cortex-d-fast); }
  .chev.open { transform: rotate(90deg); }
  .tool-steps { padding-left: 12px; border-left: 1px solid var(--cortex-line); }
  .names { display: flex; flex-wrap: wrap; gap: 4px; }

  .thinking { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .wait { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .chat-dots { display: inline-flex; align-items: center; gap: 2px; }

  .turn-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .summary {
    margin: 0;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--cortex-text-3);
  }
</style>

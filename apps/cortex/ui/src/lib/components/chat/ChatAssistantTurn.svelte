<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import ChatTranscript from "$lib/components/ChatTranscript.svelte";
  import ChatTurnActions from "$lib/components/ChatTurnActions.svelte";
  import ChatModePlanCard from "./ChatModePlanCard.svelte";
  import type { PlanExecuteHandler } from "$lib/stores/chat-mode-store.js";
  import SkillActivationRow from "$lib/components/SkillActivationRow.svelte";
  import ChatTokenUsage from "$lib/components/ChatTokenUsage.svelte";
  import ModelLink from "$lib/components/ModelLink.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { bareEnding, endingBadge } from "$lib/turn-ending.js";
  import { turnAnswerText, turnEnding } from "$lib/stores/chat-timeline.js";
  import { railClassOf, strategyChip } from "$lib/chat-turn-meta.js";
  import { statusOfTurn } from "@reactive-agents/ui-core";
  import { fade } from "svelte/transition";
  import { voice } from "$lib/stores/voice.js";
  import { continueOffer } from "$lib/stores/chat-continue-offer.js";

  interface Props {
    turn: ChatTurn;
    /** Position in the thread (drives the entrance stagger). */
    index: number;
    /** The session is still loading: stagger the entrance. */
    entering: boolean;
    /** No run and no history action in flight: the action row may show. */
    idle: boolean;
    /** Session provider / model: shown on a streaming turn that has not pinned its own yet. */
    provider: string;
    model: string;
    planHidden: boolean;
    /** This is the latest assistant turn (it gets Retry / Rerun). */
    isLast: boolean;
    onCopy: (content: string) => void | Promise<void>;
    strategyLabel: (id: string) => string;
    onRerun: () => void | Promise<void>;
    onTrace: (turnId: number) => void;
    onFork: (turnId: number) => void | Promise<void>;
    /** Plan mode, latest finished reply: render it as the plan card with its Execute action. */
    planCard?: boolean;
    /** Record the edited plan (when changed), switch to Execute and run it in the picked strategy. */
    onExecutePlan?: PlanExecuteHandler;
    /** The plan turn that was executed: a read-only plan card with the plan's live status. */
    pastPlanCard?: boolean;
  }
  const { turn, index: i, entering, idle, provider, model, planHidden, isLast, onCopy, strategyLabel, onRerun, onTrace, onFork, planCard = false, onExecutePlan, pastPlanCard = false }: Props = $props();

  const TONE = { error: "bad", warn: "warn", quiet: "neutral" } as const;
  // Copy and read-aloud take the answer only: reasoning lives in the Thinking pill.
  const answerText = $derived(turnAnswerText(turn));
  const status = $derived(statusOfTurn(turnEnding(turn), { streaming: turn.streaming === true }));
  const rail = $derived(railClassOf(status.tone));
  const shownProvider = $derived(turn.provider ?? (turn.streaming ? provider : ""));
  const shownModel = $derived(turn.model ?? (turn.streaming ? model : ""));
  const strategy = $derived(turn.streaming ? undefined : strategyChip(turn, strategyLabel));
  const canRetry = $derived(isLast && idle && !turn.streaming);
  // Read aloud: the speaker action toggles this turn's reading (controls and highlight: ChatVoiceBar).
  const v = voice();
  const readerState = v.readerState;
  const readId = $derived(String(turn.id));
  const readingThis = $derived($readerState.sourceId === readId && $readerState.status !== "idle" && $readerState.status !== "error");
  const label = $derived(
    turn.streaming ? "Assistant reply, running" : status.tone === "failed" ? "Assistant reply, did not finish" : "Assistant reply",
  );
</script>

<!-- Prose on the canvas with the signal rail at the left: live, neutral or red (spec section 8). -->
<article
  class="chat-turn chat-turn-in turn rail {rail}"
  class:last={isLast}
  style:--chat-turn-delay="{entering ? Math.min(i, 8) * 40 : 0}ms"
  out:fade|local={{ duration: 140 }}
  aria-label={label}
  aria-busy={turn.streaming === true}
  data-testid="assistant-turn"
  data-read-source={readId}
>
  <header class="turn-h">
    <span class="who">Agent</span>
    {#if shownModel}
      <span class="chip data"><ModelLink provider={shownProvider} model={shownModel} /></span>
    {/if}
    {#if strategy}<span class="chip" use:tooltip={strategy.title} data-testid="turn-strategy">{strategy.label}</span>{/if}
    {#if turn.streaming}
      <!-- The elapsed "Running 12s" sits in the action row below. -->
      <Status tone="running" label="Running" />
    {/if}
    {#if turn.cancelled && !turn.runFailed}<Badge>stopped</Badge>{/if}
    {#if turn.runFailed && !turn.streaming}
      {@const badge = endingBadge(turn.runFailed)}
      <span data-testid="turn-ending-badge" use:tooltip={badge.title}><Badge tone={TONE[badge.tone]}>{badge.label}</Badge></span>
    {/if}
    <span class="usage"><ChatTokenUsage {turn} /></span>
  </header>

  {#snippet transcript()}
    <ChatTranscript {turn} {planHidden} answerCopy={false} onRetry={canRetry ? () => void onRerun() : undefined} continueOffered={isLast ? $continueOffer : undefined} />
  {/snippet}
  {#if planCard && onExecutePlan}
    <ChatModePlanCard turnId={turn.id} onExecute={onExecutePlan}>{@render transcript()}</ChatModePlanCard>
  {:else if pastPlanCard}
    <ChatModePlanCard turnId={turn.id}>{@render transcript()}</ChatModePlanCard>
  {:else}
    {@render transcript()}
  {/if}

  <!-- Skills the run had active and why (stored with the finished turn). -->
  <SkillActivationRow skills={turn.skills} />

  <!-- Status · time (duration + finish) · copy and the turn's actions (ChatTurnActions). -->
  <ChatTurnActions
    {turn}
    showActions={!turn.streaming && idle}
    pinned={isLast}
    showStrategy={false}
    copyText={answerText.trim() !== "" ? answerText : undefined}
    {onCopy}
    {strategyLabel}
    actions={[
      // A turn that did not finish offers Retry in its ending note; the row keeps Rerun for the rest.
      ...(isLast && !turn.runFailed && !bareEnding(turn) ? [{ label: turn.incomplete ? "Retry" : "Rerun", icon: "retry" as const, run: () => onRerun() }] : []),
      ...(answerText.trim() !== "" ? [{ label: readingThis ? "Stop reading" : "Read aloud", icon: "speaker" as const, run: () => v.toggleRead(readId, answerText) }] : []),
      { label: "Open trace", icon: "trace", run: () => onTrace(turn.id) },
      { label: "Fork from here", icon: "fork", run: () => onFork(turn.id) },
    ]}
  />
</article>

<style>
  .turn { display: grid; gap: 12px; padding-left: 20px; min-width: 0; }
  .turn-h { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .who { font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 7px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    white-space: nowrap;
  }
  .chip.data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .usage { margin-left: auto; display: inline-flex; align-items: center; }
</style>

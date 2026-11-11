<script lang="ts">
  /**
   * One trace row (Bench `run.html`): a kernel loop, or the final answer. The
   * collapsed row shows the loop, the first line of its reasoning, the tools
   * it called and its tokens and time; expanded, the reasoning, action, tool
   * result, raw response and message thread. Every payload that can be large
   * goes through BoundedText / GuardedMarkdown, so a runaway tool result or
   * answer can never freeze the page.
   */
  import type { CortexTraceFrame } from "$lib/stores/trace-store.js";
  import BoundedText from "$lib/components/BoundedText.svelte";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { formatSize } from "$lib/text-budget.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { groupToolNames } from "$lib/tool-groups.js";
  import { throughputView } from "$lib/llm-throughput.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { formatClockTime, formatCost, formatTurnDuration, type SafetyLoopMark } from "@reactive-agents/ui-core";
  import { safetyBadgeTone, safetyMarkLabel } from "$lib/run-safety.js";

  interface Props {
    frame: CortexTraceFrame;
    expanded: boolean;
    selected?: boolean;
    /** Safety events in this loop (ui-core `SafetyLoopMark`), shown as a badge on the row. */
    safety?: SafetyLoopMark;
    onToggle: () => void;
  }
  let { frame: f, expanded, selected = false, safety, onToggle }: Props = $props();

  const isFinal = $derived(f.kind === "final");
  const toolGroups = $derived(groupToolNames(f.toolsThisStep ?? []));
  const summary = $derived((f.llmThought || f.thought || "").replace(/\s+/g, " ").trim());
  const ms = (n: number): string => (n >= 1000 ? formatTurnDuration(n) : `${n} ms`);
  // This loop's output speed and time to first token; the stats wrap in the narrow Inspector.
  const speed = $derived(throughputView(f.throughput));

  /** Messages-sent-to-LLM thread is secondary: collapsed until asked for. */
  let showThread = $state(false);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied", label);
    } catch {
      toast.error("Copy failed");
    }
  }
</script>

{#snippet section(title: string, text: string, copyLabel: string, max: string = "16rem")}
  <section class="part">
    <div class="ph">
      <h4>{title}</h4>
      <IconButton icon="copy" label="Copy {title.toLowerCase()}" size="sm" onclick={() => copy(text, copyLabel)} />
    </div>
    <BoundedText {text} copy={false} maxHeight={max} />
  </section>
{/snippet}

<article class="frame" class:final={isFinal} class:selected data-loop={isFinal ? undefined : f.iteration}>
  <button type="button" class="row" aria-expanded={expanded} onclick={onToggle}>
    <span class="lbl">{isFinal ? "Answer" : `Loop ${f.iteration}`}</span>
    <span class="mid">
      <span class="ttl">
        {#if isFinal}Final answer <Badge tone="ok">final</Badge>{:else}{summary.slice(0, 120) || "No reasoning recorded"}{summary.length > 120 ? "…" : ""}{/if}
      </span>
      {#if isFinal && summary}<span class="sub">{summary.slice(0, 140)}{summary.length > 140 ? "…" : ""}</span>{/if}
      {#if !isFinal && toolGroups.length > 0}
        <span class="chips">
          {#each toolGroups.slice(0, 4) as tool (tool.name)}
            <span class="tool">{tool.name}{tool.count > 1 ? ` ×${tool.count}` : ""}</span>
          {/each}
          {#if toolGroups.length > 4}<span class="more">+{toolGroups.length - 4}</span>{/if}
        </span>
      {/if}
    </span>
    <span class="m">
      {#if safety && safety.count > 0}
        <span class="safety" use:tooltip={safetyMarkLabel(safety)}><Badge tone={safetyBadgeTone(safety.tone)} data><Icon name="alert-circle" size="sm" />{safety.count}</Badge></span>
      {/if}
      {#if f.tokensUsed > 0}<span>{f.tokensUsed.toLocaleString()} tok</span>{/if}
      {#if f.durationMs > 0}<span>{ms(f.durationMs)}</span>{/if}
      {#if speed}<span class="rate" use:tooltip={speed.title}>{speed.ttft ? `${speed.text} · ${speed.ttft}` : speed.text}</span>{/if}
      {#if f.entropy !== undefined}<span>η {f.entropy.toFixed(2)}</span>{/if}
      <span class="chev" class:open={expanded}><Icon name="down" size="sm" /></span>
    </span>
  </button>

  {#if expanded}
    <div class="detail" role="region" aria-label={isFinal ? "Final answer" : `Loop ${f.iteration} details`}>
      {#if isFinal}
        <div class="answer">
          <div class="ph">
            <h4>Final answer <span class="meta">{formatSize(f.thought.length)}</span></h4>
            <IconButton icon="copy" label="Copy final answer" size="sm" onclick={() => copy(f.thought, "Final answer copied")} />
          </div>
          <GuardedMarkdown markdown={f.thought} showCopy={false} />
        </div>
      {:else}
        {#if f.llmThought}{@render section("Reasoning", f.llmThought, "Reasoning copied")}{/if}
        {#if f.action}{@render section("Action", f.action, "Action copied", "10rem")}{/if}
        {#if f.observation}{@render section("Tool result", f.observation, "Tool result copied")}{/if}
      {/if}

      {#if f.rawResponse}{@render section("Raw model response", f.rawResponse, "Raw response copied")}{/if}

      {#if f.messages?.length}
        <section class="part">
          <button type="button" class="thread" aria-expanded={showThread} onclick={() => (showThread = !showThread)}>
            <span class="chev" class:open={showThread}><Icon name="chevron" size="sm" /></span>
            Message thread · {f.messages.length} messages
          </button>
          {#if showThread}
            {#each f.messages as msg, mi (mi)}
              <div class="msg" data-role={msg.role}>
                <span class="role">{msg.role}</span>
                <BoundedText text={msg.content} preview={1500} maxHeight="12rem" />
              </div>
            {/each}
          {/if}
        </section>
      {/if}

      <footer class="foot">
        {#if f.model}<span>{f.model}</span>{/if}
        {#if f.provider}<span>{f.provider}</span>{/if}
        {#if f.tokensUsed > 0}<span>{f.tokensUsed.toLocaleString()} tokens</span>{/if}
        {#if f.estimatedCost}<span>{formatCost(f.estimatedCost)}</span>{/if}
        {#if speed}<span use:tooltip={speed.title}>{speed.text}</span>{#if speed.ttft}<span>{speed.ttft}</span>{/if}{/if}
        {#if f.entropy !== undefined}<span>η {f.entropy.toFixed(3)}</span>{/if}
        <span>{formatClockTime(f.ts)}</span>
      </footer>
    </div>
  {/if}
</article>

<style>
  .frame { border-bottom: 1px solid var(--cortex-line); }
  .frame:last-child { border-bottom: 0; }
  .frame.selected .row { box-shadow: inset 2px 0 0 var(--cortex-accent); }
  /* Wide: label | summary + tools | stats. Narrow (the Inspector, see the
     container query below): label and stats share the first line, the
     summary and tools take the full width under it. */
  .row {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    grid-template-areas: "lbl mid m";
    gap: 12px;
    align-items: start;
    width: 100%;
    padding: 10px 16px;
    border: 0;
    background: none;
    color: var(--cortex-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: var(--cortex-surface-2); }
  .row:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .lbl { grid-area: lbl; padding-top: 2px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); white-space: nowrap; }
  .final .lbl { color: var(--cortex-ok); }
  .mid { grid-area: mid; display: grid; gap: 2px; min-width: 0; }
  .ttl { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; font-size: var(--cortex-t-sm); font-weight: 500; overflow-wrap: anywhere; }
  .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .tool { display: inline-flex; align-items: center; max-width: 100%; min-height: 20px; padding: 0 6px; overflow-wrap: anywhere; border-radius: var(--cortex-r-chip); background: var(--cortex-surface-2); color: var(--cortex-io); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .more { font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); align-self: center; }
  .m { grid-area: m; display: flex; align-items: center; justify-content: flex-end; gap: 12px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); white-space: nowrap; }
  .chev { display: inline-flex; transition: transform var(--cortex-d-fast) var(--cortex-ease-out); }
  .m .chev.open { transform: rotate(180deg); }
  .thread .chev.open { transform: rotate(90deg); }
  /* minmax(0, 1fr): a wide table or long line scrolls inside its own box, never widens the row. */
  .detail { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 4px 16px 14px 84px; }
  .part { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .answer :global(table) { display: block; max-width: 100%; overflow-x: auto; }
  .ph { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h4 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); font-weight: 400; color: var(--cortex-text-3); }
  .answer { padding: 12px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); font-size: var(--cortex-t-md); line-height: var(--cortex-lh-read); }
  .thread { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: var(--cortex-text-2); font: inherit; font-size: var(--cortex-t-xs); font-weight: 600; cursor: pointer; }
  .thread:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
  .msg { display: grid; gap: 2px; padding-left: 10px; border-left: 2px solid var(--cortex-line-strong); }
  .msg[data-role="assistant"] { border-left-color: var(--cortex-accent); }
  .msg[data-role="tool"] { border-left-color: var(--cortex-io); }
  .role { font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); text-transform: capitalize; }
  .foot { display: flex; flex-wrap: wrap; gap: 4px 12px; padding-top: 8px; border-top: 1px solid var(--cortex-line); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  @container trace (max-width: 34rem) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: "lbl m" "mid mid";
      gap: 4px 10px;
      padding: 10px 12px;
    }
    .lbl { padding-top: 0; }
    /* The stats share the label's line here; wrap rather than overflow when the Inspector is very narrow. */
    .m { gap: 4px 10px; flex-wrap: wrap; white-space: normal; }
    .m > span { white-space: nowrap; }
    .detail { padding: 4px 12px 14px; }
  }
</style>

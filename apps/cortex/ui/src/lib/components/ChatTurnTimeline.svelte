<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { previewArgs, turnSteps, turnSummary } from "$lib/stores/chat-timeline.js";
  import type { ChatToolCall } from "$lib/stores/chat-store.js";
  import { groupToolNames } from "$lib/tool-groups.js";
  import ChatSubAgentCards from "$lib/components/ChatSubAgentCards.svelte";
  import type { TurnStep } from "@reactive-agents/ui-core";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Status from "$lib/components/kit/Status.svelte";

  interface Props {
    turn: ChatTurn;
    /** Tighter type + spacing for the run-view chat tab. */
    compact?: boolean;
    /**
     * Render only these steps (a chat transcript's tool group, expanded): no
     * summary line, no sub-agents, and no narration, which the transcript
     * already shows as prose.
     */
    only?: readonly TurnStep<ChatToolCall>[];
  }
  const { turn, compact = false, only }: Props = $props();

  // Action-first steps (ui-core): titled by what the agent did, retries grouped,
  // narration secondary, thinking collapsed, repeats collapsed to "same as step N".
  const steps = $derived(only ?? turnSteps(turn));
  const embedded = $derived(only !== undefined);
  const summary = $derived(turnSummary(turn, steps));
  // Open/closed overrides keyed by step key / call id. Absent ⇒ default: the step
  // still running stays open; finished steps collapse to their one-line summary;
  // tool cards start collapsed.
  let overrides = $state<Record<string, boolean>>({});
  const stepDefault = (i: number) =>
    embedded ? steps[i]?.status === "running" : turn.streaming === true && i === steps.length - 1;
  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

  const isOpen = (key: string, fallback: boolean) => overrides[key] ?? fallback;
  const toggle = (key: string, fallback: boolean) => {
    overrides = { ...overrides, [key]: !isOpen(key, fallback) };
  };

  const pretty = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  // Nothing under 11px (spec principle 6).
  const text = $derived(compact ? "text-[11px]" : "text-[12px]");
</script>

{#snippet toolCard(call: ChatToolCall)}
        {@const open = isOpen(call.id, false)}
        <div class="overflow-hidden rounded-md border border-[color:var(--cortex-line)] bg-[var(--cortex-surface-3)]/40">
          <button
            type="button"
            onclick={() => toggle(call.id, false)}
            class="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-[var(--cortex-surface-2)]"
            aria-expanded={open}
          >
            <span class="inline-flex text-[var(--cortex-text-3)] transition-transform duration-150" style="transform: rotate({open ? '90deg' : '0deg'})"><Icon name="chevron" size="sm" /></span>
            <span
              class="inline-flex {call.status === 'running' ? 'text-[var(--cortex-accent)]' : call.status === 'failed' ? 'text-[var(--cortex-bad)]' : 'text-[var(--cortex-text-3)]'}"
              role="img"
              aria-label={call.status}
            ><Icon name={call.status === "running" ? "circle" : call.status === "failed" ? "alert" : "tool"} size="sm" /></span>
            <span class="font-semibold text-[var(--cortex-io)]">{call.name}</span>
            {#if !open && call.args !== undefined}
              <span class="min-w-0 flex-1 truncate text-[var(--cortex-text-2)]">{previewArgs(call.args)}</span>
            {:else}
              <span class="flex-1"></span>
            {/if}
            {#if call.durationMs != null}
              <span class="shrink-0 tabular-nums text-[var(--cortex-text-2)]">{call.durationMs}ms</span>
            {/if}
          </button>
          {#if open}
            <div class="space-y-1.5 border-t border-[color:var(--cortex-line)] px-2 py-1.5">
              <div>
                <div class="mb-0.5 text-[11px] text-[var(--cortex-text-3)]">Parameters</div>
                {#if call.args !== undefined}
                  <pre class="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono leading-snug text-[var(--cortex-text)] {text}">{pretty(call.args)}</pre>
                {:else}
                  <span class="font-mono italic text-[var(--cortex-text-2)] {text}">not reported</span>
                {/if}
              </div>
              <div>
                <div class="mb-0.5 text-[11px] {call.status === 'failed' ? 'text-[var(--cortex-bad)]' : 'text-[var(--cortex-text-3)]'}">
                  {call.status === "failed" ? "Error" : "Result"}
                </div>
                {#if call.status === "running"}
                  <span class="font-mono italic text-[var(--cortex-text-2)] {text}">running…</span>
                {:else if (call.status === "failed" ? call.error : call.result) !== undefined}
                  <pre class="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono leading-snug {call.status === 'failed' ? 'text-[var(--cortex-bad)]' : 'text-[var(--cortex-text)]'} {text}">{call.status === "failed" ? call.error : call.result}{call.resultTruncated ? "\n… (truncated)" : ""}</pre>
                {:else}
                  <span class="font-mono italic text-[var(--cortex-text-2)] {text}">no output</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>
{/snippet}

{#if steps.length > 0 || (!embedded && (turn.subAgents?.length ?? 0) > 0)}
  {#if steps.length > 0 && !embedded}
    <p data-testid="turn-summary" class="m-0 mb-1 font-mono {text} tabular-nums text-[var(--cortex-text-2)]">{summary.line}</p>
  {/if}
  <ol class="mb-2 m-0 list-none space-y-1 p-0" aria-label="Steps">
    {#each steps as step, i (step.key)}
      {@const open = isOpen(step.key, stepDefault(i))}
      {@const live = step.status === "running" || (!embedded && turn.streaming === true && i === steps.length - 1)}
      <li class="step border-l-2 pl-2 {live ? 'border-[color:var(--cortex-accent)]' : step.status === 'failed' ? 'border-[color:var(--cortex-bad)]' : 'border-[color:var(--cortex-line)]'}">
        <button
          type="button"
          onclick={() => toggle(step.key, stepDefault(i))}
          class="flex w-full cursor-pointer items-center gap-1.5 py-0.5 text-left font-mono {text} text-[var(--cortex-text-2)] transition-colors hover:text-[var(--cortex-text)]"
          aria-expanded={open}
        >
          <span class="inline-flex text-[var(--cortex-text-3)] transition-transform duration-150" style="transform: rotate({open ? '90deg' : '0deg'})"><Icon name="chevron" size="sm" /></span>
          <span class="w-4 shrink-0 tabular-nums text-right {live ? 'text-[var(--cortex-accent)]' : ''}" aria-label="Step {step.n}">{step.n}</span>
          <span class="min-w-0 flex-1 truncate {open || step.actions.length > 0 ? 'text-[var(--cortex-text)]' : ''}" title={step.label}>{step.label}</span>
          {#if step.sameAsStep !== undefined && !open}
            <span class="shrink-0 italic">same as step {step.sameAsStep}</span>
          {/if}
          {#if step.status === "failed"}
            <span class="shrink-0 text-[var(--cortex-bad)]" aria-label="unresolved failure">failed</span>
          {/if}
          {#if live}
            <Status tone="running" label="running" dotOnly />
          {:else if step.durationMs !== undefined}
            <span class="shrink-0 tabular-nums">{fmtMs(step.durationMs)}</span>
          {/if}
        </button>
        {#if open}
          <div class="space-y-1.5 pb-1 pl-5 pt-0.5">
            {#if embedded}
              <!-- narration is the transcript's prose; not repeated here -->
            {:else if step.narration}
              <p class="m-0 whitespace-pre-wrap leading-relaxed text-[var(--cortex-text-2)] {text}">{step.narration}</p>
            {:else if step.sameAsStep !== undefined}
              <p class="m-0 italic text-[var(--cortex-text-2)] {text}">Same narration as step {step.sameAsStep}.</p>
            {/if}
            {#if step.thinking}
              <details class="group">
                <summary class="cursor-pointer list-none font-mono {text} text-[var(--cortex-text-2)] hover:text-[var(--cortex-text)]">Thinking</summary>
                <p class="m-0 mt-0.5 whitespace-pre-wrap leading-relaxed italic text-[var(--cortex-text-2)] {text}">{step.thinking}</p>
              </details>
            {/if}
            {#each step.failures as f (f.callId)}
              <p class="m-0 font-mono {text} leading-snug">
                <span class="text-[var(--cortex-bad)]">{f.tool.split("/").pop()} failed:</span>
                <span class="text-[var(--cortex-text)]">{f.reason}</span>
                {#if f.fixedBy}
                  <span class="text-[var(--cortex-text-2)]">· fixed by a later call{f.fixedBy.step !== step.n ? ` in step ${f.fixedBy.step}` : ""}</span>
                {/if}
              </p>
            {/each}
            {#each step.calls as call (call.id)}
              {@render toolCard(call)}
            {/each}
          </div>
        {/if}
      </li>
    {/each}
  </ol>
  {#if !embedded && (turn.subAgents?.length ?? 0) > 0}
    <!-- Children as compact cards below the parent's own steps; each opens its own transcript. -->
    <ChatSubAgentCards agents={turn.subAgents ?? []} checklist={turn.checklist} />
  {/if}
{:else if !embedded && turn.toolsUsed && turn.toolsUsed.length > 0}
  <!-- History loaded from the server keeps only tool names, not per-call detail. -->
  <div class="mb-2 flex flex-wrap gap-1 font-mono text-[11px]">
    {#each groupToolNames(turn.toolsUsed) as tool (tool.name)}
      <span class="rounded bg-[var(--cortex-surface-3)] px-1.5 py-0.5 text-[var(--cortex-text)]">{tool.name}{tool.count > 1 ? ` ×${tool.count}` : ""}</span>
    {/each}
  </div>
{/if}

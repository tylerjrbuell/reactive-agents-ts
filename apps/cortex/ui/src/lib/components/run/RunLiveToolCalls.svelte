<script lang="ts">
  // The run's tool calls still running, with the arguments they were called with
  // (from ToolCallStarted), so a long-running call is legible before it completes.
  // Renders nothing once no call is running or the run has settled.
  import Status from "$lib/components/kit/Status.svelte";
  import { liveToolCalls, type ToolEventLike } from "$lib/live-tool-calls.js";
  import { prettyArgs, previewArgs } from "$lib/stores/chat-timeline.js";

  interface Props {
    events: readonly ToolEventLike[];
    /** False once the run settled: a call that never reported completion is not "running". */
    live: boolean;
  }
  const { events, live }: Props = $props();

  const calls = $derived(live ? liveToolCalls(events) : []);
</script>

{#if calls.length > 0}
  <section class="live-calls" data-testid="run-live-tool-calls" aria-label="Tool calls running now">
    {#each calls as call (call.callId)}
      <div class="call">
        <p class="h"><Status tone="running" label="Running" dotOnly /><span class="tool">{call.toolName}</span></p>
        {#if call.args !== undefined}
          <details class="args">
            <summary data-testid="run-live-tool-args">{previewArgs(call.args, 120)}</summary>
            <pre>{prettyArgs(call.args)}</pre>
          </details>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .live-calls { display: grid; gap: 8px; }
  .call { display: grid; gap: 4px; padding: 8px 12px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); min-width: 0; }
  .h { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .tool { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-io); }
  .args { min-width: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-2); }
  .args summary { cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .args pre { margin: 4px 0 0; max-height: 12rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--cortex-text); }
</style>

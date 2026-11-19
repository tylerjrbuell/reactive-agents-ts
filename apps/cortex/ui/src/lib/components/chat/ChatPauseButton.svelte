<script lang="ts">
  /**
   * Pause beside Stop while a chat turn runs. The framework ends the durable run at its next
   * step and saves where it was (`agent.pauseRun`), so the thread then offers Continue
   * (`ChatContinueCard`). A chat without Durable runs is only stopped: the toast says so
   * instead of promising a Continue. Request: `requestTurnPause` (`stores/chat-stream.ts`).
   */
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { chatStore } from "$lib/stores/chat-store.js";
  import { requestTurnPause } from "$lib/stores/chat-stream.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { pauseToast } from "$lib/run-controls.js";

  import { interruptPhase, interruptTurn } from "$lib/stores/chat-interrupt.js";

  const pending = $derived($interruptPhase !== "idle");

  async function pause(): Promise<void> {
    const sid = $chatStore.activeSessionId;
    if (pending || !sid) return;
    const answer = await interruptTurn("pausing", () => requestTurnPause(sid));
    if (!answer) return;
    const t = pauseToast(answer);
    if (t.tone === "success") toast.success(t.title, t.detail);
    else toast.warning(t.title, t.detail);
  }
</script>

<button
  type="button"
  class="pause"
  class:pending
  aria-label={$interruptPhase === "pausing" ? "Pausing reply" : "Pause reply"}
  aria-busy={$interruptPhase === "pausing"}
  disabled={pending}
  use:tooltip={"Pause: stop here and continue later (needs Durable runs)"}
  onclick={() => void pause()}
>
  {#if $interruptPhase === "pausing"}<Icon name="clock" size="sm" /><span>Pausing…</span>{:else}<Icon name="pause" />{/if}
</button>

<style>
  .pause {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    font-size: var(--cortex-fs-sm, 12px);
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    cursor: pointer;
  }
  .pause:hover:not(:disabled) { color: var(--cortex-text); border-color: var(--cortex-line-strong); }
  .pause:disabled { opacity: 0.5; cursor: default; }
</style>

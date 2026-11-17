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

  let busy = $state(false);

  async function pause(): Promise<void> {
    const sid = $chatStore.activeSessionId;
    if (busy || !sid) return;
    busy = true;
    const answer = await requestTurnPause(sid);
    busy = false;
    const t = pauseToast(answer);
    if (t.tone === "success") toast.success(t.title, t.detail);
    else toast.warning(t.title, t.detail);
  }
</script>

<button
  type="button"
  class="pause"
  aria-label="Pause reply"
  disabled={busy}
  use:tooltip={"Pause: stop here and continue later (needs Durable runs)"}
  onclick={() => void pause()}
>
  <Icon name="pause" />
</button>

<style>
  .pause {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    cursor: pointer;
  }
  .pause:hover:not(:disabled) { color: var(--cortex-text); border-color: var(--cortex-line-strong); }
  .pause:disabled { opacity: 0.5; cursor: default; }
</style>

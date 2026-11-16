<script lang="ts">
  /**
   * A Plan-mode reply as a card: the plan's prose inside, and a primary Execute action that
   * switches the session to Execute and sends the follow-up turn in one step. Calm accent edge,
   * no motion: the live glow means "running now" and is not used here.
   */
  import type { Snippet } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    /** Run the plan: switch to Execute and send the follow-up turn. */
    onExecute: () => void | Promise<void>;
    children: Snippet;
  }
  const { onExecute, children }: Props = $props();
  let busy = $state(false);
  async function run() {
    busy = true;
    try {
      await onExecute();
    } finally {
      busy = false;
    }
  }
</script>

<section class="card" aria-label="Plan" data-testid="mode-plan-card">
  <header class="head"><Icon name="checklist" size="sm" /><span>Plan</span><span class="sub">Reasoning only: nothing has run</span></header>
  <div class="body">{@render children()}</div>
  <footer class="foot">
    <Button variant="primary" icon="play" disabled={busy} onclick={() => void run()} data-testid="plan-execute" title="Switch to Execute and send “Execute the plan.”">Execute</Button>
    <span class="note">Or keep refining: reply to adjust the plan.</span>
  </footer>
</section>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--cortex-line-strong);
    border-left: 3px solid var(--cortex-accent);
    border-radius: var(--cortex-r-panel);
    background: color-mix(in srgb, var(--cortex-accent-tint) 40%, var(--cortex-surface-1));
  }
  .head { display: flex; align-items: center; gap: 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-accent); }
  .sub { font-weight: 400; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .body { min-width: 0; }
  .foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .note { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>

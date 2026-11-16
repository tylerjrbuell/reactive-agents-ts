<script lang="ts">
  /**
   * A route's turn limit and failure notice: how long one turn may run before it is stopped, and whether
   * the sender is told when a turn fails (so an acknowledgement is never followed by silence). Edits the
   * `turnTimeoutSec` / `failureNotice` fields of the draft; rules live in `lib/channel-turn-limits.ts`.
   */
  import { TURN_TIMEOUT_DEFAULT_SEC, type TurnLimitDraft } from "$lib/channel-turn-limits.js";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";

  interface Props {
    draft: TurnLimitDraft;
    /** A webhook reply is the HTTP response, so there is no failure message to send. */
    showNotice: boolean;
  }
  let { draft = $bindable(), showNotice }: Props = $props();
</script>

<fieldset class="tl">
  <legend>When a turn takes too long or fails</legend>
  <Field id="tl-sec" label="Turn limit (seconds)" hint="A turn still running after this is stopped and counted as failed. Empty uses {TURN_TIMEOUT_DEFAULT_SEC}.">
    <Input id="tl-sec" mono inputmode="decimal" bind:value={draft.turnTimeoutSec} placeholder={String(TURN_TIMEOUT_DEFAULT_SEC)} describedBy="tl-sec-hint" />
  </Field>
  {#if showNotice}
    <Switch id="tl-notice" label="Tell the sender when a turn fails" hint="Sends one fixed message (never the error text), for example after a timeout. Off leaves the sender with silence." bind:checked={draft.failureNotice} />
  {/if}
</fieldset>

<style>
  .tl { display: grid; gap: 12px; margin: 0; padding: 12px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); min-width: 0; }
  .tl legend { padding: 0 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
</style>

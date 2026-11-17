<script lang="ts">
  /**
   * A route's send pacing: the least gap between two messages the router sends into one conversation,
   * so a chatty agent does not flood a chat. Edits the `minGapMs` field of the draft; rules live in
   * `lib/channel-pacing.ts`. Not shown on webhook routes (the reply is the HTTP response).
   */
  import { MIN_GAP_MAX_MS, type PacingDraft } from "$lib/channel-pacing.js";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";

  interface Props {
    draft: PacingDraft;
  }
  let { draft = $bindable() }: Props = $props();
</script>

<fieldset class="pf">
  <legend>Pacing</legend>
  <Field id="pf-gap" label="Minimum gap between messages (milliseconds)" hint="Least wait between two messages sent into one conversation: replies, acknowledgements and notices alike. Empty or 0 turns it off; the most is {MIN_GAP_MAX_MS}.">
    <Input id="pf-gap" mono inputmode="numeric" bind:value={draft.minGapMs} placeholder="0" describedBy="pf-gap-hint" />
  </Field>
</fieldset>

<style>
  .pf { display: grid; gap: 12px; margin: 0; padding: 12px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); min-width: 0; }
  .pf legend { padding: 0 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
</style>

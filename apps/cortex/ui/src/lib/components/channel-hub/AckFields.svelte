<script lang="ts">
  /**
   * A route's turn acknowledgement: a typing indicator at once and one short message if a turn runs
   * long, then the final reply. Off by default. The text is fixed config, never agent output (with
   * "model" the router uses the agent's own narration, else a one-line model call, else this text).
   * Edits the `ack*` fields of the draft; rules live in `lib/channel-hub.ts`.
   */
  import { ACK_DEFAULTS, MODEL_TIMEOUT_RANGE, type RouteDraft } from "$lib/channel-hub.js";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";

  interface Props {
    draft: RouteDraft;
  }
  let { draft = $bindable() }: Props = $props();
</script>

<fieldset class="ack">
  <legend>Acknowledge slow turns</legend>
  <Switch id="ack-on" label="Acknowledge" hint="While the agent works, show typing and send one short message if it takes a while." bind:checked={draft.ackOn} />
  {#if draft.ackOn}
    <div class="ack-grid">
      <Field id="ack-after" label="Send after (ms)" hint="Default {ACK_DEFAULTS.afterMs}. The message is skipped if the reply is faster.">
        <Input id="ack-after" mono inputmode="numeric" bind:value={draft.ackAfterMs} placeholder={String(ACK_DEFAULTS.afterMs)} describedBy="ack-after-hint" />
      </Field>
      <Field id="ack-source" label="Message comes from" hint={draft.ackSource === "model" ? "The agent's own narration if it has said something, else a one-line model call, else the text below." : "The fixed text below."}>
        <Select
          id="ack-source"
          bind:value={draft.ackSource}
          options={[{ value: "canned", label: "Fixed text" }, { value: "model", label: "Written by the model", description: "May cost a few tokens" }]}
          onchange={(v) => (draft.ackSource = v === "model" ? "model" : "canned")}
          describedBy="ack-source-hint"
        />
      </Field>
      {#if draft.ackSource === "model"}
        <Field id="ack-wait" label="Wait for the model (ms)" hint="{MODEL_TIMEOUT_RANGE.min} to {MODEL_TIMEOUT_RANGE.max}. Default {ACK_DEFAULTS.modelTimeoutMs}; after that the fixed text is sent.">
          <Input id="ack-wait" mono inputmode="numeric" bind:value={draft.ackModelTimeoutMs} placeholder={String(ACK_DEFAULTS.modelTimeoutMs)} describedBy="ack-wait-hint" />
        </Field>
      {/if}
      <Field id="ack-text" label="Fixed text" hint="One per line to rotate. Default: {ACK_DEFAULTS.text}" class="ack-wide">
        <Textarea id="ack-text" rows={2} bind:value={draft.ackText} placeholder={ACK_DEFAULTS.text} describedBy="ack-text-hint" />
      </Field>
    </div>
    <Switch id="ack-typing" label="Show the typing indicator" hint="From the start of the turn, where the platform supports it." bind:checked={draft.ackTyping} />
  {/if}
</fieldset>

<style>
  .ack { display: grid; gap: 10px; margin: 0; padding: 12px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); min-width: 0; }
  .ack legend { padding: 0 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .ack-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .ack-grid :global(.ack-wide) { grid-column: 1 / -1; }
</style>

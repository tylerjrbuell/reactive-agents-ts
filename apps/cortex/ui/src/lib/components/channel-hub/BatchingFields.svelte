<script lang="ts">
  /**
   * A route's message batching and mid-turn behavior: how long to wait and join messages one sender
   * sends in a burst, and what a message that arrives while a turn is running does. Edits the
   * `batchWindowMs` / `midRun` fields of the draft; rules live in `lib/channel-batching.ts`. Not shown on
   * webhook routes (the framework refuses both keys there: the reply is the HTTP response).
   */
  import { BATCH_WINDOW_MAX_MS, MID_RUN_CHOICES, type BatchingDraft, type MidRunMode } from "$lib/channel-batching.js";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";

  interface Props {
    draft: BatchingDraft;
  }
  let { draft = $bindable() }: Props = $props();

  const pick = (v: string): MidRunMode => (v === "fold" ? "fold" : v === "interrupt" ? "interrupt" : "queue");
</script>

<fieldset class="bf">
  <legend>Bursts and busy conversations</legend>
  <Field id="bf-window" label="Batch window (milliseconds)" hint="Messages from one sender in one conversation that arrive within this window become one turn. Empty or 0 turns it off; the most is {BATCH_WINDOW_MAX_MS}.">
    <Input id="bf-window" mono inputmode="numeric" bind:value={draft.batchWindowMs} placeholder="0" describedBy="bf-window-hint" />
  </Field>
  <Field id="bf-midrun" label="While a turn is running" hint={MID_RUN_CHOICES.find((c) => c.value === draft.midRun)?.description ?? ""}>
    <Select id="bf-midrun" value={draft.midRun} options={MID_RUN_CHOICES.map((c) => ({ value: c.value, label: c.label }))} onchange={(v) => (draft.midRun = pick(v))} describedBy="bf-midrun-hint" />
  </Field>
</fieldset>

<style>
  .bf { display: grid; gap: 12px; margin: 0; padding: 12px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); min-width: 0; }
  .bf legend { padding: 0 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
</style>

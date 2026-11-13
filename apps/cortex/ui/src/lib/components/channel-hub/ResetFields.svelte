<script lang="ts">
  /**
   * A route's reset commands: what an owner types to start a new conversation. Edits the `reset*` fields
   * of the draft; rules live in `lib/channel-reset-commands.ts`. Blank keeps the framework default.
   */
  import { RESET_DEFAULTS, RESET_MAX_COMMANDS, type ResetDraft } from "$lib/channel-reset-commands.js";
  import Field from "$lib/components/kit/Field.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";

  interface Props {
    draft: ResetDraft;
  }
  let { draft = $bindable() }: Props = $props();
</script>

<fieldset class="rs">
  <legend>Start a new conversation</legend>
  <p class="rs-note">When an owner sends one of these as the whole message, the saved history of that conversation is cleared and the next message starts fresh. The agent never sees the command.</p>
  <Switch id="rs-off" label="Turn reset commands off" hint="No message resets this route's conversation." bind:checked={draft.resetOff} />
  {#if !draft.resetOff}
    <Field id="rs-list" label="Commands" hint="One per line, up to {RESET_MAX_COMMANDS}, each starting with a slash. Empty uses {RESET_DEFAULTS.join(' and ')}.">
      <Textarea id="rs-list" rows={2} mono bind:value={draft.resetCommands} placeholder={RESET_DEFAULTS.join("\n")} describedBy="rs-list-hint" />
    </Field>
  {/if}
</fieldset>

<style>
  .rs { display: grid; gap: 12px; margin: 0; padding: 12px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); min-width: 0; }
  .rs legend { padding: 0 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .rs-note { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>

<script lang="ts">
  /**
   * A server's two read-only options: which of its tools only read (`readOnly`), and whether to
   * believe the server's own read-only hints (`trustAnnotations`). Shared by the add form and the
   * detail pane's Options tab; both edit an `McpDraft` (`lib/tool-workshop.ts`).
   */
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import { READ_ONLY_MODES } from "$lib/mcp-options.js";
  import type { McpDraft } from "$lib/tool-workshop.js";

  interface Props {
    draft: McpDraft;
    /** Unique prefix for the control ids (a page can show two of these). */
    idBase: string;
  }
  let { draft = $bindable(), idBase }: Props = $props();
</script>

<div class="of">
  <Field id="{idBase}-readonly" label="Read-only tools" hint="Your promise that these tools only read. It keeps them available when a chat or channel is limited to read-only.">
    <Select
      id="{idBase}-readonly"
      value={draft.readOnlyMode}
      options={READ_ONLY_MODES}
      onchange={(v) => (draft.readOnlyMode = READ_ONLY_MODES.find((m) => m.value === v)?.value ?? draft.readOnlyMode)}
    />
  </Field>
  {#if draft.readOnlyMode === "tools"}
    <Field id="{idBase}-readonly-tools" label="Read-only tool names" hint="Comma separated, without the server name prefix.">
      <Input id="{idBase}-readonly-tools" bind:value={draft.readOnlyTools} mono placeholder="get-stats, get-events" describedBy="{idBase}-readonly-tools-hint" />
    </Field>
  {/if}
  <Switch
    id="{idBase}-trust"
    label="Trust the server's read-only hints"
    bind:checked={draft.trustAnnotations}
    hint="The server marks some tools as read-only itself. On: Cortex believes those marks. Off: only what you list above counts."
  />
</div>

<style>
  .of { display: grid; gap: 12px; }
</style>

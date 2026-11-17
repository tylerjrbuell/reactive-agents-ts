<script lang="ts">
  /**
   * Add or edit one MCP server by form: name, transport, command or endpoint, headers, environment,
   * auth and the read-only options. Editing hides headers and environment (their values are
   * write-only; the detail pane's Credentials tab changes them). Fields: `McpDraft` in
   * `lib/tool-workshop.ts`.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";
  import ServerOptionsFields from "$lib/components/tools/ServerOptionsFields.svelte";
  import { MCP_TRANSPORTS } from "$lib/mcp-options.js";
  import type { McpDraft } from "$lib/tool-workshop.js";

  interface Props {
    draft: McpDraft;
    /** Editing a saved server (Update) or adding one (Save). */
    editing: boolean;
    saving: boolean;
    onSave: () => void | Promise<void>;
    onCancel: () => void;
  }
  let { draft = $bindable(), editing, saving, onSave, onCancel }: Props = $props();
</script>

<form class="sf" onsubmit={(e) => { e.preventDefault(); void onSave(); }} aria-label={editing ? "Edit the server" : "Add a server by form"}>
  <div class="sf-grid">
    <Field id="sf-name" label="Server name">
      <Input id="sf-name" bind:value={draft.name} mono placeholder="e.g. filesystem" />
    </Field>
    <Field id="sf-transport" label="Transport">
      <Select
        id="sf-transport"
        class="cx-mono"
        value={draft.transport}
        options={MCP_TRANSPORTS.map((t) => ({ value: t, label: t }))}
        onchange={(v) => (draft.transport = MCP_TRANSPORTS.find((t) => t === v) ?? draft.transport)}
      />
    </Field>
    {#if draft.transport === "stdio"}
      <Field id="sf-cmd" label="Command">
        <Input id="sf-cmd" bind:value={draft.command} mono placeholder="bunx" />
      </Field>
      <Field id="sf-args" label="Arguments" hint="Comma separated.">
        <Input id="sf-args" bind:value={draft.args} mono placeholder="-y, @modelcontextprotocol/server-filesystem, ." describedBy="sf-args-hint" />
      </Field>
    {:else}
      <Field id="sf-endpoint" label="Endpoint URL" class="wide">
        <Input id="sf-endpoint" bind:value={draft.endpoint} mono placeholder="http://127.0.0.1:8080/mcp" />
      </Field>
    {/if}
    {#if editing}
      <p class="sf-note wide">Headers and environment values are write-only. Change them in the Credentials tab.</p>
    {:else}
      <Field id="sf-headers" label="Headers JSON" hint="Optional." class="wide">
        <Textarea id="sf-headers" bind:value={draft.headers} rows={2} mono placeholder={'{ "Authorization": "Bearer …" }'} describedBy="sf-headers-hint" />
      </Field>
      {#if draft.transport === "stdio"}
        <Field id="sf-env" label="Environment JSON" hint="Optional." class="wide">
          <Textarea id="sf-env" bind:value={draft.env} rows={2} mono describedBy="sf-env-hint" />
        </Field>
      {/if}
    {/if}
    {#if draft.transport !== "stdio"}
      <Field id="sf-auth" label="Auth JSON (OAuth 2.1)" hint="Optional. For the interactive authorization-code flow run rax mcp login." class="wide">
        <Textarea id="sf-auth" bind:value={draft.auth} rows={3} mono placeholder={'{ "type": "client_credentials", "clientId": "...", "clientSecret": "..." }'} describedBy="sf-auth-hint" />
      </Field>
    {/if}
    <div class="wide"><ServerOptionsFields bind:draft idBase="sf" /></div>
  </div>
  <div class="sf-actions">
    <Button variant="ghost" onclick={onCancel}>Cancel</Button>
    <Button type="submit" variant="primary" icon="check" disabled={saving}>{saving ? "Saving…" : editing ? "Update server" : "Save server"}</Button>
  </div>
</form>

<style>
  .sf { display: grid; gap: 14px; }
  .sf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
  .sf-grid :global(.wide), .wide { grid-column: 1 / -1; }
  .sf-note { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .sf-actions { display: flex; justify-content: flex-end; gap: 8px; }
  @media (max-width: 800px) { .sf-grid { grid-template-columns: 1fr; } }
</style>

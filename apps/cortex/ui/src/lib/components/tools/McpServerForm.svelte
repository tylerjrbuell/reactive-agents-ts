<script lang="ts">
  /** MCP server setup: saved servers (refresh, copy, delete), the manual form, or a JSON import. */
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";
  import type { McpDraft, McpListRow } from "$lib/tool-workshop.js";

  interface Props {
    /** Manual setup form or JSON import. */
    mode?: "manual" | "import";
    /** The server form fields. */
    draft: McpDraft;
    /** Pasted import JSON. */
    jsonImport?: string;
    servers: McpListRow[];
    /** Server whose tools are being refreshed. */
    refreshing: string | null;
    /** Editing an existing server (Update) vs creating one (Save). */
    editing: boolean;
    saving: boolean;
    importing: boolean;
    importPreview: string | null;
    importPreviewError: string | null;
    onEdit: (row: McpListRow) => void;
    onRefresh: (serverId: string) => void | Promise<void>;
    onCopyConfig: (row: McpListRow) => void;
    onDelete: (serverId: string) => void | Promise<void>;
    /** Clear the form for a new server. */
    onNewServer: () => void;
    onReloadServers: () => void | Promise<void>;
    onSave: () => void | Promise<void>;
    onPreviewImport: () => void;
    onImport: () => void | Promise<void>;
    onDone: () => void;
  }
  let {
    mode = $bindable("manual"), draft = $bindable(), jsonImport = $bindable(""),
    servers, refreshing, editing, saving, importing, importPreview, importPreviewError,
    onEdit, onRefresh, onCopyConfig, onDelete, onNewServer, onReloadServers, onSave, onPreviewImport, onImport, onDone,
  }: Props = $props();
</script>

<div class="mcp">
  <div class="seg" role="radiogroup" aria-label="How to add the server">
    <button type="button" role="radio" aria-checked={mode === "manual"} onclick={() => (mode = "manual")}>Manual setup</button>
    <button type="button" role="radio" aria-checked={mode === "import"} onclick={() => (mode = "import")}>Import JSON</button>
  </div>

  <section class="servers" aria-labelledby="tw-mcp-servers-h">
    <h3 id="tw-mcp-servers-h">Saved servers</h3>
    {#if servers.length === 0}
      <p class="note">No servers yet. Save or import one and its tools appear in the catalog.</p>
    {:else}
      <ul>
        {#each servers as s (s.serverId)}
          <li>
            <button type="button" class="srv-name" onclick={() => onEdit(s)} title="Edit {s.name}">{s.name}</button>
            <span class="srv-n">{s.tools.length} tool{s.tools.length === 1 ? "" : "s"}</span>
            <span class="grow"></span>
            <Button size="sm" icon="retry" disabled={refreshing === s.serverId} onclick={() => onRefresh(s.serverId)}>{refreshing === s.serverId ? "Refreshing…" : "Refresh tools"}</Button>
            <Button size="sm" variant="ghost" icon="copy" onclick={() => onCopyConfig(s)}>Copy config</Button>
            <IconButton icon="trash" size="sm" label={`Delete ${s.name}`} onclick={() => onDelete(s.serverId)} />
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if mode === "manual"}
    <div class="row-actions">
      <Button size="sm" variant="ghost" icon="plus" onclick={onNewServer}>New server</Button>
      <Button size="sm" variant="ghost" icon="retry" onclick={() => onReloadServers()}>Reload servers</Button>
    </div>
    <div class="form">
      <Field id="tw-mcp-name" label="Server name">
        <Input id="tw-mcp-name" bind:value={draft.name} mono placeholder="e.g. filesystem" />
      </Field>
      <Field id="tw-mcp-transport" label="Transport">
        <select id="tw-mcp-transport" class="cx-control cx-mono" bind:value={draft.transport}>
          <option value="stdio">stdio</option>
          <option value="sse">sse</option>
          <option value="websocket">websocket</option>
          <option value="streamable-http">streamable-http</option>
        </select>
      </Field>
      {#if draft.transport === "stdio"}
        <Field id="tw-mcp-cmd" label="Command">
          <Input id="tw-mcp-cmd" bind:value={draft.command} mono placeholder="bunx" />
        </Field>
        <Field id="tw-mcp-args" label="Arguments" hint="Comma separated.">
          <Input id="tw-mcp-args" bind:value={draft.args} mono placeholder="-y, @modelcontextprotocol/server-filesystem, ." describedBy="tw-mcp-args-hint" />
        </Field>
      {:else}
        <Field id="tw-mcp-endpoint" label="Endpoint URL" class="wide">
          <Input id="tw-mcp-endpoint" bind:value={draft.endpoint} mono placeholder="http://127.0.0.1:8080/mcp" />
        </Field>
      {/if}
      <Field id="tw-mcp-headers" label="Headers JSON" hint="Optional." class="wide">
        <Textarea id="tw-mcp-headers" bind:value={draft.headers} rows={2} mono placeholder={'{ "Authorization": "Bearer …" }'} describedBy="tw-mcp-headers-hint" />
      </Field>
      {#if draft.transport === "stdio"}
        <Field id="tw-mcp-env" label="Environment JSON" hint="Optional." class="wide">
          <Textarea id="tw-mcp-env" bind:value={draft.env} rows={2} mono describedBy="tw-mcp-env-hint" />
        </Field>
      {:else}
        <Field id="tw-mcp-auth" label="Auth JSON (OAuth 2.1)" hint="Optional. For the interactive authorization-code flow run rax mcp login." class="wide">
          <Textarea id="tw-mcp-auth" bind:value={draft.auth} rows={3} mono placeholder={'{ "type": "client_credentials", "clientId": "...", "clientSecret": "..." }'} describedBy="tw-mcp-auth-hint" />
        </Field>
      {/if}
    </div>
    <div class="row-actions end">
      <Button variant="ghost" onclick={onDone}>Done</Button>
      <Button variant="primary" icon="check" disabled={saving} onclick={onSave}>{saving ? "Saving…" : editing ? "Update server" : "Save server"}</Button>
    </div>
  {:else}
    <div class="import">
      <Field id="tw-mcp-json-import" label="Server JSON">
        <Textarea
          id="tw-mcp-json-import"
          bind:value={jsonImport}
          rows={8}
          mono
          placeholder={`{\n  "mcpServers": {\n    "context7": { "url": "http://127.0.0.1:8080/mcp" },\n    "docker-demo": {\n      "command": "docker",\n      "args": ["run", "-i", "--rm", "mcp/context7"]\n    }\n  }\n}`}
        />
      </Field>
      <p class="note">
        One object, an array, <code>{`{ "servers": [...] }`}</code> or Cursor-style <code>{`{ "mcpServers": { "name": { ... } } }`}</code>.
        <code>url</code> becomes <code>endpoint</code>. Without a transport: <code>command</code> or <code>args</code> means stdio, a URL ending in <code>/mcp</code> means streamable-http, any other URL sse.
        Cortex must be able to reach the host (the same machine for <code>localhost</code>).
      </p>
      {#if importPreview}
        <p class="preview" role="status">{importPreview}</p>
      {/if}
      {#if importPreviewError}
        <p class="preview bad" role="alert">{importPreviewError}</p>
      {/if}
      <div class="row-actions end">
        <Button variant="ghost" onclick={onDone}>Done</Button>
        <Button onclick={onPreviewImport}>Check and preview</Button>
        <Button variant="primary" icon="download" disabled={importing} onclick={onImport}>{importing ? "Importing…" : "Import"}</Button>
      </div>
    </div>
  {/if}
</div>

<style>
  .mcp { display: grid; gap: 14px; }
  .seg { display: inline-flex; width: fit-content; padding: 2px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .seg button { border: 0; background: none; padding: 6px 14px; border-radius: 6px; font-family: var(--cortex-font-ui); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); cursor: pointer; }
  .seg button[aria-checked="true"] { background: var(--cortex-surface-1); color: var(--cortex-text); box-shadow: 0 0 0 1px var(--cortex-line-strong); }
  .seg button:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; }
  .servers { display: grid; gap: 8px; padding: 12px; border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); max-height: 260px; overflow-y: auto; }
  h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .srv-name { padding: 2px 4px; border: 0; border-radius: 4px; background: transparent; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-accent); cursor: pointer; }
  .srv-name:hover { text-decoration: underline; }
  .srv-name:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; }
  .srv-n { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .grow { flex: 1; }
  .note { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .note code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-accent); background: var(--cortex-accent-tint); padding: 0 4px; border-radius: 4px; }
  .row-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .row-actions.end { justify-content: flex-end; }
  .form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
  .form :global(.wide) { grid-column: 1 / -1; }
  .import { display: grid; gap: 10px; }
  .preview { margin: 0; padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-accent-tint); color: var(--cortex-accent); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .preview.bad { background: var(--cortex-bad-tint); color: var(--cortex-bad); }
  @media (max-width: 800px) { .form { grid-template-columns: 1fr; } }
</style>

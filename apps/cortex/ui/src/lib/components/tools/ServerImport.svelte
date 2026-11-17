<script lang="ts">
  /**
   * Import servers from pasted JSON (one object, an array, `{ servers }` or Cursor-style
   * `{ mcpServers }`). The preview line comes from `previewMcpImport` (`lib/tool-workshop.ts`);
   * the import itself is `POST /api/mcp-servers/import-json` (`lib/tools-page-data.ts`).
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";
  import { previewMcpImport } from "$lib/tool-workshop.js";

  interface Props {
    /** Pasted JSON (bindable). */
    json?: string;
    importing: boolean;
    onImport: () => void | Promise<void>;
    onCancel: () => void;
  }
  let { json = $bindable(""), importing, onImport, onCancel }: Props = $props();

  const preview = $derived(json.trim() === "" ? null : previewMcpImport(json));
</script>

<div class="si">
  <Field id="si-json" label="Server JSON">
    <Textarea
      id="si-json"
      bind:value={json}
      rows={8}
      mono
      placeholder={`{\n  "mcpServers": {\n    "context7": { "url": "http://127.0.0.1:8080/mcp" },\n    "docker-demo": {\n      "command": "docker",\n      "args": ["run", "-i", "--rm", "mcp/context7"]\n    }\n  }\n}`}
    />
  </Field>
  <p class="si-note">
    One object, an array, <code>{`{ "servers": [...] }`}</code> or Cursor-style <code>{`{ "mcpServers": { "name": { ... } } }`}</code>.
    <code>url</code> becomes <code>endpoint</code>. Without a transport: <code>command</code> or <code>args</code> means stdio, a URL ending in <code>/mcp</code> means streamable-http, any other URL sse.
    Cortex must be able to reach the host (the same machine for <code>localhost</code>).
  </p>
  {#if preview?.preview}<p class="si-preview" role="status">{preview.preview}</p>{/if}
  {#if preview?.error}<p class="si-preview bad" role="alert">{preview.error}</p>{/if}
  <div class="si-actions">
    <Button variant="ghost" onclick={onCancel}>Cancel</Button>
    <Button variant="primary" icon="download" disabled={importing || json.trim() === "" || preview?.error != null} onclick={onImport}>{importing ? "Importing…" : "Import"}</Button>
  </div>
</div>

<style>
  .si { display: grid; gap: 10px; }
  .si-note { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .si-note code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-accent); background: var(--cortex-accent-tint); padding: 0 4px; border-radius: 4px; }
  .si-preview { margin: 0; padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-accent-tint); color: var(--cortex-accent); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .si-preview.bad { background: var(--cortex-bad-tint); color: var(--cortex-bad); }
  .si-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>

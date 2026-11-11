<script lang="ts">
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

        <div class="space-y-3 pt-1 border-t border-outline-variant/15">
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              onclick={() => (mode = "manual")}
              class="px-3 py-1.5 rounded border text-[9px] font-mono uppercase tracking-wider
                     {mode === 'manual'
                ? 'border-primary/45 bg-primary/10 text-primary'
                : 'border-outline-variant/25 text-outline/70 hover:border-primary/30'}"
            >
              Manual setup
            </button>
            <button
              type="button"
              onclick={() => (mode = "import")}
              class="px-3 py-1.5 rounded border text-[9px] font-mono uppercase tracking-wider
                     {mode === 'import'
                ? 'border-primary/45 bg-primary/10 text-primary'
                : 'border-outline-variant/25 text-outline/70 hover:border-primary/30'}"
            >
              Import JSON
            </button>
          </div>
          <div class="rounded-lg border border-outline-variant/15 bg-surface-container-lowest/40 p-3 min-h-[140px] max-h-[260px] overflow-y-auto">
            <div class="text-[9px] font-mono text-outline/50 uppercase tracking-widest mb-2">Saved servers (live)</div>
            {#if servers.length === 0}
              <p class="font-mono text-xs text-outline/40">No servers yet — import or save one to see tools immediately.</p>
            {:else}
              <div class="space-y-2">
                {#each servers as s (s.serverId)}
                  <div class="rounded border border-outline-variant/15 p-2 flex flex-col gap-1.5">
                    <div class="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onclick={() => onEdit(s)}
                        class="text-left font-mono text-[11px] text-primary hover:underline bg-transparent border-0 cursor-pointer p-0"
                      >
                        {s.name}
                      </button>
                      <span class="text-[8px] font-mono text-outline/40">{s.tools.length} tools</span>
                    </div>
                    <div class="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={refreshing === s.serverId}
                        onclick={() => onRefresh(s.serverId)}
                        class="text-[8px] font-mono px-2 py-0.5 rounded border border-secondary/30 text-secondary hover:bg-secondary/10 cursor-pointer bg-transparent disabled:opacity-40"
                      >
                        {refreshing === s.serverId ? "…" : "Refresh tools"}
                      </button>
                      <button
                        type="button"
                        onclick={() => onCopyConfig(s)}
                        class="text-[8px] font-mono px-2 py-0.5 rounded border border-outline-variant/30 text-outline/60 hover:text-primary hover:border-outline-variant/50 cursor-pointer bg-transparent"
                      >
                        Copy config
                      </button>
                      <button
                        type="button"
                        onclick={() => onDelete(s.serverId)}
                        class="text-[8px] font-mono px-2 py-0.5 rounded border border-error/30 text-error/80 hover:bg-error/10 cursor-pointer bg-transparent"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          {#if mode === "manual"}
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onclick={onNewServer}
              class="text-[9px] font-mono text-primary hover:underline bg-transparent border-0 cursor-pointer p-0"
            >
              + New server (clear form)
            </button>
            <button
              type="button"
              onclick={() => onReloadServers()}
              class="text-[9px] font-mono px-2 py-1 rounded border border-outline-variant/25 text-outline hover:text-primary bg-transparent"
            >
              ↻ Reload servers
            </button>
          </div>
          <div class="space-y-2">
              <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-name">Server name</label>
              <input
                id="tw-mcp-name"
                bind:value={draft.name}
                placeholder="e.g. filesystem"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
              />
              <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-transport">Transport</label>
              <select
                id="tw-mcp-transport"
                bind:value={draft.transport}
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="websocket">websocket</option>
                <option value="streamable-http">streamable-http</option>
              </select>
              {#if draft.transport === "stdio"}
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-cmd">Command</label>
                <input
                  id="tw-mcp-cmd"
                  bind:value={draft.command}
                  placeholder="bunx"
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
                />
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-args">Args (comma-separated)</label>
                <input
                  id="tw-mcp-args"
                  bind:value={draft.args}
                  placeholder="-y, @modelcontextprotocol/server-filesystem, ."
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
                />
              {:else}
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-endpoint">Endpoint URL</label>
                <input
                  id="tw-mcp-endpoint"
                  bind:value={draft.endpoint}
                  placeholder="http://127.0.0.1:8080/mcp"
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
                />
              {/if}
              <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-headers">Headers JSON (optional)</label>
              <textarea
                id="tw-mcp-headers"
                bind:value={draft.headers}
                rows="2"
                placeholder={'{ "Authorization": "Bearer …" }'}
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-none"
              ></textarea>
              {#if draft.transport === "stdio"}
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-env">Env JSON (optional)</label>
                <textarea
                  id="tw-mcp-env"
                  bind:value={draft.env}
                  rows="2"
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-none"
                ></textarea>
              {:else}
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-auth">Auth JSON (optional, 0.17 OAuth 2.1)</label>
                <textarea
                  id="tw-mcp-auth"
                  bind:value={draft.auth}
                  rows="3"
                  placeholder={'{ "type": "client_credentials", "clientId": "...", "clientSecret": "..." }'}
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-none"
                ></textarea>
                <p class="text-[9px] font-mono text-outline/40">Interactive authorization_code flow: run `rax mcp login`.</p>
              {/if}
              <button
                type="button"
                disabled={saving}
                onclick={onSave}
                class="w-full py-2 rounded-lg border-0 font-mono text-[10px] uppercase text-white cursor-pointer disabled:opacity-40"
                style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
              >
                {saving ? "Saving…" : editing ? "Update server" : "Save server"}
              </button>
          </div>
          {:else}
          <div class="border-t border-outline-variant/15 pt-3 space-y-2">
            <div class="text-[9px] font-mono text-outline/60 uppercase tracking-widest">Import from JSON</div>
            <p class="font-mono text-[9px] text-outline/45 leading-relaxed">
              One object, an array, <code class="text-outline/55">{`{ "servers": [...] }`}</code>, or Cursor-style
              <code class="text-outline/55">{`{ "mcpServers": { "name": { ... } } }`}</code>.
              <code class="text-outline/55">url</code> → <code class="text-outline/55">endpoint</code>. Omitted transport: stdio if
              <code class="text-outline/55">command</code>/<code class="text-outline/55">args</code>; URLs ending in <code class="text-outline/55">/mcp</code> →
              <code class="text-outline/55">streamable-http</code> (Context7 log: “HTTP at …/mcp”); other URLs → <code class="text-outline/55">sse</code>
              (legacy “/sse”). Set <code class="text-outline/55">transport</code> explicitly if needed. Cortex must reach the host (same machine as the server for
              <code class="text-outline/55">localhost</code>).
            </p>
            <textarea
              id="tw-mcp-json-import"
              bind:value={jsonImport}
              rows="7"
              placeholder={`{\n  "mcpServers": {\n    "context7": { "url": "http://127.0.0.1:8080/mcp" },\n    "docker-demo": {\n      "command": "docker",\n      "args": ["run", "-i", "--rm", "mcp/context7"]\n    }\n  }\n}`}
              class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-y min-h-[120px]"
            ></textarea>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onclick={onPreviewImport}
                class="w-full py-2 rounded-lg border border-outline-variant/30 font-mono text-[10px] uppercase text-outline hover:text-primary hover:border-primary/25 cursor-pointer bg-transparent"
              >
                Validate & preview
              </button>
              <button
                type="button"
                disabled={importing}
                onclick={onImport}
                class="w-full py-2 rounded-lg border border-primary/35 font-mono text-[10px] uppercase text-primary hover:bg-primary/10 cursor-pointer bg-transparent disabled:opacity-40"
              >
                {importing ? "Importing…" : "Import JSON"}
              </button>
            </div>
            {#if importPreview}
              <div class="rounded border border-primary/25 bg-primary/10 px-2.5 py-2 font-mono text-[9px] text-primary/90">
                {importPreview}
              </div>
            {/if}
            {#if importPreviewError}
              <div class="rounded border border-error/35 bg-error/10 px-2.5 py-2 font-mono text-[9px] text-error/85">
                {importPreviewError}
              </div>
            {/if}
          </div>
          {/if}
          <div class="flex justify-end">
            <button
              type="button"
              onclick={onDone}
              class="px-3 py-1.5 text-[10px] font-mono border border-outline-variant/25 rounded bg-transparent text-outline"
            >
              Done
            </button>
          </div>
        </div>

<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "$lib/stores/toast-store.js";

  type ToolKind = "built-in" | "meta" | "mcp" | "custom";
  /** User-creatable origins — one panel, no separate pages per type */
  type CreateKind = "custom" | "mcp";

  type CatalogParam = {
    name: string;
    type: string;
    required: boolean;
    description: string;
    enum?: string[];
  };

  type CatalogEntry = {
    id: string;
    kind: ToolKind;
    name: string;
    displayName: string;
    description: string;
    parameters: CatalogParam[];
    executable: boolean;
    executableHint?: string;
    serverId?: string;
    serverName?: string;
    disabled?: boolean;
    metrics: {
      callCount: number;
      successRatePct: number | null;
      avgDurationMs: number | null;
      lastUsedAt: number | null;
    };
  };

  type McpListRow = {
    serverId: string;
    name: string;
    config: Record<string, unknown>;
    tools: { toolName: string; description?: string }[];
  };

  interface Props {
    serverUrl: string;
  }

  let { serverUrl }: Props = $props();

  let catalog = $state<CatalogEntry[]>([]);
  let loading = $state(true);
  let search = $state("");
  let selected = $state<CatalogEntry | null>(null);
  let requestJson = $state("{}");
  let responseJson = $state("");
  let responseMs = $state<number | null>(null);
  let responseOk = $state<boolean | null>(null);
  let running = $state(false);

  let showCreate = $state(false);
  let createKind = $state<CreateKind>("custom");

  let newName = $state("");
  let newDescription = $state("");
  let newParamsJson = $state(
    '[\n  { "name": "query", "type": "string", "required": true, "description": "Primary input" }\n]',
  );
  let creating = $state(false);

  let mcpServersList = $state<McpListRow[]>([]);
  let selectedMcp = $state<McpListRow | null>(null);
  let mcpRefreshing = $state<string | null>(null);
  let mcpSaving = $state(false);
  let mcpDraftName = $state("");
  let mcpDraftTransport = $state<"stdio" | "sse" | "websocket" | "streamable-http">("stdio");
  let mcpDraftCommand = $state("");
  let mcpDraftArgs = $state("");
  let mcpDraftEndpoint = $state("");
  let mcpDraftHeaders = $state("");
  let mcpDraftEnv = $state("");
  let mcpJsonImport = $state("");
  let mcpImporting = $state(false);

  function openCreate(kind: CreateKind = "custom") {
    createKind = kind;
    showCreate = true;
    if (kind === "custom") {
      selectedMcp = null;
    }
  }

  function closeCreate() {
    showCreate = false;
  }

  async function loadMcpServers() {
    try {
      const res = await fetch(`${serverUrl}/api/mcp-servers`);
      mcpServersList = res.ok ? ((await res.json()) as McpListRow[]) : [];
      if (selectedMcp) {
        const u = mcpServersList.find((s) => s.serverId === selectedMcp!.serverId);
        selectedMcp = u ?? null;
      }
    } catch {
      mcpServersList = [];
    }
  }

  function resetMcpDraft() {
    mcpDraftName = "";
    mcpDraftTransport = "stdio";
    mcpDraftCommand = "";
    mcpDraftArgs = "";
    mcpDraftEndpoint = "";
    mcpDraftHeaders = "";
    mcpDraftEnv = "";
  }

  function openNewMcp() {
    resetMcpDraft();
    selectedMcp = null;
    createKind = "mcp";
    showCreate = true;
  }

  function openEditMcp(row: McpListRow) {
    selectedMcp = row;
    createKind = "mcp";
    showCreate = true;
    const c = row.config;
    mcpDraftName = typeof c.name === "string" ? c.name : row.name;
    mcpDraftTransport = (c.transport as typeof mcpDraftTransport) ?? "stdio";
    mcpDraftCommand = typeof c.command === "string" ? c.command : "";
    mcpDraftArgs = Array.isArray(c.args) ? (c.args as string[]).join(", ") : "";
    mcpDraftEndpoint = typeof c.endpoint === "string" ? c.endpoint : "";
    mcpDraftHeaders = c.headers && typeof c.headers === "object" ? JSON.stringify(c.headers, null, 2) : "";
    mcpDraftEnv = c.env && typeof c.env === "object" ? JSON.stringify(c.env, null, 2) : "";
  }

  function buildMcpPayload(): Record<string, unknown> {
    const name = mcpDraftName.trim();
    const transport = mcpDraftTransport;
    const body: Record<string, unknown> = { name, transport };
    if (transport === "stdio") {
      if (mcpDraftCommand.trim()) body.command = mcpDraftCommand.trim();
      const args = mcpDraftArgs.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      if (args.length > 0) body.args = args;
    } else {
      if (mcpDraftEndpoint.trim()) body.endpoint = mcpDraftEndpoint.trim();
    }
    if (mcpDraftHeaders.trim()) {
      body.headers = JSON.parse(mcpDraftHeaders) as Record<string, string>;
    }
    if (mcpDraftEnv.trim()) {
      body.env = JSON.parse(mcpDraftEnv) as Record<string, string>;
    }
    return body;
  }

  async function saveMcpServer() {
    if (!mcpDraftName.trim()) {
      toast.warning("MCP server name is required");
      return;
    }
    try {
      if (mcpDraftHeaders.trim()) JSON.parse(mcpDraftHeaders);
      if (mcpDraftEnv.trim()) JSON.parse(mcpDraftEnv);
    } catch {
      toast.error("Invalid JSON", "Headers or env must be valid JSON objects");
      return;
    }
    mcpSaving = true;
    try {
      const payload = buildMcpPayload();
      const isEdit = selectedMcp != null;
      const url = isEdit
        ? `${serverUrl}/api/mcp-servers/${selectedMcp!.serverId}`
        : `${serverUrl}/api/mcp-servers`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      toast.success(isEdit ? "MCP server updated" : "MCP server created");
      await loadMcpServers();
      await loadCatalog();
      if (!isEdit) resetMcpDraft();
    } catch (e) {
      toast.error("Save failed", String(e));
    } finally {
      mcpSaving = false;
    }
  }

  async function refreshMcpTools(serverId: string) {
    mcpRefreshing = serverId;
    try {
      const res = await fetch(`${serverUrl}/api/mcp-servers/${serverId}/refresh-tools`, { method: "POST" });
      const j = (await res.json()) as { tools?: unknown[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      toast.success("Tools refreshed", `${(j.tools ?? []).length} tool(s)`);
      await loadMcpServers();
      await loadCatalog();
    } catch (e) {
      toast.error("Refresh failed", String(e));
    } finally {
      mcpRefreshing = null;
    }
  }

  async function deleteMcpServerRow(serverId: string) {
    const res = await fetch(`${serverUrl}/api/mcp-servers/${serverId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("MCP server removed");
      if (selectedMcp?.serverId === serverId) selectedMcp = null;
      await loadMcpServers();
      await loadCatalog();
    } else toast.error("Delete failed");
  }

  async function importMcpFromJson() {
    const raw = mcpJsonImport.trim();
    if (!raw) {
      toast.warning("Paste JSON first");
      return;
    }
    mcpImporting = true;
    try {
      const payload = JSON.stringify({ json: raw });
      const headers = { "Content-Type": "application/json" };
      let res = await fetch(`${serverUrl}/api/mcp-servers/import-json`, {
        method: "POST",
        headers,
        body: payload,
      });
      if (res.status === 404) {
        res = await fetch(`${serverUrl}/api/tools/mcp-import-json`, {
          method: "POST",
          headers,
          body: payload,
        });
      }
      const text = await res.text();
      let j: { ok?: boolean; count?: number; error?: string };
      try {
        j = JSON.parse(text) as typeof j;
      } catch {
        throw new Error(
          res.status === 404
            ? `Route not found (${text.trim() || "NOT_FOUND"}). Restart the Cortex server and rebuild the UI, or confirm the dev proxy points at Cortex (CORTEX_PORT).`
            : `Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 160)}`,
        );
      }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      toast.success("MCP servers imported", `${j.count ?? 0} server(s)`);
      mcpJsonImport = "";
      await loadMcpServers();
      await loadCatalog();
    } catch (e) {
      toast.error("Import failed", String(e));
    } finally {
      mcpImporting = false;
    }
  }

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        kindLabel(t.kind).toLowerCase().includes(q),
    );
  });

  function kindLabel(k: ToolKind): string {
    if (k === "built-in") return "BUILT-IN";
    if (k === "meta") return "META";
    if (k === "mcp") return "MCP";
    return "CUSTOM";
  }

  function kindBadgeClass(k: ToolKind): string {
    if (k === "built-in") return "text-cyan-300/90 border-cyan-500/35 bg-cyan-500/10";
    if (k === "meta") return "text-violet-300/90 border-violet-500/35 bg-violet-500/10";
    if (k === "mcp") return "text-amber-300/90 border-amber-500/35 bg-amber-500/10";
    return "text-emerald-300/90 border-emerald-500/35 bg-emerald-500/10";
  }

  function relativeTime(ts: number | null): string {
    if (ts == null) return "—";
    const d = Date.now() - ts;
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.round(d / 60000)}m ago`;
    return `${Math.round(d / 3600000)}h ago`;
  }

  async function loadCatalog() {
    loading = true;
    try {
      const res = await fetch(`${serverUrl}/api/tools/catalog`);
      catalog = res.ok ? ((await res.json()) as CatalogEntry[]) : [];
      if (selected) {
        const u = catalog.find((x) => x.id === selected!.id);
        selected = u ?? null;
      }
    } catch {
      catalog = [];
    } finally {
      loading = false;
    }
  }

  function selectEntry(e: CatalogEntry) {
    selected = e;
    responseJson = "";
    responseMs = null;
    responseOk = null;
    const o: Record<string, unknown> = {};
    for (const p of e.parameters) {
      if (p.enum && p.enum.length > 0) o[p.name] = p.enum[0]!;
      else if (p.type === "number") o[p.name] = 0;
      else if (p.type === "boolean") o[p.name] = false;
      else o[p.name] = "";
    }
    requestJson = Object.keys(o).length > 0 ? JSON.stringify(o, null, 2) : "{}";
  }

  async function runTest() {
    if (!selected || !selected.executable) return;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(requestJson) as Record<string, unknown>;
      if (args === null || typeof args !== "object" || Array.isArray(args)) throw new Error("Request must be a JSON object");
    } catch (e) {
      toast.error("Invalid JSON", String(e));
      return;
    }
    running = true;
    responseOk = null;
    responseJson = "";
    responseMs = null;
    try {
      const res = await fetch(`${serverUrl}/api/tools/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: selected.id, arguments: args }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        success?: boolean;
        result?: unknown;
        executionTimeMs?: number;
      };
      if (!res.ok || j.error) {
        responseOk = false;
        responseJson = JSON.stringify({ error: j.error ?? `HTTP ${res.status}` }, null, 2);
        return;
      }
      responseOk = j.success !== false;
      responseMs = typeof j.executionTimeMs === "number" ? j.executionTimeMs : null;
      responseJson = JSON.stringify(j.result ?? {}, null, 2);
    } catch (e) {
      responseOk = false;
      responseJson = JSON.stringify({ error: String(e) }, null, 2);
    } finally {
      running = false;
    }
  }

  function exportEntry() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selected.displayName.replace(/\//g, "-")}-tool.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function toggleCustomDisabled() {
    if (!selected || selected.kind !== "custom" || !selected.id.startsWith("lab:")) return;
    const toolId = selected.id.slice(4);
    const next = !selected.disabled;
    const res = await fetch(`${serverUrl}/api/tools/lab-custom/${encodeURIComponent(toolId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: next }),
    });
    if (res.ok) {
      toast.success(next ? "Tool disabled" : "Tool enabled");
      await loadCatalog();
      const u = catalog.find((x) => x.id === selected!.id);
      if (u) selected = u;
    } else toast.error("Update failed");
  }

  async function deleteCustom() {
    if (!selected || selected.kind !== "custom" || !selected.id.startsWith("lab:")) return;
    if (!confirm(`Delete custom tool "${selected.displayName}"?`)) return;
    const toolId = selected.id.slice(4);
    const res = await fetch(`${serverUrl}/api/tools/lab-custom/${encodeURIComponent(toolId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Deleted");
      selected = null;
      await loadCatalog();
    } else toast.error("Delete failed");
  }

  async function createCustom() {
    let parameters: CatalogParam[];
    try {
      const parsed = JSON.parse(newParamsJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("parameters must be a JSON array");
      parameters = parsed as CatalogParam[];
    } catch (e) {
      toast.error("Invalid parameters JSON", String(e));
      return;
    }
    creating = true;
    try {
      const res = await fetch(`${serverUrl}/api/tools/lab-custom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          parameters,
        }),
      });
      const j = (await res.json()) as { toolId?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      toast.success("Tool created", j.toolId ?? "");
      closeCreate();
      newName = "";
      newDescription = "";
      await loadCatalog();
      const created = catalog.find((x) => x.id === `lab:${j.toolId}`);
      if (created) selectEntry(created);
    } catch (e) {
      toast.error("Create failed", String(e));
    } finally {
      creating = false;
    }
  }

  onMount(() => {
    void loadCatalog();
    void loadMcpServers();
  });
</script>

<div
  class="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low/15 p-4"
>
  <div class="flex items-center justify-between gap-2 flex-shrink-0 flex-wrap">
    <div>
      <h3 class="font-headline text-sm font-semibold text-on-surface">Tools</h3>
      <p class="font-mono text-[9px] text-outline/50 mt-0.5">
        One catalog: built-in, meta, MCP, and lab tools. <strong class="text-on-surface/60">Create tool</strong> adds custom or MCP-backed entries.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => openCreate("custom")}
        class="text-[10px] font-mono px-3 py-1.5 rounded border border-primary/35 text-primary hover:bg-primary/10 cursor-pointer bg-transparent"
      >
        + Create tool
      </button>
      <button
        type="button"
        onclick={() => loadCatalog()}
        class="text-[10px] font-mono px-3 py-1.5 rounded border border-outline-variant/25 text-outline hover:text-primary cursor-pointer bg-transparent"
      >
        ↻ Reload catalog
      </button>
    </div>
  </div>

  {#if showCreate}
    <div
      class="rounded-lg border border-primary/25 bg-surface-container-low/60 p-4 space-y-4 flex-shrink-0 shadow-[0_0_24px_-8px_rgba(139,92,246,0.35)]"
    >
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <span class="text-[10px] font-mono text-outline/70 uppercase tracking-widest">Create tool</span>
        <button
          type="button"
          onclick={closeCreate}
          class="material-symbols-outlined text-outline hover:text-on-surface text-lg bg-transparent border-0 cursor-pointer p-0 leading-none"
          aria-label="Close">close</button>
      </div>

      <p class="font-mono text-[9px] text-outline/55 leading-relaxed">
        Choose how this tool appears in the catalog. <span class="text-on-surface/65">Custom</span> = lab echo (prototype). <span class="text-on-surface/65">MCP server</span> = connect a process or URL; then
        <strong class="text-on-surface/75">Refresh tools</strong> to list its tools. Built-in and meta tools ship with the framework and show up automatically — allowlist them under Builder → Tools.
      </p>

      <div class="flex flex-wrap gap-2" role="tablist" aria-label="Tool creation type">
        <button
          type="button"
          role="tab"
          aria-selected={createKind === "custom"}
          onclick={() => {
            createKind = "custom";
            selectedMcp = null;
          }}
          class="px-3 py-2 rounded-lg font-mono text-[10px] uppercase tracking-wider border transition-colors
                 {createKind === 'custom'
            ? 'border-primary/50 bg-primary/15 text-primary'
            : 'border-outline-variant/25 text-outline/70 hover:border-primary/30'}"
        >
          Custom (lab)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={createKind === "mcp"}
          onclick={() => {
            createKind = "mcp";
            showCreate = true;
          }}
          class="px-3 py-2 rounded-lg font-mono text-[10px] uppercase tracking-wider border transition-colors
                 {createKind === 'mcp'
            ? 'border-primary/50 bg-primary/15 text-primary'
            : 'border-outline-variant/25 text-outline/70 hover:border-primary/30'}"
        >
          MCP server
        </button>
      </div>

      {#if createKind === "custom"}
        <div class="space-y-3 pt-1 border-t border-outline-variant/15">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="text-[9px] font-mono text-outline/60 uppercase block mb-1" for="tw-lab-name">Name (kebab-case)</label>
              <input
                id="tw-lab-name"
                bind:value={newName}
                placeholder="my-api-fetcher"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label class="text-[9px] font-mono text-outline/60 uppercase block mb-1" for="tw-lab-desc">Description</label>
              <input
                id="tw-lab-desc"
                bind:value={newDescription}
                placeholder="What this tool represents"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
          <div>
            <label class="text-[9px] font-mono text-outline/60 uppercase block mb-1" for="tw-lab-params">Parameters (JSON array)</label>
            <textarea
              id="tw-lab-params"
              bind:value={newParamsJson}
              rows="5"
              class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-y min-h-[88px]"
            ></textarea>
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              onclick={closeCreate}
              class="px-3 py-1.5 text-[10px] font-mono border border-outline-variant/25 rounded bg-transparent text-outline"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={creating || !newName.trim()}
              onclick={createCustom}
              class="px-4 py-1.5 text-[10px] font-mono rounded border-0 text-white disabled:opacity-40"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
            >
              {creating ? "Creating…" : "Add to catalog"}
            </button>
          </div>
        </div>
      {:else}
        <div class="space-y-3 pt-1 border-t border-outline-variant/15">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onclick={() => {
                resetMcpDraft();
                selectedMcp = null;
              }}
              class="text-[9px] font-mono text-primary hover:underline bg-transparent border-0 cursor-pointer p-0"
            >
              + New server (clear form)
            </button>
            <button
              type="button"
              onclick={() => loadMcpServers()}
              class="text-[9px] font-mono px-2 py-1 rounded border border-outline-variant/25 text-outline hover:text-primary bg-transparent"
            >
              ↻ Reload servers
            </button>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-name">Server name</label>
              <input
                id="tw-mcp-name"
                bind:value={mcpDraftName}
                placeholder="e.g. filesystem"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
              />
              <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-transport">Transport</label>
              <select
                id="tw-mcp-transport"
                bind:value={mcpDraftTransport}
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="websocket">websocket</option>
                <option value="streamable-http">streamable-http</option>
              </select>
              {#if mcpDraftTransport === "stdio"}
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-cmd">Command</label>
                <input
                  id="tw-mcp-cmd"
                  bind:value={mcpDraftCommand}
                  placeholder="bunx"
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
                />
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-args">Args (comma-separated)</label>
                <input
                  id="tw-mcp-args"
                  bind:value={mcpDraftArgs}
                  placeholder="-y, @modelcontextprotocol/server-filesystem, ."
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
                />
              {:else}
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-endpoint">Endpoint URL</label>
                <input
                  id="tw-mcp-endpoint"
                  bind:value={mcpDraftEndpoint}
                  placeholder="http://127.0.0.1:8080/mcp"
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
                />
              {/if}
              <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-headers">Headers JSON (optional)</label>
              <textarea
                id="tw-mcp-headers"
                bind:value={mcpDraftHeaders}
                rows="2"
                placeholder={'{ "Authorization": "Bearer …" }'}
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-none"
              ></textarea>
              {#if mcpDraftTransport === "stdio"}
                <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest" for="tw-mcp-env">Env JSON (optional)</label>
                <textarea
                  id="tw-mcp-env"
                  bind:value={mcpDraftEnv}
                  rows="2"
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-none"
                ></textarea>
              {/if}
              <button
                type="button"
                disabled={mcpSaving}
                onclick={saveMcpServer}
                class="w-full py-2 rounded-lg border-0 font-mono text-[10px] uppercase text-white cursor-pointer disabled:opacity-40"
                style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
              >
                {mcpSaving ? "Saving…" : selectedMcp ? "Update server" : "Save server"}
              </button>
            </div>
            <div class="rounded-lg border border-outline-variant/15 bg-surface-container-lowest/40 p-3 min-h-[200px] max-h-[340px] overflow-y-auto">
              <div class="text-[9px] font-mono text-outline/50 uppercase tracking-widest mb-2">Saved servers</div>
              {#if mcpServersList.length === 0}
                <p class="font-mono text-xs text-outline/40">None yet — save a server, then refresh tools to populate the catalog.</p>
              {:else}
                <div class="space-y-2">
                  {#each mcpServersList as s (s.serverId)}
                    <div class="rounded border border-outline-variant/15 p-2 flex flex-col gap-1.5">
                      <div class="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onclick={() => openEditMcp(s)}
                          class="text-left font-mono text-[11px] text-primary hover:underline bg-transparent border-0 cursor-pointer p-0"
                        >
                          {s.name}
                        </button>
                        <span class="text-[8px] font-mono text-outline/40">{s.tools.length} tools</span>
                      </div>
                      <div class="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={mcpRefreshing === s.serverId}
                          onclick={() => refreshMcpTools(s.serverId)}
                          class="text-[8px] font-mono px-2 py-0.5 rounded border border-secondary/30 text-secondary hover:bg-secondary/10 cursor-pointer bg-transparent disabled:opacity-40"
                        >
                          {mcpRefreshing === s.serverId ? "…" : "Refresh tools"}
                        </button>
                        <button
                          type="button"
                          onclick={() => deleteMcpServerRow(s.serverId)}
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
          </div>
          <div class="border-t border-outline-variant/15 pt-3 space-y-2">
            <div class="text-[9px] font-mono text-outline/60 uppercase tracking-widest">Import from JSON</div>
            <p class="font-mono text-[9px] text-outline/45 leading-relaxed">
              One object, an array, <code class="text-outline/55">{`{ "servers": [...] }`}</code>, or Cursor-style
              <code class="text-outline/55">{`{ "mcpServers": { "name": { ... } } }`}</code>.               <code class="text-outline/55">url</code> → <code class="text-outline/55">endpoint</code>. Omitted transport: stdio if
              <code class="text-outline/55">command</code>/<code class="text-outline/55">args</code>; URLs ending in <code class="text-outline/55">/mcp</code> →
              <code class="text-outline/55">streamable-http</code> (e.g. Context7); other URLs → <code class="text-outline/55">sse</code>. You can set
              <code class="text-outline/55">transport</code> explicitly in JSON or the form.
            </p>
            <textarea
              id="tw-mcp-json-import"
              bind:value={mcpJsonImport}
              rows="7"
              placeholder={`{\n  "mcpServers": {\n    "demo": { "command": "bunx", "args": ["-y", "@modelcontextprotocol/server-everything"] }\n  }\n}`}
              class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-y min-h-[120px]"
            ></textarea>
            <button
              type="button"
              disabled={mcpImporting}
              onclick={importMcpFromJson}
              class="w-full py-2 rounded-lg border border-primary/35 font-mono text-[10px] uppercase text-primary hover:bg-primary/10 cursor-pointer bg-transparent disabled:opacity-40"
            >
              {mcpImporting ? "Importing…" : "Import JSON"}
            </button>
          </div>
          <div class="flex justify-end">
            <button
              type="button"
              onclick={closeCreate}
              class="px-3 py-1.5 text-[10px] font-mono border border-outline-variant/25 rounded bg-transparent text-outline"
            >
              Done
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <div class="grid grid-cols-1 lg:grid-cols-[minmax(240px,320px)_1fr] gap-4 flex-1 min-h-0 overflow-hidden">
    <div class="flex flex-col min-h-0 gap-2">
      <input
        type="search"
        bind:value={search}
        placeholder="Search tools…"
        class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono placeholder:text-outline/35 flex-shrink-0"
      />
      <div class="overflow-y-auto min-h-0 space-y-1.5 pr-1">
        {#if loading}
          <div class="flex justify-center py-8">
            <span class="material-symbols-outlined text-primary animate-spin">progress_activity</span>
          </div>
        {:else if filtered.length === 0}
          <p class="font-mono text-[10px] text-outline/50 text-center py-6">No tools match.</p>
        {:else}
          {#each filtered as entry (entry.id)}
            <button
              type="button"
              onclick={() => selectEntry(entry)}
              class="w-full text-left p-3 rounded-lg border transition-all
                     {selected?.id === entry.id
                ? 'bg-primary/12 border-primary/40 ring-1 ring-primary/20'
                : 'bg-surface-container-low/50 border-outline-variant/15 hover:border-primary/25'}"
            >
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span
                  class="text-[7px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider {kindBadgeClass(
                    entry.kind,
                  )}">{kindLabel(entry.kind)}</span
                >
                {#if entry.disabled}
                  <span class="text-[7px] font-mono text-error/80 border border-error/30 rounded px-1">OFF</span>
                {/if}
              </div>
              <div class="font-mono text-[11px] text-on-surface font-medium truncate">{entry.displayName}</div>
              <div class="font-mono text-[9px] text-outline/55 line-clamp-2 mt-0.5">{entry.description}</div>
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <div class="flex flex-col min-h-0 overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low/35">
      {#if !selected}
        <div class="flex-1 flex items-center justify-center font-mono text-xs text-outline/45 p-8 text-center">
          Select a tool to inspect and test.<br />
          <span class="text-[10px] text-outline/35 mt-2 block">Need a new one? Use <strong class="text-outline/50">Create tool</strong> above.</span>
        </div>
      {:else}
        <div class="p-4 border-b border-outline-variant/15 space-y-3 flex-shrink-0 overflow-y-auto max-h-[45vh]">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap mb-1">
                <h4 class="font-headline text-sm font-bold text-on-surface uppercase tracking-wide">
                  {selected.displayName}
                </h4>
                <span
                  class="text-[7px] font-mono px-1.5 py-0.5 rounded border uppercase {kindBadgeClass(selected.kind)}"
                  >{kindLabel(selected.kind)}</span
                >
              </div>
              <p class="font-mono text-[10px] text-outline/70 leading-relaxed">{selected.description}</p>
              {#if selected.executableHint && !selected.executable}
                <p class="font-mono text-[9px] text-amber-200/70 mt-2">{selected.executableHint}</p>
              {/if}
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onclick={exportEntry}
                class="text-[9px] font-mono px-3 py-1.5 rounded border border-outline-variant/30 text-outline hover:text-on-surface bg-transparent"
              >
                Export
              </button>
              {#if selected.kind === "custom"}
                <button
                  type="button"
                  onclick={toggleCustomDisabled}
                  class="text-[9px] font-mono px-3 py-1.5 rounded border border-error/35 text-error/90 hover:bg-error/10 bg-transparent"
                >
                  {selected.disabled ? "Enable" : "Disable"}
                </button>
                <button
                  type="button"
                  onclick={deleteCustom}
                  class="text-[9px] font-mono px-3 py-1.5 rounded border border-outline-variant/20 text-outline hover:text-error bg-transparent"
                >
                  Delete
                </button>
              {/if}
            </div>
          </div>

          <div
            class="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[9px] uppercase tracking-wider text-outline/55"
          >
            <div class="rounded bg-surface-container-lowest/50 px-2 py-1.5 border border-outline-variant/10">
              <div class="text-[7px] text-outline/40">Calls</div>
              <div class="text-secondary/90 tabular-nums">{selected.metrics.callCount}</div>
            </div>
            <div class="rounded bg-surface-container-lowest/50 px-2 py-1.5 border border-outline-variant/10">
              <div class="text-[7px] text-outline/40">Success</div>
              <div class="text-secondary/90 tabular-nums">
                {selected.metrics.successRatePct != null ? `${selected.metrics.successRatePct}%` : "—"}
              </div>
            </div>
            <div class="rounded bg-surface-container-lowest/50 px-2 py-1.5 border border-outline-variant/10">
              <div class="text-[7px] text-outline/40">Avg</div>
              <div class="text-secondary/90 tabular-nums">
                {selected.metrics.avgDurationMs != null ? `${selected.metrics.avgDurationMs}ms` : "—"}
              </div>
            </div>
            <div class="rounded bg-surface-container-lowest/50 px-2 py-1.5 border border-outline-variant/10">
              <div class="text-[7px] text-outline/40">Last used</div>
              <div class="text-secondary/90">{relativeTime(selected.metrics.lastUsedAt)}</div>
            </div>
          </div>

          <div>
            <div class="text-[8px] font-mono text-outline/50 uppercase tracking-widest mb-2">Input schema</div>
            <div class="overflow-x-auto rounded border border-outline-variant/15">
              <table class="w-full text-left font-mono text-[9px]">
                <thead class="bg-surface-container-lowest/80 text-outline/50 uppercase tracking-wider">
                  <tr>
                    <th class="px-2 py-1.5 font-normal">Property</th>
                    <th class="px-2 py-1.5 font-normal">Type</th>
                    <th class="px-2 py-1.5 font-normal">Status</th>
                    <th class="px-2 py-1.5 font-normal">Description</th>
                  </tr>
                </thead>
                <tbody class="text-on-surface/85">
                  {#if selected.parameters.length === 0}
                    <tr>
                      <td colspan="4" class="px-2 py-3 text-outline/45 italic">
                        {#if selected.kind === "mcp"}
                          No cached parameters — open <strong>Create tool</strong> → MCP, select the server, run <strong>Refresh tools</strong>.
                        {:else}
                          No parameters declared.
                        {/if}
                      </td>
                    </tr>
                  {:else}
                    {#each selected.parameters as p (p.name)}
                      <tr class="border-t border-outline-variant/10">
                        <td class="px-2 py-1.5 text-cyan-300/80">{p.name}</td>
                        <td class="px-2 py-1.5 text-outline/70">{p.type}</td>
                        <td class="px-2 py-1.5">
                          <span class={p.required ? "text-error/80" : "text-outline/50"}>
                            {p.required ? "REQUIRED" : "OPTIONAL"}
                          </span>
                        </td>
                        <td class="px-2 py-1.5 text-outline/65 max-w-[200px]">{p.description}</td>
                      </tr>
                    {/each}
                  {/if}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-outline-variant/15">
          <div class="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-outline-variant/15">
            <div
              class="flex items-center justify-between px-3 py-2 bg-surface-container-lowest/40 border-b border-outline-variant/10 flex-shrink-0"
            >
              <span class="font-mono text-[8px] uppercase tracking-widest text-outline/50">request_body.json</span>
              <button
                type="button"
                disabled={!selected.executable || running}
                onclick={runTest}
                class="flex items-center gap-1 text-[9px] font-mono uppercase px-2 py-1 rounded border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40 bg-transparent"
              >
                <span class="material-symbols-outlined text-[14px]">play_arrow</span>
                {running ? "Running…" : "Run test"}
              </button>
            </div>
            <textarea
              bind:value={requestJson}
              disabled={!selected.executable}
              class="flex-1 min-h-[140px] w-full bg-transparent border-0 p-3 font-mono text-[10px] text-on-surface/90 resize-none focus:outline-none focus:ring-0 disabled:opacity-40"
              spellcheck="false"
            ></textarea>
          </div>
          <div class="flex flex-col min-h-0">
            <div
              class="flex items-center justify-between px-3 py-2 bg-surface-container-lowest/40 border-b border-outline-variant/10 flex-shrink-0"
            >
              <span class="font-mono text-[8px] uppercase tracking-widest text-outline/50">response_buffer</span>
              {#if responseMs != null}
                <span class="flex items-center gap-1 font-mono text-[9px]">
                  {#if responseOk === true}
                    <span class="material-symbols-outlined text-[14px] text-secondary">check_circle</span>
                  {:else if responseOk === false}
                    <span class="material-symbols-outlined text-[14px] text-error">error</span>
                  {/if}
                  <span class="text-outline/60">{responseMs}ms</span>
                </span>
              {/if}
            </div>
            <div class="flex-1 min-h-[140px] relative">
              <pre
                class="absolute inset-0 overflow-auto p-3 font-mono text-[10px] whitespace-pre-wrap break-all text-on-surface/85"
                >{responseJson || "—"}</pre
              >
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

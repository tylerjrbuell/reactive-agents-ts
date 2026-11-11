<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import ToolCatalogList from "$lib/components/tools/ToolCatalogList.svelte";
  import ToolInspector from "$lib/components/tools/ToolInspector.svelte";
  import ToolTestRunner from "$lib/components/tools/ToolTestRunner.svelte";
  import CreateCustomToolForm from "$lib/components/tools/CreateCustomToolForm.svelte";
  import McpServerForm from "$lib/components/tools/McpServerForm.svelte";
  import {
    EMPTY_MCP_DRAFT,
    buildMcpPayload,
    defaultRequestJson,
    filterCatalog,
    mcpDraftFromRow,
    mcpDraftJsonError,
    previewMcpImport,
    type CatalogEntry,
    type CatalogParam,
    type CreateKind,
    type McpDraft,
    type McpListRow,
  } from "$lib/tool-workshop.js";

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
  let mcpCreateMode = $state<"manual" | "import">("manual");

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
  let mcpDraft = $state<McpDraft>({ ...EMPTY_MCP_DRAFT });
  let mcpJsonImport = $state("");
  let mcpImporting = $state(false);
  let mcpImportPreview = $state<string | null>(null);
  let mcpImportPreviewError = $state<string | null>(null);

  function openCreate(kind: CreateKind = "mcp") {
    createKind = kind;
    showCreate = true;
    if (kind === "mcp") mcpCreateMode = "manual";
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
    mcpDraft = { ...EMPTY_MCP_DRAFT };
  }

  function openEditMcp(row: McpListRow) {
    selectedMcp = row;
    createKind = "mcp";
    showCreate = true;
    mcpDraft = mcpDraftFromRow(row);
  }

  async function saveMcpServer() {
    if (!mcpDraft.name.trim()) {
      toast.warning("MCP server name is required");
      return;
    }
    const jsonError = mcpDraftJsonError(mcpDraft);
    if (jsonError) {
      toast.error("Invalid JSON", jsonError);
      return;
    }
    mcpSaving = true;
    try {
      const payload = buildMcpPayload(mcpDraft);
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
      const imported = (j as { ok?: boolean; count?: number; created?: { serverId: string; name: string }[]; error?: string }).created ?? [];
      toast.success("MCP servers imported", `${j.count ?? 0} server(s) — refreshing tools…`);
      mcpJsonImport = "";
      mcpImportPreview = null;
      mcpImportPreviewError = null;
      await loadMcpServers();
      await loadCatalog();
      mcpCreateMode = "manual";
      // Auto-discover tools for every newly imported server in the background.
      // Fire-and-forget: each refresh updates the server list when it completes.
      // Long-running transports (e.g. first docker pull) handle their own timeouts server-side.
      for (const { serverId, name } of imported) {
        void (async () => {
          try {
            const r = await fetch(`${serverUrl}/api/mcp-servers/${serverId}/refresh-tools`, { method: "POST" });
            const rj = (await r.json()) as { tools?: unknown[]; error?: string };
            if (r.ok) {
              await loadMcpServers();
              await loadCatalog();
            } else {
              toast.error(`Refresh failed: ${name}`, rj.error ?? `HTTP ${r.status}`);
            }
          } catch (e) {
            toast.error(`Refresh failed: ${name}`, String(e));
          }
        })();
      }
    } catch (e) {
      toast.error("Import failed", String(e));
    } finally {
      mcpImporting = false;
    }
  }

  function previewMcpImportJson() {
    const r = previewMcpImport(mcpJsonImport);
    mcpImportPreview = r.preview;
    mcpImportPreviewError = r.error;
  }

  const filtered = $derived(filterCatalog(catalog, search));

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
    requestJson = defaultRequestJson(e.parameters);
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

  /** Clipboard copy; clipboard errors are ignored. */
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard errors
    }
  }

  async function copyToolSchema() {
    if (!selected) return;
    const schema = {
      name: selected.name,
      displayName: selected.displayName,
      description: selected.description,
      parameters: selected.parameters,
    };
    await copy(JSON.stringify(schema, null, 2));
  }

  async function copyMcpConfig(row: McpListRow) {
    selectedMcp = row;
    await copy(JSON.stringify(row.config, null, 2));
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
    const ok = await confirmAction({
      title: "Delete custom tool?",
      message: `"${selected.displayName}" is removed from the lab. Agents that use it lose access.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
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
  class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--cortex-border)] bg-white/85 p-4 shadow-sm dark:bg-surface-container-low/45 dark:shadow-[0_0_0_1px_rgba(139,92,246,0.15),0_12px_40px_-24px_rgba(0,0,0,0.55)]"
>
  <div class="flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="font-headline text-sm font-semibold text-slate-900 dark:text-on-surface">Tools</h3>
      <p class="mt-0.5 font-mono text-[9px] text-slate-600 dark:text-on-surface-variant/80">
        One catalog: built-in, meta, MCP, and lab tools. <strong class="text-slate-800 dark:text-on-surface/85">Create tool</strong> adds custom or MCP-backed entries.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => openCreate("mcp")}
        class="cursor-pointer rounded border border-primary/40 bg-primary/[0.08] px-3 py-1.5 font-mono text-[10px] text-primary transition-colors hover:bg-primary/15 dark:border-primary/50 dark:bg-primary/[0.14] dark:hover:bg-primary/[0.22]"
      >
        + Create tool
      </button>
      <button
        type="button"
        onclick={() => loadCatalog()}
        class="cursor-pointer rounded border border-[var(--cortex-border)] bg-transparent px-3 py-1.5 font-mono text-[10px] text-slate-600 transition-colors hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:text-secondary"
      >
        ↻ Reload catalog
      </button>
    </div>
  </div>

  {#if showCreate}
    <div
      class="gradient-border flex-shrink-0 space-y-4 rounded-lg border border-primary/30 p-4 shadow-lg dark:border-primary/35 dark:shadow-[0_0_40px_-12px_rgba(139,92,246,0.35)]"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-mono text-[10px] uppercase tracking-widest text-slate-600 dark:text-on-surface-variant/85">Create tool</span>
        <button
          type="button"
          onclick={closeCreate}
          class="material-symbols-outlined cursor-pointer border-0 bg-transparent p-0 text-lg leading-none text-slate-500 hover:text-primary dark:text-on-surface-variant dark:hover:text-on-surface"
          aria-label="Close">close</button>
      </div>

      <p class="font-mono text-[9px] leading-relaxed text-slate-600 dark:text-on-surface-variant/75">
        Choose how this tool appears in the catalog. <span class="text-slate-800 dark:text-on-surface/85">Custom</span> = lab echo (prototype). <span class="text-slate-800 dark:text-on-surface/85">MCP server</span> = connect a process or URL; then
        <strong class="text-slate-900 dark:text-on-surface/90">Refresh tools</strong> to list its tools. Built-in and meta tools ship with the framework and show up automatically — allowlist them under Builder → Tools.
      </p>

      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <button
          type="button"
          onclick={() => {
            createKind = "mcp";
            mcpCreateMode = "manual";
          }}
          class="rounded-lg border p-3 text-left transition-colors
                 {createKind === 'mcp'
            ? 'border-primary/45 bg-violet-50/95 dark:border-primary/50 dark:bg-primary/[0.18]'
            : 'border-[var(--cortex-border)] bg-white/90 hover:border-primary/30 dark:border-white/10 dark:bg-surface-container-high/40 dark:hover:border-primary/40'}"
        >
          <div class="font-mono text-[10px] uppercase tracking-wider text-violet-800 dark:text-primary/90">MCP-backed tool</div>
          <p class="mt-1 font-mono text-[9px] leading-relaxed text-slate-600 dark:text-on-surface-variant/75">
            Connect via stdio or endpoint, refresh discovered tools, then invoke from the same test panel.
          </p>
        </button>
        <button
          type="button"
          onclick={() => {
            createKind = "custom";
            selectedMcp = null;
          }}
          class="rounded-lg border p-3 text-left transition-colors
                 {createKind === 'custom'
            ? 'border-primary/45 bg-violet-50/95 dark:border-primary/50 dark:bg-primary/[0.18]'
            : 'border-[var(--cortex-border)] bg-white/90 hover:border-primary/30 dark:border-white/10 dark:bg-surface-container-high/40 dark:hover:border-primary/40'}"
        >
          <div class="font-mono text-[10px] uppercase tracking-wider text-violet-800 dark:text-primary/90">Custom tool</div>
          <p class="mt-1 font-mono text-[9px] leading-relaxed text-slate-600 dark:text-on-surface-variant/75">
            Fast prototype in Lab catalog. Define params, then execute with request JSON.
          </p>
        </button>
      </div>

      {#if createKind === "custom"}
        <CreateCustomToolForm
          bind:name={newName}
          bind:description={newDescription}
          bind:paramsJson={newParamsJson}
          {creating}
          onCancel={closeCreate}
          onCreate={createCustom}
        />
      {:else}
        <McpServerForm
          bind:mode={mcpCreateMode}
          bind:draft={mcpDraft}
          bind:jsonImport={mcpJsonImport}
          servers={mcpServersList}
          refreshing={mcpRefreshing}
          editing={selectedMcp != null}
          saving={mcpSaving}
          importing={mcpImporting}
          importPreview={mcpImportPreview}
          importPreviewError={mcpImportPreviewError}
          onEdit={openEditMcp}
          onRefresh={refreshMcpTools}
          onCopyConfig={(row) => void copyMcpConfig(row)}
          onDelete={deleteMcpServerRow}
          onNewServer={() => {
            resetMcpDraft();
            selectedMcp = null;
          }}
          onReloadServers={loadMcpServers}
          onSave={saveMcpServer}
          onPreviewImport={previewMcpImportJson}
          onImport={importMcpFromJson}
          onDone={closeCreate}
        />
      {/if}
    </div>
  {/if}

  <div class="grid grid-cols-1 lg:grid-cols-[minmax(240px,320px)_1fr] gap-4 flex-1 min-h-0 overflow-hidden">
    <ToolCatalogList bind:search {loading} entries={filtered} selectedId={selected?.id ?? null} onSelect={selectEntry} />

    <div class="flex flex-col min-h-0 overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low/35">
      {#if !selected}
        <div class="flex-1 flex items-center justify-center font-mono text-xs text-outline/45 p-8 text-center">
          Select a tool to inspect and test.<br />
          <span class="text-[10px] text-outline/35 mt-2 block">Need a new one? Use <strong class="text-outline/50">Create tool</strong> above.</span>
        </div>
      {:else}
        <ToolInspector
          tool={selected}
          onExport={exportEntry}
          onToggleDisabled={toggleCustomDisabled}
          onDelete={deleteCustom}
          onCopySchema={copyToolSchema}
        />
        <ToolTestRunner
          executable={selected.executable}
          bind:requestJson
          {responseJson}
          {responseMs}
          {responseOk}
          {running}
          onRun={runTest}
          onCopyRequest={() => copy(requestJson)}
          onCopyResponse={() => copy(responseJson)}
        />
      {/if}
    </div>
  </div>
</div>

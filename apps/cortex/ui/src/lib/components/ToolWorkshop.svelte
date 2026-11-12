<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import ToolCatalogList from "$lib/components/tools/ToolCatalogList.svelte";
  import ToolInspector from "$lib/components/tools/ToolInspector.svelte";
  import ToolTestRunner from "$lib/components/tools/ToolTestRunner.svelte";
  import CreateCustomToolForm from "$lib/components/tools/CreateCustomToolForm.svelte";
  import McpServerForm from "$lib/components/tools/McpServerForm.svelte";
  import McpQuickAdd from "$lib/components/tools/McpQuickAdd.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Panel from "$lib/components/kit/Panel.svelte";
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
      type InvokeReply = {
        ok?: boolean;
        error?: string;
        approvalRequired?: boolean;
        success?: boolean;
        result?: unknown;
        executionTimeMs?: number;
      };
      const send = async (approved: boolean): Promise<{ res: Response; j: InvokeReply }> => {
        const r = await fetch(`${serverUrl}/api/tools/invoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolId: selected!.id, arguments: args, ...(approved ? { approved: true } : {}) }),
        });
        return { res: r, j: (await r.json()) as InvokeReply };
      };
      let reply = await send(false);
      // Tools that run code or change files ask first: the server answers 409 until a person confirms.
      if (reply.res.status === 409 && reply.j.approvalRequired && window.confirm(reply.j.error ?? "Run this tool?")) {
        reply = await send(true);
      }
      const { res, j } = reply;
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

<div class="tw">
  <div class="tw-head">
    <p class="tw-intro">
      One catalog: built-in, meta, MCP and Lab tools. Create tool adds a custom or MCP-backed entry; allow a tool for an agent in the Builder's Tools section.
    </p>
    <McpQuickAdd onAdded={async () => { await loadMcpServers(); await loadCatalog(); }} />
    <div class="tw-actions">
      <Button icon="retry" onclick={() => loadCatalog()}>Reload catalog</Button>
      <Button variant="primary" icon="plus" onclick={() => openCreate("mcp")}>Create tool</Button>
    </div>
  </div>

  {#if showCreate}
    <Panel class="tw-create">
      <div class="tw-create-h">
        <h2>Create tool</h2>
        <IconButton icon="x" label="Close" onclick={closeCreate} />
      </div>
      <div class="tw-kinds" role="radiogroup" aria-label="Tool kind">
        <button type="button" role="radio" aria-checked={createKind === "mcp"} onclick={() => { createKind = "mcp"; mcpCreateMode = "manual"; }}>
          <span class="tw-kind-t"><Icon name="server" size="sm" />MCP server</span>
          <span class="tw-kind-d">Connect a process (stdio) or an endpoint, then Refresh tools to list what it offers. Its tools run from the same test panel.</span>
        </button>
        <button type="button" role="radio" aria-checked={createKind === "custom"} onclick={() => { createKind = "custom"; selectedMcp = null; }}>
          <span class="tw-kind-t"><Icon name="code" size="sm" />Custom tool</span>
          <span class="tw-kind-d">A quick prototype in the Lab catalog: define its parameters, then call it with a request JSON.</span>
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
    </Panel>
  {/if}

  <div class="tw-cols">
    <ToolCatalogList bind:search {loading} entries={filtered} selectedId={selected?.id ?? null} onSelect={selectEntry} />

    <section class="tw-detail" aria-label="Tool">
      {#if !selected}
        <div class="tw-empty">
          <EmptyState icon="tool" title="Pick a tool" description="Its parameters show here, with a panel to call it. Need a new one? Use Create tool above." />
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
    </section>
  </div>
</div>

<style>
  .tw { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 32px 24px; overflow-y: auto; }
  .tw-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .tw-intro { margin: 0; max-width: 72ch; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .tw-actions { display: flex; gap: 8px; }
  :global(.tw-create) { flex: none; }
  .tw-create-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .tw-create-h h2 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .tw-kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
  .tw-kinds button {
    display: grid;
    gap: 4px;
    padding: 12px;
    border: 1px solid var(--cortex-line-strong);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    text-align: left;
    cursor: pointer;
    font-family: var(--cortex-font-ui);
  }
  .tw-kinds button:hover { background: var(--cortex-surface-2); }
  .tw-kinds button[aria-checked="true"] { border-color: color-mix(in srgb, var(--cortex-accent) 45%, transparent); background: var(--cortex-accent-tint); }
  .tw-kinds button:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .tw-kind-t { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .tw-kind-d { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .tw-cols { flex: 1; min-height: 420px; display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); gap: 16px; }
  .tw-detail {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
  }
  .tw-empty { flex: 1; display: grid; place-items: center; padding: 24px; }
  @media (max-width: 1000px) { .tw-cols { grid-template-columns: 1fr; } .tw-kinds { grid-template-columns: 1fr; } }
</style>

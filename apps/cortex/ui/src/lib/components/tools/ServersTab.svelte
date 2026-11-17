<script lang="ts">
  /**
   * Lab > Tools > Servers: the master list, the add flows (Quick line, Form, Import JSON) and the
   * selected server's detail pane. Holds only the page state and the wiring: view rules are in
   * `lib/mcp-servers-view.ts`, every call in `lib/tools-page-data.ts`.
   */
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Panel from "$lib/components/kit/Panel.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import McpQuickAdd from "$lib/components/tools/McpQuickAdd.svelte";
  import ServerAddMenu from "$lib/components/tools/ServerAddMenu.svelte";
  import ServerDetail from "$lib/components/tools/ServerDetail.svelte";
  import ServerForm from "$lib/components/tools/ServerForm.svelte";
  import ServerImport from "$lib/components/tools/ServerImport.svelte";
  import ServerList from "$lib/components/tools/ServerList.svelte";
  import type { AddMode, TestReply } from "$lib/mcp-servers-view.js";
  import {
    deleteServer,
    fetchServerTools,
    importServersJson,
    refreshServerTools,
    saveServer,
    saveServerSecrets,
    setServerEnabled,
    testServer,
    type ApiCtx,
  } from "$lib/tools-page-data.js";
  import { EMPTY_MCP_DRAFT, buildMcpPayload, mcpDraftFromRow, mcpDraftJsonError, type McpDraft, type McpListRow, type McpToolDetail, type secretsPayload } from "$lib/tool-workshop.js";

  interface Props {
    ctx: ApiCtx;
    servers: readonly McpListRow[];
    loading: boolean;
    /** Reload the server list and the catalog after a change. */
    onChanged: () => void | Promise<void>;
  }
  const { ctx, servers, loading, onChanged }: Props = $props();

  let selectedId = $state<string | null>(null);
  let search = $state("");
  let addMode = $state<AddMode | null>(null);
  /** The server the Form edits; null = the Form adds a new one. */
  let editing = $state<McpListRow | null>(null);
  let draft = $state<McpDraft>({ ...EMPTY_MCP_DRAFT });
  let importJson = $state("");
  let busy = $state<"save" | "import" | "test" | "refresh" | "pane" | null>(null);
  let tools = $state<readonly McpToolDetail[] | null>(null);
  let toolsError = $state<string | null>(null);
  let testResult = $state<TestReply | null>(null);
  let credentialsVersion = $state(0);

  const selected = $derived(servers.find((s) => s.serverId === selectedId) ?? null);

  async function loadTools(serverId: string) {
    tools = null;
    toolsError = null;
    const r = await fetchServerTools(ctx, serverId);
    if (selectedId !== serverId) return;
    if (r.ok) tools = r.value;
    else toolsError = r.error;
  }

  function select(serverId: string) {
    selectedId = serverId;
    addMode = null;
    testResult = null;
    void loadTools(serverId);
  }

  function startAdd(mode: AddMode) {
    addMode = mode;
    editing = null;
    draft = { ...EMPTY_MCP_DRAFT };
    importJson = "";
  }

  function startEdit(row: McpListRow) {
    addMode = "form";
    editing = row;
    draft = mcpDraftFromRow(row);
  }

  function closeAdd() {
    addMode = null;
    editing = null;
  }

  /** List a new server's tools in the background; its detail updates when the answer lands. */
  async function discover(serverId: string, name: string) {
    const r = await refreshServerTools(ctx, serverId);
    if (!r.ok) toast.warning(`${name} saved, tools not listed`, r.error);
    await onChanged();
    if (selectedId === serverId) void loadTools(serverId);
  }

  async function saveForm() {
    if (!draft.name.trim()) return void toast.warning("Give the server a name");
    const jsonError = mcpDraftJsonError(draft);
    if (jsonError) return void toast.error("Invalid JSON", jsonError);
    busy = "save";
    const r = await saveServer(ctx, buildMcpPayload(draft), editing?.serverId);
    busy = null;
    if (!r.ok) return void toast.error("Save failed", r.error);
    toast.success(editing ? "Server updated" : "Server added");
    const name = draft.name.trim();
    const wasNew = editing === null;
    closeAdd();
    await onChanged();
    if (wasNew && r.value) {
      select(r.value);
      void discover(r.value, name);
    } else if (selectedId) void loadTools(selectedId);
  }

  async function runImport() {
    busy = "import";
    const r = await importServersJson(ctx, importJson);
    busy = null;
    if (!r.ok) return void toast.error("Import failed", r.error);
    toast.success("Servers imported", `${r.value.length} server${r.value.length === 1 ? "" : "s"}. Listing their tools.`);
    closeAdd();
    await onChanged();
    const first = r.value[0];
    if (first) select(first.serverId);
    for (const s of r.value) void discover(s.serverId, s.name);
  }

  async function test(row: McpListRow) {
    busy = "test";
    testResult = null;
    const r = await testServer(ctx, row.serverId);
    busy = null;
    testResult = r.ok ? r.value : { ok: false, error: r.error };
    await onChanged();
  }

  async function refresh(row: McpListRow) {
    busy = "refresh";
    const r = await refreshServerTools(ctx, row.serverId);
    busy = null;
    if (r.ok) toast.success("Tools refreshed", `${r.value} tool${r.value === 1 ? "" : "s"}`);
    else toast.error("Refresh failed", r.error);
    await onChanged();
    void loadTools(row.serverId);
  }

  async function toggleEnabled(row: McpListRow, enabled: boolean) {
    const r = await setServerEnabled(ctx, row.serverId, enabled);
    if (!r.ok) toast.error("Could not change the server", r.error);
    else toast.success(enabled ? `${row.name} enabled` : `${row.name} disabled`, enabled ? undefined : "Agents will not start it.");
    await onChanged();
  }

  async function remove(row: McpListRow) {
    const ok = await confirmAction({
      title: "Remove this server?",
      message: `"${row.name}" and its tool list are removed. Agents that use it lose those tools.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    const r = await deleteServer(ctx, row.serverId);
    if (!r.ok) return void toast.error("Remove failed", r.error);
    toast.success("Server removed");
    if (selectedId === row.serverId) selectedId = null;
    await onChanged();
  }

  async function saveOptions(row: McpListRow, optionsDraft: McpDraft) {
    busy = "pane";
    const r = await saveServer(ctx, buildMcpPayload(optionsDraft), row.serverId);
    busy = null;
    if (r.ok) toast.success("Options saved");
    else toast.error("Save failed", r.error);
    await onChanged();
  }

  async function saveCredentials(row: McpListRow, payload: NonNullable<ReturnType<typeof secretsPayload>>) {
    busy = "pane";
    const r = await saveServerSecrets(ctx, row.serverId, payload);
    busy = null;
    if (r.ok) {
      credentialsVersion += 1;
      toast.success("Credentials saved", "Values stay write-only.");
    } else toast.error("Save failed", r.error);
    await onChanged();
  }
</script>

<div class="st">
  <div class="st-left">
    <div class="st-bar">
      <ServerAddMenu onPick={startAdd} />
    </div>
    <ServerList {servers} {loading} selectedId={selected?.serverId ?? null} bind:search onSelect={select} onAdd={() => startAdd("quick")} onImport={() => startAdd("import")} />
  </div>

  <div class="st-right">
    {#if addMode}
      <Panel title={addMode === "quick" ? "Quick line" : addMode === "import" ? "Import JSON" : editing ? `Edit ${editing.name}` : "Add by form"}>
        {#snippet actions()}<IconButton icon="x" label="Close" onclick={closeAdd} />{/snippet}
        {#if addMode === "quick"}
          <p class="st-note">Paste a command or a URL. The server is saved and its tools listed.</p>
          <McpQuickAdd onAdded={async () => { closeAdd(); await onChanged(); }} />
        {:else if addMode === "import"}
          <ServerImport bind:json={importJson} importing={busy === "import"} onImport={runImport} onCancel={closeAdd} />
        {:else}
          <ServerForm bind:draft editing={editing !== null} saving={busy === "save"} onSave={saveForm} onCancel={closeAdd} />
        {/if}
      </Panel>
    {:else if selected}
      {#key selected.serverId}
        <ServerDetail
          row={selected}
          {tools}
          {toolsError}
          {testResult}
          testing={busy === "test"}
          refreshing={busy === "refresh"}
          saving={busy === "pane"}
          {credentialsVersion}
          onTest={() => test(selected)}
          onRefresh={() => refresh(selected)}
          onToggleEnabled={(on) => toggleEnabled(selected, on)}
          onEdit={() => startEdit(selected)}
          onRemove={() => remove(selected)}
          onSaveOptions={(d) => saveOptions(selected, d)}
          onSaveCredentials={(p) => saveCredentials(selected, p)}
        />
      {/key}
    {:else if !loading && servers.length > 0}
      <EmptyState icon="server" title="Pick a server" description="Its tools, options and credentials show here, with Test and Refresh tools." />
    {/if}
  </div>
</div>

<style>
  .st { flex: 1; min-height: 360px; display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); gap: 16px; }
  .st-left { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .st-bar { display: flex; justify-content: flex-end; }
  .st-right { min-width: 0; min-height: 0; overflow-y: auto; }
  .st-note { margin: 0 0 10px; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  @media (max-width: 1000px) { .st { grid-template-columns: 1fr; } }
</style>

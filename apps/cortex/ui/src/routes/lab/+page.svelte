<script lang="ts">
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import PromptManager from "$lib/components/PromptManager.svelte";
  import AgentExportModal from "$lib/components/AgentExportModal.svelte";
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { settings } from "$lib/stores/settings.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import ParamFillModal from "$lib/components/ParamFillModal.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { afterNavigate, goto, replaceState } from "$app/navigation";
  import PageHeader from "$lib/components/kit/PageHeader.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Tabs from "$lib/components/kit/Tabs.svelte";
  import { tabId, tabPanelId } from "$lib/tablist.js";
  import { promptStore } from "$lib/stores/prompt-store.js";
  import { loadCapabilities } from "$lib/capabilities.js";
  import ToolWorkshop from "$lib/components/ToolWorkshop.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import BuilderTab from "$lib/components/lab/BuilderTab.svelte";
  import SavedAgentsTab from "$lib/components/lab/SavedAgentsTab.svelte";
  import SkillsTab from "$lib/components/lab/SkillsTab.svelte";
  import { cortexRunsPostBody } from "$lib/cortex-runs-post-body.js";
  import { syncVariables } from "$lib/template/sync-variables.js";
  import { LAB_TABS, labTabFromHash, labTabHash, normalizeLabTab, type LabTab } from "$lib/lab-tabs.js";
  import {
    builderConfigFromAgent,
    builderDefaults,
    exampleBuilderConfig,
    importBuilderConfig,
    prefillFromSnapshot,
    type BuilderAdHocAction,
    type BuilderAgentConfig,
  } from "$lib/lab-builder.js";
  import { bulkDeleteConfirmMessage, createGatewayAgentsStore, pruneSelection, type GatewayRow, type SavedAgentsUi } from "$lib/stores/gateway-agents-store.js";
  import { createLabSkillsStore, emptySkillsUi, skillCatalogRows, skillScopeOf, type SkillRow } from "$lib/stores/lab-skills-store.js";

  /** Base config for Builder / forms: static defaults + Cortex Settings default provider/model. */
  function builderDefaultsFromSettings(): BuilderAgentConfig {
    return builderDefaults(settings.get());
  }

  let activeTab = $state<LabTab>("builder");

  /** SvelteKit's `replaceState` throws until the router has finished its first navigation. */
  let routerReady = false;

  /** Write the tab's hash to the URL (`#agents`, never the `#gateway` alias). */
  function syncTabHash(tab: LabTab) {
    if (!routerReady || typeof window === "undefined") return;
    const url = `${window.location.pathname}${window.location.search}${labTabHash(tab)}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) replaceState(url, {});
  }

  /** Switch tab and keep the URL hash in step. */
  function selectTab(tab: LabTab) {
    activeTab = tab;
    syncTabHash(tab);
  }

  // The first navigation is done: rewrite an alias hash (`#gateway`) now.
  afterNavigate(() => {
    routerReady = true;
    syncTabHash(activeTab);
  });

  // ── Quick Run builder ─────────────────────────────────────────────────
  let builderConfig = $state<BuilderAgentConfig>(builderDefaultsFromSettings());
  let builderAgentType = $state<"ad-hoc" | "persistent">("ad-hoc");
  let builderPersistentName = $state("");
  let builderPersistentSchedule = $state("");
  let builderSection = $state("model");
  let builderRunning = $state(false);
  let builderSaving = $state(false);
  let showParamModal = $state(false);
  let importInput = $state<HTMLInputElement | null>(null);

  // Strategy display names (`reactive` reads `ReAct`) for the launch summary.
  let strategyLabels = $state<ReadonlyMap<string, string>>(new Map());
  const builderStrategyLabel = $derived(strategyLabels.get(builderConfig.strategy));

  function importBuilderFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const next = importBuilderConfig(builderDefaultsFromSettings(), text);
      if (next) {
        builderConfig = next;
        selectTab("builder");
        toast.success("Agent imported", file.name);
      } else toast.error("Not an agent config", `${file.name} is not a JSON object.`);
    });
    input.value = "";
  }

  function loadExample() {
    builderConfig = exampleBuilderConfig(builderDefaultsFromSettings());
    if (!builderPersistentName.trim()) builderPersistentName = "my-research-agent";
    selectTab("builder");
    toast.info("Example loaded", "A research agent with web search and file writing.");
  }

  async function executeBuilderAdHocAction(action: BuilderAdHocAction) {
    switch (action) {
      case "run":
        onRunClick();
        break;
      case "save":
        await createAgentFromBuilder(false);
        break;
      case "save-run":
        await createAgentFromBuilder(true);
        break;
    }
  }

  async function launchRun(variableValues?: Record<string, string | number>) {
    // Re-entrancy guard: the modal's Run button is not bound to builderRunning,
    // so a fast double-confirm could otherwise POST /api/runs twice.
    if (builderRunning) return;
    if (!builderConfig.prompt.trim()) return;
    builderRunning = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cortexRunsPostBody(builderConfig.prompt.trim(), builderConfig, variableValues)),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { runId?: string };
      if (data.runId) void goto(`/run/${data.runId}`);
      else toast.info("Agent started — check Beacon");
    } catch (e) {
      toast.error("Run failed", String(e));
    } finally { builderRunning = false; }
  }

  function onRunClick() {
    if ((builderConfig.variables ?? []).length > 0) {
      showParamModal = true;
    } else {
      void launchRun();
    }
  }

  async function createAgentFromBuilder(runNow: boolean) {
    if (!builderPersistentName.trim()) {
      toast.warning("Name is required");
      return;
    }
    if (runNow && builderAgentType === "ad-hoc" && !builderConfig.prompt.trim()) {
      toast.warning("Add a task first", "Save and run uses the task stored on the agent.");
      return;
    }
    builderSaving = true;
    try {
      const data = await agentsStore.save(null, {
        name: builderPersistentName.trim(),
        type: builderAgentType === "persistent" ? "gateway" : "ad-hoc",
        runNow: builderAgentType === "ad-hoc" ? runNow : false,
        config: { ...builderConfig, prompt: builderConfig.prompt.trim() },
        schedule: builderAgentType === "persistent" ? (builderPersistentSchedule.trim() || null) : null,
      });
      toast.success(`${builderAgentType === "persistent" ? "Gateway" : "Ad-hoc"} agent created`, builderPersistentName.trim());
      await loadGatewayAgents();
      if (data.runId) {
        void goto(`/run/${data.runId}`);
      } else {
        selectTab("agents");
      }
    } catch (e) {
      toast.error("Create failed", String(e));
    } finally {
      builderSaving = false;
    }
  }

  // ── Saved agents (gateway + ad-hoc) ───────────────────────────────────
  const agentsStore = createGatewayAgentsStore(CORTEX_SERVER_URL);
  let agentsUi = $state<SavedAgentsUi<BuilderAgentConfig>>({
    showForm: false,
    editingAgent: null,
    formConfig: builderDefaultsFromSettings(),
    formName: "",
    formSchedule: "",
    formAgentType: "gateway",
    formSaving: false,
    triggeringAgent: null,
    selected: new Set<string>(),
  });
  let deleteConfirmAgent = $state<GatewayRow | null>(null);
  let deleteConfirmBulk = $state<GatewayRow[] | null>(null);
  // Agent export modal: { config, name } | null
  let exportTarget = $state<{ config: AgentConfig; name: string } | null>(null);
  // Saved agent whose run is awaiting variable values in the fill-modal.
  let triggerModalAgent = $state<GatewayRow | null>(null);

  async function loadGatewayAgents() {
    const list = await agentsStore.load(builderDefaultsFromSettings());
    agentsUi.selected = list ? pruneSelection(agentsUi.selected, list) : new Set();
  }

  function triggerAgent(agent: GatewayRow) {
    // Derive variables from the config's {{tokens}} (preserving any stored
    // enrichment) rather than trusting the persisted array — agents saved before
    // auto-detect carry tokens in their prompt but an empty `variables` list.
    const vars = syncVariables(agent.config);
    if (vars.length > 0) {
      // Collect values in the fill-modal first so the gateway resolves with them
      // instead of failing on an unresolved required token.
      triggerModalAgent = { ...agent, config: { ...agent.config, variables: vars } };
      return;
    }
    void doTrigger(agent);
  }

  async function doTrigger(agent: GatewayRow, variableValues?: Record<string, string | number>) {
    agentsUi.triggeringAgent = agent.agentId;
    try {
      const { ok, status, data } = await agentsStore.trigger(agent.agentId, variableValues);
      if (ok) {
        toast.success(`${agent.name} triggered`, "Run started");
        if (data.runId) void goto(`/run/${data.runId}`);
        await loadGatewayAgents();
      } else {
        toast.error("Trigger failed", data.error ?? `Server returned ${status}`);
      }
    } catch (e) {
      toast.error("Trigger failed", String(e));
    } finally {
      agentsUi.triggeringAgent = null;
    }
  }

  function openCreate() {
    // New-agent creation now goes through the unified Builder flow.
    builderConfig = builderDefaultsFromSettings();
    builderAgentType = "persistent";
    builderPersistentName = "";
    builderPersistentSchedule = "";
    agentsUi.editingAgent = null;
    agentsUi.showForm = false;
    selectTab("builder");
  }

  async function deleteAgent(agent: GatewayRow) {
    deleteConfirmAgent = null;
    if (await agentsStore.remove(agent.agentId)) {
      const next = new Set(agentsUi.selected);
      next.delete(agent.agentId);
      agentsUi.selected = next;
      toast.success(`Deleted ${agent.name}`);
      await loadGatewayAgents();
    } else toast.error("Delete failed");
  }

  async function deleteAgentsBulk(agents: GatewayRow[]) {
    deleteConfirmBulk = null;
    if (agents.length === 0) return;
    const failed = await agentsStore.removeMany(agents);
    agentsUi.selected = new Set();
    await loadGatewayAgents();
    if (failed === 0) {
      toast.success(`Deleted ${agents.length} agent${agents.length === 1 ? "" : "s"}`);
    } else {
      toast.error(
        "Some deletes failed",
        `${failed} of ${agents.length} could not be removed. Refresh the list and try again.`,
      );
    }
  }

  function useConfigInBuilder(agent: GatewayRow) {
    builderConfig = builderConfigFromAgent(builderDefaultsFromSettings(), agent.config as BuilderAgentConfig);
    builderAgentType = agent.agentType === "gateway" ? "persistent" : "ad-hoc";
    builderPersistentName = agent.name;
    builderPersistentSchedule = agent.agentType === "gateway" ? (agent.schedule ?? "") : "";
    selectTab("builder");
    toast.success("Config loaded into Builder", agent.name);
  }

  // ── Skills ────────────────────────────────────────────────────────────
  const skillsStore = createLabSkillsStore(CORTEX_SERVER_URL);
  let skillsUi = $state(emptySkillsUi());

  /** Tab bar with counts (saved agents, skills, prompts; the tool catalog counts itself in its tab). */
  const tabItems = $derived(
    LAB_TABS.map((t) => {
      const count =
        t.id === "agents" ? $agentsStore.agents.length
        : t.id === "skills" ? skillCatalogRows($skillsStore.workspaceSkills, $skillsStore.skills, "").filter((r) => r.t !== "hdr").length
        : t.id === "prompts" ? $promptStore.length
        : undefined;
      return count === undefined ? t : { ...t, count };
    }),
  );
  let deleteConfirmSkill = $state<SkillRow | null>(null);

  async function deleteSkill(skill: SkillRow) {
    deleteConfirmSkill = null;
    if (!skill.id) {
      toast.warning("Cannot delete skill without id");
      return;
    }

    try {
      const r = await skillsStore.remove(skill.id);
      if (r.ok) {
        toast.success(`Deleted ${skill.name ?? "skill"}`);
        // Reload skills list
        await skillsStore.reloadDb();
      } else {
        toast.error("Delete failed", r.error);
      }
    } catch (e) {
      toast.error("Delete failed", String(e));
    }
  }

  /** Skills discovery scope of the Builder's agent: its workspace and skills settings. */
  const builderSkillScope = $derived(skillScopeOf(builderConfig));

  onMount(() => {
    settings.init();
    // `#gateway` (the old name) opens Saved agents and is rewritten to `#agents`.
    const fromHash = labTabFromHash(window.location.hash);
    if (fromHash) selectTab(fromHash);

    function onTabSwitch(e: Event) {
      const tab = normalizeLabTab((e as CustomEvent<string>).detail);
      if (tab) selectTab(tab);
    }
    function onHashChange() {
      selectTab(labTabFromHash(window.location.hash) ?? "builder");
    }
    window.addEventListener("cortex:lab-tab", onTabSwitch);
    window.addEventListener("hashchange", onHashChange);

    void loadGatewayAgents();
    void skillsStore.loadInitial(builderSkillScope);
    void promptStore.load();
    void loadCapabilities()
      .then((m) => (strategyLabels = new Map(m.strategies.map((s) => [s.name, s.label]))))
      .catch(() => {});

    // Edit & Rerun: ?fromRun=<id> prefills the builder from that run's stored
    // launch snapshot, merged OVER the current defaults so a snapshot that
    // predates a new config field keeps that field's default.
    const fromRun = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("fromRun") : null;
    if (fromRun) {
      selectTab("builder");
      void fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(fromRun)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((run: { launchParams?: Record<string, unknown> } | null) => {
          if (run?.launchParams) builderConfig = prefillFromSnapshot(builderConfig, run.launchParams);
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener("cortex:lab-tab", onTabSwitch);
      window.removeEventListener("hashchange", onHashChange);
    };
  });
</script>


<svelte:head><title>Lab · Cortex</title></svelte:head>

<!-- Hidden file input behind the header's Import -->
<input bind:this={importInput} type="file" accept=".json,application/json" class="hidden" aria-hidden="true" tabindex="-1" onchange={importBuilderFile} />

<!-- Opaque canvas: the engineering grid shows only on the header band (spec 5.2). -->
<CortexDeskShell class="bg-canvas">
<div class="lab">
  <PageHeader title="Lab" description="Build an agent, save it, and run it here or as a gateway process.">
    {#snippet actions()}
      <Button variant="ghost" icon="download" onclick={() => importInput?.click()}>Import</Button>
      <Button variant="ghost" icon="external" onclick={() => (exportTarget = { config: builderConfig, name: builderPersistentName.trim() || "agent" })}>Export</Button>
      <Button variant="ghost" icon="file" onclick={loadExample}>Load example</Button>
    {/snippet}
  </PageHeader>

  <div class="lab-tabs">
    <Tabs
      items={tabItems}
      value={activeTab}
      label="Lab sections"
      idBase="lab"
      onchange={(id) => { const t = normalizeLabTab(id); if (t) selectTab(t); }}
    />
  </div>

  <div class="lab-panel" role="tabpanel" id={tabPanelId("lab", activeTab)} aria-labelledby={tabId("lab", activeTab)}>
  <!-- ── BUILDER ─────────────────────────────────────────────────────── -->
  {#if activeTab === "builder"}
    <BuilderTab
      bind:config={builderConfig}
      bind:agentType={builderAgentType}
      bind:name={builderPersistentName}
      bind:schedule={builderPersistentSchedule}
      bind:section={builderSection}
      running={builderRunning}
      saving={builderSaving}
      strategyLabel={builderStrategyLabel}
      onAction={executeBuilderAdHocAction}
      onCreatePersistent={() => createAgentFromBuilder(false)}
    />

  <!-- ── SAVED AGENTS (#agents, alias #gateway) ──────────────────────── -->
  {:else if activeTab === "agents"}
    <SavedAgentsTab
      store={agentsStore}
      bind:ui={agentsUi}
      defaults={builderDefaultsFromSettings}
      onReload={loadGatewayAgents}
      onNewAgent={openCreate}
      onTrigger={triggerAgent}
      onUseInBuilder={useConfigInBuilder}
      onExport={(target) => (exportTarget = target)}
      onDelete={(agent) => (deleteConfirmAgent = agent)}
      onDeleteMany={(agents) => (deleteConfirmBulk = agents)}
    />

  <!-- ── SKILLS (workshop layout: catalog | document | meta) ─────────── -->
  {:else if activeTab === "skills"}
    <SkillsTab
      store={skillsStore}
      bind:ui={skillsUi}
      scope={builderSkillScope}
      onDelete={(skill) => (deleteConfirmSkill = skill)}
    />

  <!-- ── PROMPTS (reusable prompt library manager) ─────────────────────── -->
  {:else if activeTab === "prompts"}
    <div class="lab-pad">
      <PromptManager />
    </div>

  <!-- ── TOOLS (unified catalog + create tool: custom + MCP) ───────────── -->
  {:else}
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
      <ToolWorkshop serverUrl={CORTEX_SERVER_URL} />
    </div>
  {/if}
</div>
</div>
</CortexDeskShell>

<style>
  .lab {
    position: relative;
    z-index: 1;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .lab :global(.cx-page-h) { padding-bottom: 8px; }
  .lab-tabs { padding: 0 32px; flex: none; }
  .lab-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .lab-pad { flex: 1; min-height: 0; overflow: hidden; padding: 20px 32px; }
</style>

{#if exportTarget}
  <AgentExportModal
    config={exportTarget.config}
    name={exportTarget.name}
    onClose={() => (exportTarget = null)}
  />
{/if}

{#if deleteConfirmAgent}
  <ConfirmModal
    title="Delete {deleteConfirmAgent.name}"
    message="This permanently deletes this agent and its saved configuration. This cannot be undone."
    confirmLabel="Delete"
    onConfirm={() => deleteAgent(deleteConfirmAgent!)}
    onCancel={() => (deleteConfirmAgent = null)}
  />
{/if}

{#if deleteConfirmBulk && deleteConfirmBulk.length > 0}
  <ConfirmModal
    title="Delete {deleteConfirmBulk.length} agent{deleteConfirmBulk.length === 1 ? '' : 's'}?"
    message={bulkDeleteConfirmMessage(deleteConfirmBulk)}
    confirmLabel="Delete all"
    onConfirm={() => void deleteAgentsBulk(deleteConfirmBulk!)}
    onCancel={() => (deleteConfirmBulk = null)}
  />
{/if}

{#if deleteConfirmSkill}
  <ConfirmModal
    title="Delete {deleteConfirmSkill.name ?? 'Skill'}"
    message="This permanently deletes this skill from the database. This cannot be undone."
    confirmLabel="Delete"
    onConfirm={() => deleteSkill(deleteConfirmSkill!)}
    onCancel={() => (deleteConfirmSkill = null)}
  />
{/if}

<ParamFillModal
  open={showParamModal}
  variables={builderConfig.variables ?? []}
  previewPayload={{
    prompt: builderConfig.prompt,
    systemPrompt: builderConfig.systemPrompt,
    taskContext: builderConfig.taskContext,
  }}
  onConfirm={(values) => { showParamModal = false; void launchRun(values); }}
  onCancel={() => (showParamModal = false)}
/>

<ParamFillModal
  open={triggerModalAgent !== null}
  variables={triggerModalAgent?.config.variables ?? []}
  previewPayload={{
    prompt: triggerModalAgent?.config.prompt,
    systemPrompt: triggerModalAgent?.config.systemPrompt,
    taskContext: triggerModalAgent?.config.taskContext,
  }}
  onConfirm={(values) => {
    const agent = triggerModalAgent;
    triggerModalAgent = null;
    if (agent) void doTrigger(agent, values);
  }}
  onCancel={() => (triggerModalAgent = null)}
/>

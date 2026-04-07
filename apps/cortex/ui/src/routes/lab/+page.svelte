<script lang="ts">
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import { type AgentConfig, defaultConfig } from "$lib/types/agent-config.js";
  import { settings } from "$lib/stores/settings.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { goto } from "$app/navigation";
  import MarkdownRich from "$lib/components/MarkdownRich.svelte";
  import ToolWorkshop from "$lib/components/ToolWorkshop.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import { cortexRunsPostBody } from "$lib/cortex-runs-post-body.js";

  type SkillRow  = { id?: string; name?: string; description?: string; content?: string };
  type GatewayRow = {
    agentId: string; name: string; config: AgentConfig;
    status: string; runCount: number; lastRunAt?: number; schedule?: string;
    agentType: "gateway" | "ad-hoc";
    processRunning?: boolean;
  };
  type BuilderAgentConfig = AgentConfig & {
    maxTokens: number;
    timeout: number;
    retryPolicy: { enabled: boolean; maxRetries: number; backoffMs: number };
    cacheTimeout: number;
    progressCheckpoint: number;
    fallbacks: { enabled: boolean; providers: string[]; errorThreshold: number };
    metaTools: { enabled: boolean; brief: boolean; find: boolean; pulse: boolean; recall: boolean; harnessSkill: boolean };
    observabilityVerbosity: "off" | "minimal" | "normal" | "verbose";
    mcpServerIds: string[];
    agentTools: import("$lib/types/agent-config.js").CortexAgentToolConfig[];
    dynamicSubAgents: { enabled: boolean; maxIterations: number };
  };

  /** Base config for Builder / forms: static defaults + Cortex Settings default provider/model. */
  function builderDefaultsFromSettings(): BuilderAgentConfig {
    const s = settings.get();
    const base = defaultConfig() as BuilderAgentConfig;
    return {
      ...base,
      provider: s.defaultProvider,
      model: s.defaultModel,
    };
  }

  let activeTab = $state<"builder" | "gateway" | "skills" | "tools">("builder");

  // ── Quick Run builder ─────────────────────────────────────────────────
  let builderConfig = $state<BuilderAgentConfig>(builderDefaultsFromSettings());
  let builderAgentType = $state<"ad-hoc" | "persistent">("ad-hoc");
  let builderPersistentName = $state("");
  let builderPersistentSchedule = $state("");
  let builderRunning = $state(false);
  let builderSaving = $state(false);

  async function runFromBuilder() {
    if (!builderConfig.prompt.trim()) return;
    builderRunning = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cortexRunsPostBody(builderConfig.prompt.trim(), builderConfig)),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { runId?: string };
      if (data.runId) void goto(`/run/${data.runId}`);
      else toast.info("Agent started — check Beacon");
    } catch (e) {
      toast.error("Run failed", String(e));
    } finally { builderRunning = false; }
  }

  async function createAgentFromBuilder(runNow: boolean) {
    if (!builderPersistentName.trim()) {
      toast.warning("Name is required");
      return;
    }
    if (runNow && builderAgentType === "ad-hoc" && !builderConfig.prompt.trim()) {
      toast.warning("Add a prompt first", "Save & run uses the prompt stored on the agent.");
      return;
    }
    builderSaving = true;
    try {
      const type = builderAgentType === "persistent" ? "gateway" : "ad-hoc";
      const res = await fetch(`${CORTEX_SERVER_URL}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: builderPersistentName.trim(),
          type,
          runNow: builderAgentType === "ad-hoc" ? runNow : false,
          config: { ...builderConfig, prompt: builderConfig.prompt.trim() },
          schedule: builderAgentType === "persistent" ? (builderPersistentSchedule.trim() || null) : null,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { runId?: string };
      toast.success(`${builderAgentType === "persistent" ? "Gateway" : "Ad-hoc"} agent created`, builderPersistentName.trim());
      await loadGatewayAgents();
      if (data.runId) {
        void goto(`/run/${data.runId}`);
      } else {
        activeTab = "gateway";
      }
    } catch (e) {
      toast.error("Create failed", String(e));
    } finally {
      builderSaving = false;
    }
  }

  // ── Gateway agents ────────────────────────────────────────────────────
  let gatewayAgents = $state<GatewayRow[]>([]);
  let gatewayLoading = $state(false);
  let showForm = $state(false);
  let editingAgent = $state<GatewayRow | null>(null);
  let deleteConfirmAgent = $state<GatewayRow | null>(null);

  let formConfig   = $state<BuilderAgentConfig>(builderDefaultsFromSettings());
  let formName     = $state("");
  let formSchedule = $state("");
  let formAgentType = $state<"gateway" | "ad-hoc">("gateway");
  let formSaving   = $state(false);
  let triggeringAgent = $state<string | null>(null);

  // Friendly schedule presets → cron expressions
  const SCHEDULE_PRESETS = [
    { label: "Every minute",    cron: "* * * * *"    },
    { label: "Every 5 minutes", cron: "*/5 * * * *"  },
    { label: "Every 15 minutes",cron: "*/15 * * * *" },
    { label: "Every hour",      cron: "0 * * * *"    },
    { label: "Every day 9am",   cron: "0 9 * * *"    },
    { label: "Every Mon 9am",   cron: "0 9 * * MON"  },
    { label: "Every weekday 9am",cron:"0 9 * * 1-5"  },
    { label: "First of month",  cron: "0 9 1 * *"    },
  ];

  async function triggerAgent(agent: GatewayRow) {
    triggeringAgent = agent.agentId;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/agents/${agent.agentId}/trigger`, { method: "POST" });
      const data = await res.json() as { runId?: string; error?: string };
      if (res.ok) {
        toast.success(`${agent.name} triggered`, "Run started");
        if (data.runId) void goto(`/run/${data.runId}`);
        await loadGatewayAgents();
      } else {
        toast.error("Trigger failed", data.error ?? `Server returned ${res.status}`);
      }
    } catch (e) {
      toast.error("Trigger failed", String(e));
    } finally {
      triggeringAgent = null;
    }
  }

  async function loadGatewayAgents() {
    gatewayLoading = true;
    try {
      const agentsRes = await fetch(`${CORTEX_SERVER_URL}/api/agents`);
      const defaults = builderDefaultsFromSettings();

      const agentsRaw = agentsRes.ok ? (await agentsRes.json() as Array<Omit<GatewayRow, "agentType"> & { type?: "gateway" | "ad-hoc" }>) : [];
      gatewayAgents = agentsRaw.map((agent) => ({
        ...agent,
        config: { ...defaults, ...(agent.config ?? {}) },
        agentType: (agent.type === "ad-hoc" || agent.agentId.startsWith("agent-")) ? "ad-hoc" : "gateway",
      }));
    } catch { gatewayAgents = []; }
    finally { gatewayLoading = false; }
  }

  function openCreate() {
    // New-agent creation now goes through the unified Builder flow.
    builderConfig = builderDefaultsFromSettings();
    builderAgentType = "persistent";
    builderPersistentName = "";
    builderPersistentSchedule = "";
    editingAgent = null;
    showForm = false;
    activeTab = "builder";
  }

  function openEdit(agent: GatewayRow) {
    formConfig = { ...builderDefaultsFromSettings(), ...agent.config };
    formName = agent.name; formSchedule = agent.schedule ?? "";
    formAgentType = agent.agentType;
    editingAgent = agent; showForm = true;
  }

  async function saveAgent() {
    if (!formName.trim()) { toast.warning("Name is required"); return; }
    formSaving = true;
    try {
      const url = editingAgent
        ? `${CORTEX_SERVER_URL}/api/agents/${editingAgent.agentId}`
        : `${CORTEX_SERVER_URL}/api/agents`;
      const res = await fetch(url, {
        method: editingAgent ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          type: formAgentType,
          config: { ...formConfig, prompt: formConfig.prompt.trim() },
          schedule: formAgentType === "gateway" ? (formSchedule.trim() || null) : null,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      toast.success(editingAgent ? "Agent updated" : "Agent created");
      showForm = false;
      await loadGatewayAgents();
    } catch (e) {
      toast.error("Save failed", String(e));
    } finally { formSaving = false; }
  }

  async function deleteAgent(agent: GatewayRow) {
    deleteConfirmAgent = null;
    const res = await fetch(`${CORTEX_SERVER_URL}/api/agents/${agent.agentId}`, { method: "DELETE" });
    if (res.ok) { toast.success(`Deleted ${agent.name}`); await loadGatewayAgents(); }
    else toast.error("Delete failed");
  }

  async function toggleStatus(agent: GatewayRow) {
    const newStatus = agent.status === "active" ? "paused" : "active";
    await fetch(`${CORTEX_SERVER_URL}/api/agents/${agent.agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    await loadGatewayAgents();
  }

  async function useConfigInBuilder(agent: GatewayRow) {
    const defaults = builderDefaultsFromSettings();
    const sourceConfig = agent.config as BuilderAgentConfig;
    builderConfig = {
      ...defaults,
      ...sourceConfig,
      memory: { ...defaults.memory, ...sourceConfig.memory },
      guardrails: { ...defaults.guardrails, ...sourceConfig.guardrails },
      persona: { ...defaults.persona, ...sourceConfig.persona },
      retryPolicy: { ...defaults.retryPolicy, ...sourceConfig.retryPolicy },
      metaTools: { ...defaults.metaTools, ...sourceConfig.metaTools },
      fallbacks: {
        ...defaults.fallbacks,
        ...sourceConfig.fallbacks,
        providers: [...(sourceConfig.fallbacks?.providers ?? defaults.fallbacks.providers)],
      },
      mcpServerIds: [...(sourceConfig.mcpServerIds ?? defaults.mcpServerIds)],
      agentTools: [...(sourceConfig.agentTools ?? defaults.agentTools)],
      dynamicSubAgents: {
        ...defaults.dynamicSubAgents,
        ...sourceConfig.dynamicSubAgents,
      },
      taskContext: { ...defaults.taskContext, ...(sourceConfig.taskContext ?? {}) },
      healthCheck: sourceConfig.healthCheck ?? defaults.healthCheck,
      skills: {
        paths: [...(sourceConfig.skills?.paths ?? defaults.skills.paths)],
        ...(sourceConfig.skills?.evolution
          ? { evolution: { ...sourceConfig.skills.evolution } }
          : {}),
      },
    };
    builderAgentType = agent.agentType === "gateway" ? "persistent" : "ad-hoc";
    builderPersistentName = agent.name;
    builderPersistentSchedule = agent.agentType === "gateway" ? (agent.schedule ?? "") : "";
    activeTab = "builder";
    toast.success("Config loaded into Builder", agent.name);
  }

  // ── Skills / Tools ────────────────────────────────────────────────────
  let skills = $state<SkillRow[]>([]);
  /** Relative dirs on disk from GET /api/skills/discover (framework `withSkills` hints). */
  let discoveredSkillPaths = $state<string[]>([]);

  type FsSkillSummary = {
    source: "filesystem";
    relPath: string;
    skillDir: string;
    name: string;
    description: string;
  };
  type SkillDetail = {
    name: string;
    description: string;
    instructions: string;
    metadata: Record<string, unknown>;
    filePath: string;
    resources: { scripts: string[]; references: string[]; assets: string[] };
    declaredFields?: Record<string, unknown>;
  };
  type SkillListSelection =
    | { kind: "filesystem"; relPath: string }
    | { kind: "sqlite"; id: string };

  let fsSkillSummaries = $state<FsSkillSummary[]>([]);
  let skillCatalogFilter = $state("");
  let skillListSelection = $state<SkillListSelection | null>(null);
  let skillDetail = $state<SkillDetail | null>(null);
  let skillDetailLoading = $state(false);
  let skillDetailError = $state<string | null>(null);

  async function loadSkillDiscover() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/skills/discover`);
      discoveredSkillPaths = res.ok ? ((await res.json()) as { paths?: string[] }).paths ?? [] : [];
    } catch {
      discoveredSkillPaths = [];
    }
  }

  async function loadFsSkillSummaries() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/skills/files`);
      const data = res.ok ? ((await res.json()) as { skills?: FsSkillSummary[] }) : {};
      fsSkillSummaries = data.skills ?? [];
    } catch {
      fsSkillSummaries = [];
    }
  }

  type SkillCatalogRow =
    | { t: "hdr"; label: string }
    | { t: "fs"; s: FsSkillSummary }
    | { t: "sql"; s: SkillRow; rowKey: string };

  /** Single scroll list: section headers + disk skills + SQLite rows (workshop catalog). */
  const skillCatalogRows = $derived.by((): SkillCatalogRow[] => {
    const q = skillCatalogFilter;
    const match = (name: string, desc: string) => {
      const qq = q.trim().toLowerCase();
      if (!qq) return true;
      return name.toLowerCase().includes(qq) || desc.toLowerCase().includes(qq);
    };
    const rows: SkillCatalogRow[] = [];
    const fsFiltered = fsSkillSummaries.filter((x) => match(x.name, x.description));
    const sqlFiltered = skills.filter((s) =>
      match(String(s.name ?? ""), String(s.description ?? "")),
    );
    if (fsFiltered.length > 0) {
      rows.push({ t: "hdr", label: "On disk" });
      for (const s of fsFiltered) rows.push({ t: "fs", s });
    }
    if (sqlFiltered.length > 0) {
      rows.push({ t: "hdr", label: "SQLite (desk DB)" });
      for (let i = 0; i < sqlFiltered.length; i++) {
        const s = sqlFiltered[i]!;
        rows.push({ t: "sql", s, rowKey: `sql-${String(s.id ?? `i${i}`)}` });
      }
    }
    return rows;
  });

  async function loadSkillDetail(sel: SkillListSelection) {
    skillListSelection = sel;
    skillDetailLoading = true;
    skillDetailError = null;
    skillDetail = null;
    try {
      if (sel.kind === "filesystem") {
        const res = await fetch(
          `${CORTEX_SERVER_URL}/api/skills/file?path=${encodeURIComponent(sel.relPath)}`,
        );
        const data = (await res.json()) as SkillDetail & { error?: string };
        if (!res.ok) {
          skillDetailError = data.error ?? `HTTP ${res.status}`;
          return;
        }
        skillDetail = data;
      } else {
        const res = await fetch(`${CORTEX_SERVER_URL}/api/skills/sqlite/${encodeURIComponent(sel.id)}`);
        const data = (await res.json()) as SkillDetail & { error?: string };
        if (!res.ok) {
          skillDetailError = data.error ?? `HTTP ${res.status}`;
          return;
        }
        skillDetail = data;
      }
    } catch (e) {
      skillDetailError = String(e);
    } finally {
      skillDetailLoading = false;
    }
  }

  function selectFilesystemSkill(s: FsSkillSummary) {
    void loadSkillDetail({ kind: "filesystem", relPath: s.relPath });
  }

  function selectSqliteSkill(s: SkillRow) {
    const id = s.id != null ? String(s.id) : "";
    if (!id) {
      toast.warning("This row has no id", "Cannot load SQLite skill detail.");
      return;
    }
    void loadSkillDetail({ kind: "sqlite", id });
  }

  function isFsSkillSelected(s: FsSkillSummary): boolean {
    return skillListSelection?.kind === "filesystem" && skillListSelection.relPath === s.relPath;
  }

  function isSqliteSkillSelected(s: SkillRow): boolean {
    const id = s.id != null ? String(s.id) : "";
    return skillListSelection?.kind === "sqlite" && id !== "" && skillListSelection.id === id;
  }

  function formatYamlValue(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function appendPathsToBuilderLivingSkills(paths: string[]) {
    const add = paths.map((p) => p.trim()).filter((p) => p.length > 0);
    if (add.length === 0) return;
    const next = new Set([...(builderConfig.skills?.paths ?? []), ...add]);
    builderConfig = { ...builderConfig, skills: { ...builderConfig.skills, paths: [...next] } };
    activeTab = "builder";
    toast.success("Living skills updated", `${add.length} path(s) — expand Agent config → Living skills`);
  }

  function skillPathInBuilder(p: string): boolean {
    return (builderConfig.skills?.paths ?? []).includes(p);
  }

  $effect(() => {
    if (activeTab === "skills") {
      void loadSkillDiscover();
      void loadFsSkillSummaries();
    }
  });

  function relativeTime(ts?: number) {
    if (!ts) return "never";
    const d = Date.now() - ts;
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.round(d/60000)}m ago`;
    return `${Math.round(d/3600000)}h ago`;
  }

  onMount(() => {
    settings.init();
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h === "#gateway") activeTab = "gateway";
    else if (h === "#skills") activeTab = "skills";
    else if (h === "#tools")  activeTab = "tools";

    function onTabSwitch(e: Event) {
      const tab = (e as CustomEvent<string>).detail as typeof activeTab;
      if (tab === "builder" || tab === "gateway" || tab === "skills" || tab === "tools") {
        activeTab = tab;
      }
    }
    window.addEventListener("cortex:lab-tab", onTabSwitch);

    void loadGatewayAgents();
    void Promise.all([
      fetch(`${CORTEX_SERVER_URL}/api/skills`).then(r => r.ok ? r.json() : []).then(j => { skills = j; }).catch(() => {}),
      fetch(`${CORTEX_SERVER_URL}/api/skills/files`).then(r => r.ok ? r.json() : { skills: [] }).then((j: { skills?: FsSkillSummary[] }) => { fsSkillSummaries = j.skills ?? []; }).catch(() => {}),
    ]);

    return () => window.removeEventListener("cortex:lab-tab", onTabSwitch);
  });
</script>

<svelte:head><title>CORTEX — Lab</title></svelte:head>

<CortexDeskShell>
<div class="relative z-10 flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4 sm:p-6">
  <header class="flex flex-shrink-0 items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="font-display text-2xl font-light tracking-tight text-on-surface">
        Agent <span class="font-semibold text-primary">Lab</span>
      </h1>
      <p class="mt-1 max-w-3xl font-mono text-[10px] leading-relaxed text-outline">
        Build, persist, and operate Cortex agents with one control surface for config, skills, and tool wiring.
      </p>
    </div>
    <a href="/runs" class="flex items-center gap-1 font-mono text-[11px] text-cyan-700 no-underline transition-colors hover:text-primary dark:text-secondary">
      <span class="material-symbols-outlined text-sm">timeline</span> Trace
    </a>
  </header>

  <div class="grid flex-shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
    <div class="rounded-lg border border-outline-variant/15 bg-surface-container-low/65 px-3 py-2 font-mono text-[10px]">
      <div class="text-outline/45">Saved agents</div>
      <div class="mt-0.5 text-primary">{gatewayAgents.length}</div>
    </div>
    <div class="rounded-lg border border-outline-variant/15 bg-surface-container-low/65 px-3 py-2 font-mono text-[10px]">
      <div class="text-outline/45">Active tab</div>
      <div class="mt-0.5 text-on-surface">{activeTab}</div>
    </div>
    <div class="rounded-lg border border-outline-variant/15 bg-surface-container-low/65 px-3 py-2 font-mono text-[10px]">
      <div class="text-outline/45">Builder mode</div>
      <div class="mt-0.5 text-secondary">{builderAgentType === "persistent" ? "persistent" : "ad-hoc"}</div>
    </div>
    <div class="rounded-lg border border-outline-variant/15 bg-surface-container-low/65 px-3 py-2 font-mono text-[10px]">
      <div class="text-outline/45">Skill roots</div>
      <div class="mt-0.5 text-on-surface">{discoveredSkillPaths.length}</div>
    </div>
  </div>

  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low/25 p-3 shadow-[0_10px_40px_-24px_rgba(139,92,246,0.45)] backdrop-blur-[4px]">
  <!-- Tabs -->
  <div class="flex flex-shrink-0 items-center gap-2 border-b border-primary/15 pb-2 dark:border-outline-variant/20">
    {#each [
      { id: "builder", label: "Builder", icon: "build" },
      { id: "gateway", label: "Agents", icon: "hub", badge: gatewayAgents.length },
      { id: "skills",  label: "Skills",  icon: "psychology" },
      { id: "tools",   label: "Tools",   icon: "construction" },
    ] as tab}
      <button type="button"
        class="flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors
               {activeTab === tab.id
          ? 'border-primary/35 bg-primary/12 text-primary'
          : 'border-outline-variant/20 text-outline hover:border-primary/25 hover:text-primary'}"
        onclick={() => (activeTab = tab.id as typeof activeTab)}>
        <span class="material-symbols-outlined text-sm">{tab.icon}</span>{tab.label}
        {#if (tab as any).badge > 0}
          <span class="text-[8px] font-mono bg-primary/15 text-primary px-1 rounded">{(tab as any).badge}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- ── BUILDER ─────────────────────────────────────────────────────── -->
  {#if activeTab === "builder"}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="max-w-2xl mx-auto space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <label class="flex cursor-pointer items-center gap-2 rounded border border-outline-variant/20 bg-surface-container-low/40 p-2 transition-colors hover:border-primary/40">
            <input
              type="radio"
              name="builder-agent-type"
              checked={builderAgentType === "ad-hoc"}
              onchange={() => (builderAgentType = "ad-hoc")}
              class="accent-primary"
            />
            <span class="font-mono text-[10px] text-on-surface/80">Ad-hoc (saved, on-demand)</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2 rounded border border-outline-variant/20 bg-surface-container-low/40 p-2 transition-colors hover:border-primary/40">
            <input
              type="radio"
              name="builder-agent-type"
              checked={builderAgentType === "persistent"}
              onchange={() => (builderAgentType = "persistent")}
              class="accent-primary"
            />
            <span class="font-mono text-[10px] text-on-surface/80">Persistent (gateway process)</span>
          </label>
        </div>

        <div>
          <label for="builder-prompt" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">Prompt</label>
          <textarea id="builder-prompt" bind:value={builderConfig.prompt}
            placeholder="Describe what you want the agent to do…" rows="3"
            class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-4 py-3
                   text-sm font-mono text-on-surface placeholder:text-outline/40 resize-none focus:border-primary/50 focus:outline-none">
          </textarea>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class={builderAgentType === "persistent" ? "" : "col-span-2"}>
            <label for="builder-persistent-name" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">Name *</label>
            <input
              id="builder-persistent-name"
              bind:value={builderPersistentName}
              placeholder={builderAgentType === "persistent" ? "my-gateway-agent" : "my-ad-hoc-agent"}
              class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
            />
          </div>
          {#if builderAgentType === "persistent"}
            <div>
              <label for="builder-persistent-schedule" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">
                Schedule <span class="text-outline/30 normal-case font-normal">(optional cron)</span>
              </label>
              <input
                id="builder-persistent-schedule"
                bind:value={builderPersistentSchedule}
                placeholder="*/5 * * * *"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
              />
            </div>
          {/if}
        </div>

        <AgentConfigPanel bind:config={builderConfig} />
        <div class="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {#if builderAgentType === "ad-hoc"}
            <p class="w-full text-[10px] font-mono text-outline/55 sm:mr-auto sm:w-auto sm:max-w-[22rem]">
              Save stores this blueprint under Agents. <span class="text-on-surface/70">Run without saving</span> tries the current form without writing.
            </p>
            <div class="flex flex-wrap items-stretch justify-end gap-2">
              <button type="button" disabled={!builderConfig.prompt.trim() || builderRunning} onclick={runFromBuilder}
                class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-outline-variant/25 bg-surface-container-low/40 cursor-pointer font-mono
                       text-[10px] uppercase tracking-wider text-outline disabled:opacity-40 hover:border-primary/35 hover:text-on-surface transition-all">
                {#if builderRunning}
                  <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                {:else}
                  <span class="material-symbols-outlined text-sm">science</span>
                {/if}
                Run without saving
              </button>
              <button type="button" disabled={!builderPersistentName.trim() || builderSaving} onclick={() => createAgentFromBuilder(false)}
                class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-outline-variant/30 bg-transparent cursor-pointer font-mono
                       text-[10px] uppercase tracking-wider text-on-surface/90 disabled:opacity-40 hover:border-primary/40 transition-all">
                {#if builderSaving}
                  <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                {:else}
                  <span class="material-symbols-outlined text-sm">bookmark_add</span>
                {/if}
                Save only
              </button>
              <button type="button"
                disabled={!builderPersistentName.trim() || !builderConfig.prompt.trim() || builderSaving}
                onclick={() => createAgentFromBuilder(true)}
                title={!builderConfig.prompt.trim() ? "Add a prompt above — it is stored on the agent and used for the first run." : undefined}
                class="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border-0 cursor-pointer font-mono
                       text-[11px] uppercase tracking-wider text-white disabled:opacity-40 hover:brightness-110 transition-all"
                style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);box-shadow:0 0 16px rgba(139,92,246,.3);">
                {#if builderSaving}
                  <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                {:else}
                  <span class="material-symbols-outlined text-sm">rocket_launch</span>
                {/if}
                Save &amp; run
              </button>
            </div>
          {:else}
            <button type="button" disabled={!builderPersistentName.trim() || builderSaving} onclick={() => createAgentFromBuilder(false)}
              class="flex items-center gap-2 px-6 py-2.5 rounded-lg border-0 cursor-pointer font-mono
                     text-[11px] uppercase tracking-wider text-white disabled:opacity-40 hover:brightness-110 transition-all"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);box-shadow:0 0 16px rgba(139,92,246,.3);">
              {#if builderSaving}
                <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              {:else}
                <span class="material-symbols-outlined text-sm">save</span>
              {/if}
              Create Gateway Agent
            </button>
          {/if}
        </div>
      </div>
    </div>

  <!-- ── GATEWAY ─────────────────────────────────────────────────────── -->
  {:else if activeTab === "gateway"}
    {#if showForm}
      <div class="flex-1 overflow-y-auto min-h-0">
        <div class="max-w-2xl mx-auto space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="font-headline text-base font-semibold text-on-surface">
              {editingAgent
                ? (formAgentType === "gateway" ? "Edit Gateway Agent" : "Edit Ad-hoc Agent")
                : "New Gateway Agent"}
            </h2>
            <button type="button" onclick={() => (showForm = false)}
              class="material-symbols-outlined text-outline hover:text-primary bg-transparent border-0 cursor-pointer">close</button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="gateway-agent-name" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">Name *</label>
              <input id="gateway-agent-name" bind:value={formName} placeholder="my-gateway-agent"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none" />
            </div>
            {#if formAgentType === "gateway"}
              <div>
                <label for="gateway-agent-schedule" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">
                  Schedule <span class="text-outline/30 normal-case font-normal">(preset or cron, blank = manual)</span>
                </label>
                <!-- Friendly presets -->
                <div class="flex flex-wrap gap-1 mb-1.5">
                  {#each SCHEDULE_PRESETS as preset}
                    <button type="button"
                      onclick={() => (formSchedule = preset.cron)}
                      class="text-[8px] font-mono px-1.5 py-0.5 rounded border cursor-pointer transition-colors
                             {formSchedule === preset.cron ? 'bg-primary/15 border-primary/40 text-primary' : 'border-outline-variant/20 text-outline/50 hover:border-primary/30 hover:text-primary'}">
                      {preset.label}
                    </button>
                  {/each}
                  {#if formSchedule && !SCHEDULE_PRESETS.some(p => p.cron === formSchedule)}
                    <span class="text-[8px] font-mono text-outline/30 self-center">custom:</span>
                  {/if}
                </div>
                <input id="gateway-agent-schedule" bind:value={formSchedule} placeholder="*/5 * * * *  or leave blank for manual"
                  class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none" />
                {#if formSchedule}
                  <p class="text-[9px] font-mono text-secondary/50 mt-1">
                    Agent process will start immediately and fire on this schedule.
                  </p>
                {:else}
                  <p class="text-[9px] font-mono text-outline/30 mt-1">
                    No schedule — use "Trigger Now" to run manually.
                  </p>
                {/if}
              </div>
            {:else}
              <div class="flex flex-col justify-end pb-2">
                <p class="text-[9px] font-mono text-outline/40">
                  Ad-hoc agents run on demand only (Trigger Now or API). No schedule.
                </p>
              </div>
            {/if}
          </div>
          <div>
            <label for="gateway-edit-prompt" class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1.5">
              Prompt <span class="text-outline/30 normal-case font-normal">(default task — same as Builder tab)</span>
            </label>
            <textarea id="gateway-edit-prompt" bind:value={formConfig.prompt}
              placeholder="Describe what this agent should do when triggered or on schedule…" rows="3"
              class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-4 py-3
                     text-sm font-mono text-on-surface placeholder:text-outline/40 resize-none focus:border-primary/50 focus:outline-none">
            </textarea>
            <p class="text-[9px] font-mono text-outline/35 mt-1">
              Model-level instructions live in <span class="text-outline/50">Inference → System Prompt</span> below.
            </p>
          </div>
          <AgentConfigPanel bind:config={formConfig} />
          <div class="flex justify-end gap-3 pt-1">
            <button type="button" onclick={() => (showForm = false)}
              class="px-4 py-1.5 border border-outline-variant/20 text-outline font-mono text-[10px] uppercase rounded bg-transparent cursor-pointer hover:text-on-surface">
              Cancel</button>
            <button type="button" disabled={formSaving} onclick={saveAgent}
              class="px-6 py-1.5 rounded border-0 cursor-pointer font-mono text-[10px] uppercase text-white disabled:opacity-40 hover:brightness-110 transition-all"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
              {formSaving ? "Saving…" : editingAgent ? "Save Changes" : "Create Agent"}
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="mb-1 flex flex-shrink-0 items-center justify-between">
        <p class="text-[10px] font-mono text-outline/50">{gatewayAgents.length} agent{gatewayAgents.length !== 1 ? "s" : ""}</p>
        <button type="button" onclick={openCreate}
          class="flex items-center gap-1.5 px-4 py-1.5 rounded border-0 cursor-pointer font-mono text-[10px] uppercase text-white hover:brightness-110 transition-all"
          style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
          <span class="material-symbols-outlined text-sm">add</span> New Agent
        </button>
      </div>
      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {#if gatewayLoading}
          <div class="flex items-center justify-center h-20">
            <span class="material-symbols-outlined text-primary animate-spin">progress_activity</span>
          </div>
        {:else if gatewayAgents.length === 0}
          <div class="text-center py-12">
            <span class="material-symbols-outlined text-3xl text-outline/20 block mb-3">hub</span>
            <p class="font-mono text-xs text-outline/40">No agents yet.</p>
            <p class="font-mono text-[10px] text-outline/30 mt-1">Create gateway or ad-hoc saved agents from Builder.</p>
          </div>
        {:else}
          {#each gatewayAgents as agent (agent.agentId)}
            <div class="border border-outline-variant/15 rounded-lg bg-surface-container-low/40 p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span class="font-mono text-[12px] font-semibold text-on-surface/90">{agent.name}</span>
                    <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border
                                 {agent.agentType==='gateway' ? 'text-primary border-primary/30 bg-primary/8' : 'text-outline/60 border-outline-variant/25 bg-surface-container'}">
                      {agent.agentType === "gateway" ? "persistent" : "ad-hoc"}
                    </span>
                    <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border shadow-sm
                                 {agent.status === 'active'
                      ? 'text-cyan-800 dark:text-cyan-200 border-cyan-500/40 dark:border-cyan-500/45 bg-cyan-500/10 dark:bg-cyan-950/45 dark:shadow-none'
                      : agent.status === 'paused'
                        ? 'text-amber-950 dark:text-amber-500/95 border-amber-500/45 dark:border-amber-700/50 bg-amber-100/90 dark:bg-amber-950/50 dark:shadow-none'
                        : agent.status === 'stopped'
                          ? 'text-slate-700 dark:text-slate-300 border-slate-400/45 dark:border-slate-600/50 bg-slate-100/90 dark:bg-slate-900/55 dark:shadow-none'
                          : 'text-red-800 dark:text-red-200 border-red-400/45 dark:border-red-500/45 bg-red-500/10 dark:bg-red-950/40 dark:shadow-none'}">
                      {agent.status}</span>
                    {#if agent.schedule}
                      <span class="text-[9px] font-mono text-outline/40 bg-surface-container px-1.5 py-0.5 rounded">⏰ {agent.schedule}</span>
                    {/if}
                  </div>
                  <div class="flex items-center gap-2 text-[9px] font-mono text-outline/40 flex-wrap">
                    <span>{agent.config?.provider ?? "?"}/{agent.config?.model || "default"}</span>
                    <span>·</span><span>{agent.config?.strategy ?? "reactive"}</span>
                    <span>·</span><span>{agent.runCount} runs</span>
                    {#if agent.lastRunAt}<span>· last {relativeTime(agent.lastRunAt)}</span>{/if}
                  </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <!-- Run: gateway (manual fire vs cron) and ad-hoc (on-demand saved config) -->
                  <button type="button" onclick={() => triggerAgent(agent)}
                    disabled={triggeringAgent === agent.agentId || (agent.agentType === "gateway" && !!agent.processRunning)}
                    class="text-[9px] font-mono px-2 py-1 rounded border cursor-pointer bg-transparent transition-colors
                           border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={agent.agentType === "gateway" ? "Run now (ignores schedule)" : "Run now using saved config"}>
                    {triggeringAgent === agent.agentId ? "…" : "▶ Run"}
                  </button>
                  <button type="button" onclick={() => useConfigInBuilder(agent)}
                    class="text-[9px] font-mono px-2 py-1 rounded border cursor-pointer bg-transparent transition-colors
                           border-outline-variant/25 text-outline hover:text-primary hover:border-primary/30"
                    title="Copy this agent config to Builder">
                    Use in Builder
                  </button>
                  {#if agent.agentType === "gateway"}
                    <button type="button" onclick={() => toggleStatus(agent)}
                      class="text-[9px] font-mono px-2 py-1 rounded border cursor-pointer bg-transparent transition-colors
                             {agent.status==='active' ? 'border-tertiary/30 text-tertiary hover:bg-tertiary/10' : 'border-secondary/30 text-secondary hover:bg-secondary/10'}">
                      {agent.status==="active" ? "Pause" : "Activate"}</button>
                  {/if}
                  <button type="button" onclick={() => openEdit(agent)}
                    class="material-symbols-outlined text-sm text-outline hover:text-primary bg-transparent border-0 cursor-pointer p-1"
                    title="Edit agent">edit</button>
                  <button type="button" onclick={() => (deleteConfirmAgent = agent)}
                    class="material-symbols-outlined text-sm text-outline hover:text-error bg-transparent border-0 cursor-pointer p-1"
                    title="Delete agent">delete</button>
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}

  <!-- ── SKILLS (workshop layout: catalog | document | meta) ─────────── -->
  {:else if activeTab === "skills"}
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden gap-3">
      <header class="flex-shrink-0 flex flex-col gap-2 border-b border-outline-variant/15 pb-3">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="font-headline text-sm font-semibold text-on-surface tracking-tight">Skills workshop</h2>
            <p class="font-mono text-[10px] text-outline/55 mt-1 max-w-3xl leading-relaxed">
              Open Agent Skills use <code class="text-secondary/90">.agents/skills/&lt;skill-name&gt;/SKILL.md</code>
              (YAML + markdown). The desk scans <strong class="text-on-surface/75">your process cwd</strong> and
              <strong class="text-on-surface/75">the Cortex app folder</strong> for the roots below, so skills still appear if you start the API from an unexpected directory.
              Optional: set <code class="text-outline/50">CORTEX_SKILL_SCAN_ROOT</code> to add another base path.
            </p>
          </div>
          <button
            type="button"
            onclick={() => {
              void loadSkillDiscover();
              void loadFsSkillSummaries();
            }}
            class="text-[10px] font-mono px-3 py-1.5 rounded border border-outline-variant/25 text-outline hover:text-primary cursor-pointer bg-transparent shrink-0"
          >
            ↻ Rescan
          </button>
        </div>
      </header>

      <div
        class="grid flex-1 min-h-0 gap-0 overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low/20
               grid-cols-1 md:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(220px,260px)]"
      >
        <!-- 1 — Catalog -->
        <aside
          class="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-outline-variant/15 bg-surface-container-low/30"
        >
          <div class="p-3 border-b border-outline-variant/10 flex-shrink-0 space-y-2">
            <label for="skill-catalog-filter" class="text-[9px] font-mono text-outline/50 uppercase tracking-widest">Filter catalog</label>
            <input
              id="skill-catalog-filter"
              bind:value={skillCatalogFilter}
              placeholder="Filter skills…"
              class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-xs font-mono text-on-surface placeholder:text-outline/40 focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {#if skillCatalogRows.length === 0}
              <div class="font-mono text-[10px] text-outline/55 p-4 space-y-2 leading-relaxed">
                {#if fsSkillSummaries.length === 0 && skills.length === 0}
                  <p>No skills found.</p>
                  <p class="text-outline/40">
                    Create <code class="text-primary/70">.agents/skills/&lt;name&gt;/SKILL.md</code> (open skill layout), ensure the Cortex server cwd is the folder that contains <code class="text-outline/50">.agents</code>, then <strong class="text-outline/60">Rescan</strong>.
                  </p>
                {:else}
                  <p>No skills match the filter.</p>
                  <p class="text-outline/40">Clear the filter or try another name.</p>
                {/if}
              </div>
            {/if}
            {#each skillCatalogRows as row, idx (row.t === "hdr" ? `h-${idx}-${row.label}` : row.t === "fs" ? `f-${row.s.relPath}` : row.rowKey)}
              {#if row.t === "hdr"}
                <div
                  class="font-mono text-[9px] uppercase tracking-widest text-secondary/75 px-2 pt-3 pb-1 first:pt-1 border-t border-outline-variant/10 first:border-t-0"
                >
                  {row.label}
                </div>
              {:else if row.t === "fs"}
                <button
                  type="button"
                  class="w-full text-left p-2.5 rounded-md border transition-all {isFsSkillSelected(row.s)
                    ? 'bg-primary/12 border-primary/35 shadow-[0_0_0_1px_rgba(139,92,246,0.15)]'
                    : 'bg-surface-container-lowest/40 border-outline-variant/10 hover:border-primary/25'}"
                  onclick={() => selectFilesystemSkill(row.s)}
                >
                  <div class="font-mono text-[11px] font-medium text-on-surface leading-snug">{row.s.name}</div>
                  <div class="font-mono text-[9px] text-outline/65 mt-1 line-clamp-2">{row.s.description || "—"}</div>
                  <div class="font-mono text-[8px] text-outline/35 mt-1.5 truncate" title={row.s.relPath}>{row.s.relPath}</div>
                </button>
              {:else}
                <button
                  type="button"
                  class="w-full text-left p-2.5 rounded-md border transition-all {isSqliteSkillSelected(row.s)
                    ? 'bg-primary/12 border-primary/35'
                    : 'bg-surface-container-lowest/40 border-outline-variant/10 hover:border-primary/25'}"
                  onclick={() => selectSqliteSkill(row.s)}
                >
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <span class="font-mono text-[7px] uppercase text-outline/50 border border-outline-variant/20 px-1 rounded">db</span>
                    <span class="font-mono text-[11px] font-medium text-on-surface">{row.s.name ?? row.s.id ?? "skill"}</span>
                  </div>
                  <div class="font-mono text-[9px] text-outline/65 line-clamp-2">{row.s.description ?? ""}</div>
                </button>
              {/if}
            {/each}
          </div>
        </aside>

        <!-- 2 — Document (primary reading column) -->
        <main class="flex flex-col min-h-0 min-w-0 border-b md:border-b-0 xl:border-r border-outline-variant/15">
          {#if skillDetailLoading}
            <div class="flex flex-1 items-center justify-center gap-2 text-outline font-mono text-xs p-8">
              <span class="material-symbols-outlined text-primary animate-spin">progress_activity</span>
              Loading…
            </div>
          {:else if skillDetailError}
            <div class="m-4 rounded border border-error/30 bg-error/5 p-4 font-mono text-[11px] text-error/90">{skillDetailError}</div>
          {:else if skillDetail}
            <div class="flex-shrink-0 p-4 border-b border-outline-variant/10 bg-surface-container-low/25">
              <div class="flex flex-wrap items-start gap-2">
                <span class="material-symbols-outlined text-secondary/80 text-xl shrink-0" aria-hidden="true">bolt</span>
                <div class="min-w-0 flex-1">
                  <h3 class="font-headline text-lg font-bold text-on-surface tracking-tight uppercase">{skillDetail.name}</h3>
                  <div class="flex flex-wrap gap-1.5 mt-2">
                    <span
                      class="font-mono text-[8px] uppercase tracking-wider px-2 py-0.5 rounded border border-outline-variant/25 text-outline/70"
                    >
                      {skillDetail.filePath.startsWith("sqlite:") ? "SQLite" : "Open skill"}
                    </span>
                    {#if skillDetail.description}
                      <span class="font-mono text-[8px] uppercase tracking-wider px-2 py-0.5 rounded border border-secondary/25 text-secondary/80">when to use</span>
                    {/if}
                  </div>
                </div>
              </div>
              {#if skillDetail.description}
                <p class="font-mono text-[11px] text-on-surface/80 mt-3 leading-relaxed border-l-2 border-secondary/30 pl-3">
                  {skillDetail.description}
                </p>
              {/if}
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto p-4">
              <div class="text-[9px] font-mono text-outline/45 uppercase tracking-widest mb-2">Core instructions</div>
              <MarkdownRich markdown={skillDetail.instructions} class="text-sm max-w-none" showCopy={true} />
            </div>
          {:else}
            <div class="flex flex-1 items-center justify-center text-outline font-mono text-xs text-center px-6 py-16">
              Pick a skill from the catalog to preview instructions.
            </div>
          {/if}
        </main>

        <!-- 3 — Meta sidebar (YAML, roots, wire-up) -->
        <aside
          class="flex flex-col min-h-0 overflow-y-auto bg-surface-container-low/25 md:col-span-2 xl:col-span-1 xl:max-h-full max-h-[50vh] md:max-h-none"
        >
          <div class="p-3 space-y-3 border-b border-outline-variant/10">
            <div class="text-[9px] font-mono text-outline/50 uppercase tracking-widest">Skill roots scanned</div>
            <p class="font-mono text-[9px] text-outline/45 leading-relaxed">
              Under each scan base, Cortex looks for: <code class="text-secondary/80">.agents/skills</code>,
              <code class="text-outline/60">skills</code>, <code class="text-outline/60">.claude/skills</code>,
              <code class="text-outline/60">apps/cortex/.agents/skills</code> (last is for monorepo-root cwd).
            </p>
            {#if discoveredSkillPaths.length === 0}
              <p class="font-mono text-[9px] text-outline/40">No roots found on disk from this cwd.</p>
            {:else}
              <ul class="space-y-2">
                {#each discoveredSkillPaths as p (p)}
                  <li class="flex flex-col gap-1.5 font-mono text-[9px]">
                    <code class="text-secondary/85 bg-surface-container-lowest/70 px-2 py-1 rounded break-all">{p}</code>
                    <button
                      type="button"
                      disabled={skillPathInBuilder(p)}
                      onclick={() => appendPathsToBuilderLivingSkills([p])}
                      class="self-start text-[8px] px-2 py-1 rounded border border-primary/35 text-primary hover:bg-primary/10 cursor-pointer bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {skillPathInBuilder(p) ? "In Builder" : "Add to Builder"}
                    </button>
                  </li>
                {/each}
              </ul>
              {@const missing = discoveredSkillPaths.filter((p) => !skillPathInBuilder(p))}
              {#if missing.length > 0}
                <button
                  type="button"
                  onclick={() => appendPathsToBuilderLivingSkills(missing)}
                  class="w-full py-2 rounded-md border-0 font-mono text-[9px] uppercase text-white cursor-pointer hover:brightness-110"
                  style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
                >
                  Add all roots to Builder
                </button>
              {/if}
            {/if}
            <p class="font-mono text-[8px] text-outline/35 leading-relaxed">
              Framework runs use <strong class="text-outline/50">Living skills</strong> paths in Builder → Agent config.
            </p>
          </div>

          {#if skillDetail && !skillDetailLoading && !skillDetailError}
            <div class="p-3 space-y-3 flex-1">
              {#if skillDetail.declaredFields && Object.keys(skillDetail.declaredFields).length > 0}
                <div>
                  <div class="text-[9px] font-mono text-outline/50 uppercase tracking-widest mb-2">Frontmatter</div>
                  <div class="flex flex-wrap gap-1">
                    {#each Object.entries(skillDetail.declaredFields) as [k, v] (k)}
                      <span
                        class="font-mono text-[8px] px-1.5 py-0.5 rounded border border-outline-variant/20 bg-surface-container-lowest/50 text-on-surface/80 max-w-full break-all"
                        title={formatYamlValue(v)}
                      >
                        <span class="text-secondary/75">{k}</span>={formatYamlValue(v)}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if skillDetail.metadata && Object.keys(skillDetail.metadata).length > 0}
                <details class="group">
                  <summary class="font-mono text-[9px] text-outline/60 cursor-pointer uppercase tracking-widest list-none flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px] text-outline/50">expand_more</span>
                    metadata block
                  </summary>
                  <pre
                    class="font-mono text-[9px] text-on-surface/70 whitespace-pre-wrap break-words mt-2 rounded border border-outline-variant/15 bg-surface-container-lowest/40 p-2 overflow-x-auto max-h-40 overflow-y-auto"
                  >{JSON.stringify(skillDetail.metadata, null, 2)}</pre>
                </details>
              {/if}
              {#if skillDetail.resources && (skillDetail.resources.scripts.length + skillDetail.resources.references.length + skillDetail.resources.assets.length > 0)}
                <div>
                  <div class="text-[9px] font-mono text-outline/50 uppercase tracking-widest mb-1.5">Resources</div>
                  <ul class="font-mono text-[9px] text-outline/75 space-y-0.5">
                    {#if skillDetail.resources.scripts.length}<li>scripts: {skillDetail.resources.scripts.join(", ")}</li>{/if}
                    {#if skillDetail.resources.references.length}<li>references: {skillDetail.resources.references.join(", ")}</li>{/if}
                    {#if skillDetail.resources.assets.length}<li>assets: {skillDetail.resources.assets.join(", ")}</li>{/if}
                  </ul>
                </div>
              {/if}
              <div class="font-mono text-[8px] text-outline/35 pt-2 border-t border-outline-variant/10">
                File: <span class="text-outline/55 break-all">{skillDetail.filePath}</span>
              </div>
            </div>
          {/if}
        </aside>
      </div>
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

{#if deleteConfirmAgent}
  <ConfirmModal
    title="Delete {deleteConfirmAgent.name}"
    message="This permanently deletes this agent and its saved configuration. This cannot be undone."
    confirmLabel="Delete"
    onConfirm={() => deleteAgent(deleteConfirmAgent!)}
    onCancel={() => (deleteConfirmAgent = null)}
  />
{/if}

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

  type BuilderAdHocAction = "run" | "save" | "save-run";
  let builderAdHocAction = $state<BuilderAdHocAction>("save-run");
  let builderActionMenuOpen = $state(false);
  let builderActionMenuRoot = $state<HTMLDivElement | undefined>();

  const BUILDER_ADHOC_ACTIONS: { id: BuilderAdHocAction; label: string; hint: string }[] = [
    { id: "run", label: "Run without saving", hint: "One-off run; nothing stored under Agents." },
    { id: "save", label: "Save only", hint: "Store blueprint without starting a run." },
    { id: "save-run", label: "Save & run", hint: "Create agent and start the first run." },
  ];

  function builderAdHocPrimaryDisabled(): boolean {
    if (builderRunning || builderSaving) return true;
    switch (builderAdHocAction) {
      case "run":
        return !builderConfig.prompt.trim();
      case "save":
        return !builderPersistentName.trim();
      case "save-run":
        return !builderPersistentName.trim() || !builderConfig.prompt.trim();
      default:
        return true;
    }
  }

  function builderAdHocPrimaryTitle(): string | undefined {
    if (builderAdHocAction !== "save-run") return undefined;
    if (!builderConfig.prompt.trim()) return "Add a prompt above — it is stored on the agent and used for the first run.";
    return undefined;
  }

  async function executeBuilderAdHocAction() {
    builderActionMenuOpen = false;
    switch (builderAdHocAction) {
      case "run":
        await runFromBuilder();
        break;
      case "save":
        await createAgentFromBuilder(false);
        break;
      case "save-run":
        await createAgentFromBuilder(true);
        break;
    }
  }

  $effect(() => {
    if (!builderActionMenuOpen || typeof document === "undefined") return;
    const root = builderActionMenuRoot;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target;
      if (!(t instanceof Node) || !root?.contains(t)) builderActionMenuOpen = false;
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") builderActionMenuOpen = false;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  });

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
  let deleteConfirmBulk = $state<GatewayRow[] | null>(null);
  let selectedGatewayAgentIds = $state(new Set<string>());
  let gatewaySelectAllEl = $state<HTMLInputElement | undefined>(undefined);

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
      const mapped: GatewayRow[] = agentsRaw.map((agent) => ({
        ...agent,
        config: { ...defaults, ...(agent.config ?? {}) },
        agentType:
          agent.type === "ad-hoc" || agent.agentId.startsWith("agent-") ? "ad-hoc" : "gateway",
      }));
      gatewayAgents = mapped;
      selectedGatewayAgentIds = new Set(
        [...selectedGatewayAgentIds].filter((id) => mapped.some((a) => a.agentId === id)),
      );
    } catch {
      gatewayAgents = [];
      selectedGatewayAgentIds = new Set();
    }
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
    if (res.ok) {
      const next = new Set(selectedGatewayAgentIds);
      next.delete(agent.agentId);
      selectedGatewayAgentIds = next;
      toast.success(`Deleted ${agent.name}`);
      await loadGatewayAgents();
    } else toast.error("Delete failed");
  }

  function gatewayAllSelected(): boolean {
    return gatewayAgents.length > 0 && gatewayAgents.every((a) => selectedGatewayAgentIds.has(a.agentId));
  }

  function onGatewaySelectAllChange(ev: Event) {
    const el = ev.currentTarget as HTMLInputElement;
    if (el.checked) selectedGatewayAgentIds = new Set(gatewayAgents.map((a) => a.agentId));
    else selectedGatewayAgentIds = new Set();
  }

  function toggleGatewayAgentSelected(agentId: string, selected: boolean) {
    const next = new Set(selectedGatewayAgentIds);
    if (selected) next.add(agentId);
    else next.delete(agentId);
    selectedGatewayAgentIds = next;
  }

  function selectedGatewayAgents(): GatewayRow[] {
    return gatewayAgents.filter((a) => selectedGatewayAgentIds.has(a.agentId));
  }

  function bulkDeleteConfirmMessage(agents: GatewayRow[]): string {
    const max = 6;
    const lines = agents
      .slice(0, max)
      .map((a) => `· ${a.name}`)
      .join("\n");
    const more =
      agents.length > max ? `\n… and ${agents.length - max} more` : "";
    return `This permanently deletes ${agents.length} saved agent${agents.length === 1 ? "" : "s"} and their configurations. This cannot be undone.\n\n${lines}${more}`;
  }

  async function deleteAgentsBulk(agents: GatewayRow[]) {
    deleteConfirmBulk = null;
    if (agents.length === 0) return;
    let failed = 0;
    try {
      const oks = await Promise.all(
        agents.map((agent) =>
          fetch(`${CORTEX_SERVER_URL}/api/agents/${agent.agentId}`, { method: "DELETE" })
            .then((r) => r.ok)
            .catch(() => false),
        ),
      );
      failed = oks.filter((ok) => !ok).length;
    } catch {
      failed = agents.length;
    }
    selectedGatewayAgentIds = new Set();
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

  $effect(() => {
    const el = gatewaySelectAllEl;
    if (!el) return;
    const n = selectedGatewayAgentIds.size;
    const t = gatewayAgents.length;
    el.indeterminate = t > 0 && n > 0 && n < t;
  });

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

  // Skill creation form state
  let showNewSkillForm = $state(false);
  let newSkillName = $state("");
  let newSkillInstructions = $state("");
  let newSkillDescription = $state("");
  let newSkillTags = $state("");
  let newSkillSaving = $state(false);
  let deleteConfirmSkill = $state<SkillRow | null>(null);
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

  async function createNewSkill() {
    if (!newSkillName.trim()) {
      toast.warning("Name is required");
      return;
    }
    if (!newSkillInstructions.trim()) {
      toast.warning("Instructions are required");
      return;
    }

    newSkillSaving = true;
    try {
      const tags = newSkillTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const res = await fetch(`${CORTEX_SERVER_URL}/api/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSkillName.trim(),
          instructions: newSkillInstructions.trim(),
          description: newSkillDescription.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      toast.success("Skill created", newSkillName.trim());
      showNewSkillForm = false;
      newSkillName = "";
      newSkillInstructions = "";
      newSkillDescription = "";
      newSkillTags = "";

      // Reload skills list
      const skillsRes = await fetch(`${CORTEX_SERVER_URL}/api/skills`);
      if (skillsRes.ok) {
        skills = await skillsRes.json();
      }
    } catch (e) {
      toast.error("Create failed", String(e));
    } finally {
      newSkillSaving = false;
    }
  }

  async function deleteSkill(skill: SkillRow) {
    deleteConfirmSkill = null;
    if (!skill.id) {
      toast.warning("Cannot delete skill without id");
      return;
    }

    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/skills/${skill.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`Deleted ${skill.name ?? "skill"}`);
        // Reload skills list
        const skillsRes = await fetch(`${CORTEX_SERVER_URL}/api/skills`);
        if (skillsRes.ok) {
          skills = await skillsRes.json();
        }
      } else {
        const errData = (await res.json()) as { error?: string };
        toast.error("Delete failed", errData.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      toast.error("Delete failed", String(e));
    }
  }

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
      <h1 class="font-display text-2xl font-light tracking-tight text-slate-900 dark:text-on-surface">
        Agent <span class="font-semibold text-primary">Lab</span>
      </h1>
      <p class="mt-1 max-w-3xl font-mono text-[10px] leading-relaxed text-slate-600 dark:text-on-surface-variant/90">
        Build, persist, and operate Cortex agents with one control surface for config, skills, and tool wiring.
      </p>
    </div>
    <a href="/runs" class="flex items-center gap-1 font-mono text-[11px] text-cyan-700 no-underline transition-colors hover:text-primary dark:text-secondary">
      <span class="material-symbols-outlined text-sm">timeline</span> Trace
    </a>
  </header>

  <div class="grid flex-shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
    <div
      class="gradient-border rounded-lg px-3 py-2 font-mono text-[10px] shadow-sm dark:shadow-[0_0_24px_-12px_rgba(139,92,246,0.35)]"
    >
      <div class="text-slate-500 dark:text-on-surface-variant/80">Saved agents</div>
      <div class="mt-0.5 text-lg font-semibold tabular-nums text-violet-700 dark:text-primary">{gatewayAgents.length}</div>
    </div>
    <div class="gradient-border rounded-lg px-3 py-2 font-mono text-[10px] shadow-sm dark:shadow-[0_0_20px_-10px_rgba(6,182,212,0.2)]">
      <div class="text-slate-500 dark:text-on-surface-variant/80">Active tab</div>
      <div class="mt-0.5 font-semibold uppercase tracking-wide text-slate-800 dark:text-on-surface">{activeTab}</div>
    </div>
    <div class="gradient-border rounded-lg px-3 py-2 font-mono text-[10px] shadow-sm">
      <div class="text-slate-500 dark:text-on-surface-variant/80">Builder mode</div>
      <div class="mt-0.5 font-semibold text-slate-800 dark:text-on-surface">
        {builderAgentType === "persistent" ? "persistent" : "ad-hoc"}
      </div>
    </div>
    <div class="gradient-border rounded-lg px-3 py-2 font-mono text-[10px] shadow-sm">
      <div class="text-slate-500 dark:text-on-surface-variant/80">Skill roots</div>
      <div class="mt-0.5 text-lg font-semibold tabular-nums text-slate-800 dark:text-on-surface">{discoveredSkillPaths.length}</div>
    </div>
  </div>

  <div
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--cortex-border)] bg-white/80 p-3 shadow-[0_10px_40px_-20px_rgba(15,23,42,0.12)] backdrop-blur-[6px] dark:bg-surface-container-low/55 dark:shadow-[0_12px_48px_-20px_rgba(0,0,0,0.65),0_0_0_1px_rgba(139,92,246,0.22),0_0_60px_-30px_rgba(6,182,212,0.12)]"
  >
  <!-- Tabs -->
  <div
    class="flex flex-shrink-0 items-center gap-2 border-b border-violet-200/80 pb-2 dark:border-primary/25 dark:shadow-[0_1px_0_rgba(6,182,212,0.08)]"
  >
    {#each [
      { id: "builder", label: "Builder", icon: "build" },
      { id: "gateway", label: "Agents", icon: "hub", badge: gatewayAgents.length },
      { id: "skills",  label: "Skills",  icon: "psychology" },
      { id: "tools",   label: "Tools",   icon: "construction" },
    ] as tab}
      <button type="button"
        class="flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors duration-150
               {activeTab === tab.id
          ? 'border-primary/40 bg-violet-100/95 text-violet-900 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.2)] dark:border-primary/45 dark:bg-primary/[0.18] dark:text-primary dark:shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35),0_0_20px_-8px_rgba(139,92,246,0.25)]'
          : 'border-slate-200/90 text-slate-600 hover:border-primary/30 hover:text-violet-800 dark:border-white/[0.08] dark:bg-surface-container/40 dark:text-on-surface-variant dark:hover:border-primary/35 dark:hover:bg-primary/[0.08] dark:hover:text-on-surface'}"
        onclick={() => (activeTab = tab.id as typeof activeTab)}>
        <span class="material-symbols-outlined text-sm opacity-90">{tab.icon}</span>{tab.label}
        {#if (tab as any).badge > 0}
          <span
            class="rounded px-1.5 py-px font-mono text-[8px] font-semibold tabular-nums shadow-sm {tab.id === 'gateway'
              ? 'bg-cyan-700 text-white ring-1 ring-cyan-900/25 dark:bg-secondary dark:text-on-secondary dark:ring-1 dark:ring-cyan-200/35'
              : 'bg-violet-600 text-white ring-1 ring-violet-900/20 dark:bg-primary dark:text-on-primary dark:shadow-[0_0_12px_rgba(139,92,246,0.35)]'}"
            >{(tab as any).badge}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- ── BUILDER ─────────────────────────────────────────────────────── -->
  {#if activeTab === "builder"}
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-5">
      <div class="mx-auto w-full max-w-5xl space-y-6 xl:max-w-6xl 2xl:max-w-7xl">
        <div class="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <!-- Task + identity (narrow column on large screens — uses width instead of one skinny center column) -->
          <aside
            class="flex min-h-0 min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100dvh-7rem)]"
          >
            <div class="grid shrink-0 grid-cols-2 gap-3">
              <label
                class="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--cortex-border)] bg-white/95 p-2 transition-colors hover:border-primary/45 dark:border-white/10 dark:bg-surface-container-high/40 dark:hover:border-primary/40 dark:hover:bg-primary/[0.07]"
              >
                <input
                  type="radio"
                  name="builder-agent-type"
                  checked={builderAgentType === "ad-hoc"}
                  onchange={() => (builderAgentType = "ad-hoc")}
                  class="accent-primary"
                />
                <span class="font-mono text-[10px] text-slate-800 dark:text-on-surface/90">Ad-hoc (saved, on-demand)</span>
              </label>
              <label
                class="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--cortex-border)] bg-white/95 p-2 transition-colors hover:border-primary/45 dark:border-white/10 dark:bg-surface-container-high/40 dark:hover:border-primary/40 dark:hover:bg-primary/[0.07]"
              >
                <input
                  type="radio"
                  name="builder-agent-type"
                  checked={builderAgentType === "persistent"}
                  onchange={() => (builderAgentType = "persistent")}
                  class="accent-primary"
                />
                <span class="font-mono text-[10px] text-slate-800 dark:text-on-surface/90">Persistent (gateway process)</span>
              </label>
            </div>

            <div class="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-0.5">
              <div>
              <label for="builder-prompt" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Prompt</label>
              <textarea id="builder-prompt" bind:value={builderConfig.prompt}
                placeholder="Describe what you want the agent to do…" rows="5"
                class="w-full resize-y rounded-lg border border-[var(--cortex-border)] bg-white px-4 py-3 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:placeholder:text-on-surface-variant/50 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20 min-h-[7.5rem] lg:min-h-[11rem]"
              ></textarea>
              </div>

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div class={builderAgentType === "persistent" ? "" : "sm:col-span-2 lg:col-span-1"}>
                <label for="builder-persistent-name" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Name *</label>
                <input
                  id="builder-persistent-name"
                  bind:value={builderPersistentName}
                  placeholder={builderAgentType === "persistent" ? "my-gateway-agent" : "my-ad-hoc-agent"}
                  class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20"
                />
              </div>
              {#if builderAgentType === "persistent"}
                <div class="sm:col-span-2 lg:col-span-1">
                  <label for="builder-persistent-schedule" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">
                    Schedule <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/50">(preset or cron, blank = manual)</span>
                  </label>
                  <div class="mb-1.5 flex flex-wrap gap-1">
                    {#each SCHEDULE_PRESETS as preset}
                      <button
                        type="button"
                        onclick={() => (builderPersistentSchedule = preset.cron)}
                        class="cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[8px] transition-colors {builderPersistentSchedule === preset.cron
                          ? 'border-primary/45 bg-violet-100/90 text-violet-900 dark:border-primary/50 dark:bg-primary/[0.18] dark:text-primary'
                          : 'border-[var(--cortex-border)] text-slate-500 hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:border-primary/40 dark:hover:text-primary'}"
                      >
                        {preset.label}
                      </button>
                    {/each}
                    {#if builderPersistentSchedule && !SCHEDULE_PRESETS.some((p) => p.cron === builderPersistentSchedule)}
                      <span class="self-center font-mono text-[8px] text-slate-400 dark:text-on-surface-variant/45">custom:</span>
                    {/if}
                  </div>
                  <input
                    id="builder-persistent-schedule"
                    bind:value={builderPersistentSchedule}
                    placeholder="*/5 * * * *  or leave blank for manual"
                    class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20"
                  />
                  {#if builderPersistentSchedule}
                    <p class="mt-1 font-mono text-[9px] text-cyan-800 dark:text-secondary/80">
                      Agent process will start immediately and fire on this schedule.
                    </p>
                  {:else}
                    <p class="mt-1 font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/60">
                      No schedule — start the process manually from Agents after creation.
                    </p>
                  {/if}
                </div>
              {/if}
              </div>
            </div>

            <div
              class="flex shrink-0 flex-col gap-2 border-t border-[var(--cortex-border)] pt-4 dark:border-white/10"
            >
              {#if builderAgentType === "ad-hoc"}
                <p class="font-mono text-[10px] leading-snug text-slate-600 dark:text-on-surface-variant/80">
                  Use the <span class="text-slate-800 dark:text-on-surface/90">chevron</span> to pick run vs save, then the main button.
                </p>
                <div class="relative w-full min-w-0" bind:this={builderActionMenuRoot}>
                  {#if builderActionMenuOpen}
                    <div
                      role="listbox"
                      aria-label="Ad-hoc action"
                      class="absolute bottom-full left-0 right-0 z-40 mb-1.5 overflow-hidden rounded-lg border border-[var(--cortex-border)] bg-white py-1 shadow-lg dark:border-white/12 dark:bg-surface-container-high"
                    >
                      {#each BUILDER_ADHOC_ACTIONS as a (a.id)}
                        <button
                          type="button"
                          role="option"
                          aria-selected={builderAdHocAction === a.id}
                          class="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wide text-slate-900 transition-colors hover:bg-violet-50/90 dark:text-on-surface dark:hover:bg-white/[0.06]"
                          onclick={() => {
                            builderAdHocAction = a.id;
                            builderActionMenuOpen = false;
                          }}
                        >
                          <span class="inline-flex w-5 shrink-0 justify-center pt-0.5">
                            {#if builderAdHocAction === a.id}
                              <span class="material-symbols-outlined text-base text-primary dark:text-secondary">check</span>
                            {/if}
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block">{a.label}</span>
                            <span
                              class="mt-0.5 block font-normal normal-case tracking-normal text-[9px] text-slate-500 dark:text-on-surface-variant/75">{a.hint}</span>
                          </span>
                        </button>
                      {/each}
                    </div>
                  {/if}

                  <div
                    class="flex w-full min-w-0 overflow-hidden rounded-lg shadow-sm {builderAdHocAction === 'save-run'
                      ? 'shadow-[0_0_20px_rgba(139,92,246,0.35)] dark:shadow-[0_0_32px_rgba(139,92,246,0.45),0_0_24px_rgba(6,182,212,0.15)]'
                      : 'border border-[var(--cortex-border)] dark:border-white/12'}"
                  >
                    <button
                      type="button"
                      disabled={builderAdHocPrimaryDisabled()}
                      title={builderAdHocPrimaryTitle()}
                      onclick={() => void executeBuilderAdHocAction()}
                      class="flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 py-2.5 pl-3 pr-2 font-mono text-[10px] uppercase tracking-wider transition-all hover:brightness-110 disabled:opacity-40 {builderAdHocAction === 'save-run'
                        ? 'text-white'
                        : 'bg-white text-slate-800 hover:bg-violet-50/80 dark:bg-surface-container-high/60 dark:text-on-surface dark:hover:bg-primary/[0.08]'}"
                      style={builderAdHocAction === "save-run"
                        ? "background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
                        : undefined}
                    >
                      {#if builderRunning || builderSaving}
                        <span class="material-symbols-outlined shrink-0 text-sm animate-spin">progress_activity</span>
                      {:else if builderAdHocAction === "run"}
                        <span class="material-symbols-outlined shrink-0 text-sm">science</span>
                      {:else if builderAdHocAction === "save"}
                        <span class="material-symbols-outlined shrink-0 text-sm">bookmark_add</span>
                      {:else}
                        <span class="material-symbols-outlined shrink-0 text-sm">rocket_launch</span>
                      {/if}
                      <span class="truncate">{BUILDER_ADHOC_ACTIONS.find((x) => x.id === builderAdHocAction)?.label ?? ""}</span>
                    </button>
                    <button
                      type="button"
                      disabled={builderRunning || builderSaving}
                      aria-haspopup="listbox"
                      aria-expanded={builderActionMenuOpen}
                      aria-label="Choose ad-hoc action"
                      onclick={(e) => {
                        e.stopPropagation();
                        builderActionMenuOpen = !builderActionMenuOpen;
                      }}
                      class="flex w-10 shrink-0 cursor-pointer items-center justify-center border-l py-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 {builderAdHocAction === 'save-run'
                        ? 'border-white/25 text-white hover:bg-white/10'
                        : 'border-[var(--cortex-border)] bg-white text-slate-600 hover:bg-violet-50/80 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface-variant dark:hover:bg-primary/[0.08]'}"
                      style={builderAdHocAction === "save-run"
                        ? "background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
                        : undefined}
                    >
                      <span
                        class="material-symbols-outlined text-lg leading-none transition-transform {builderActionMenuOpen
                          ? 'rotate-180'
                          : ''}"
                      >expand_less</span>
                    </button>
                  </div>
                </div>
              {:else}
                <button type="button" disabled={!builderPersistentName.trim() || builderSaving} onclick={() => createAgentFromBuilder(false)}
                  class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 px-6 py-2.5 font-mono text-[11px] uppercase tracking-wider text-white shadow-[0_0_20px_rgba(139,92,246,0.35)] transition-all hover:brightness-110 disabled:opacity-40 dark:shadow-[0_0_32px_rgba(139,92,246,0.45),0_0_24px_rgba(6,182,212,0.15)]"
                  style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
                  {#if builderSaving}
                    <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                  {:else}
                    <span class="material-symbols-outlined text-sm">save</span>
                  {/if}
                  Create Gateway Agent
                </button>
              {/if}
            </div>
          </aside>

          <div class="min-w-0">
            <AgentConfigPanel bind:config={builderConfig} />
          </div>
        </div>
      </div>
    </div>

  <!-- ── GATEWAY ─────────────────────────────────────────────────────── -->
  {:else if activeTab === "gateway"}
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if showForm}
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-5">
        <div class="mx-auto w-full max-w-5xl space-y-5 xl:max-w-6xl 2xl:max-w-7xl">
          <div class="flex shrink-0 items-center justify-between gap-3">
            <h2 class="font-headline text-base font-semibold text-slate-900 dark:text-on-surface">
              {editingAgent
                ? (formAgentType === "gateway" ? "Edit Gateway Agent" : "Edit Ad-hoc Agent")
                : "New Gateway Agent"}
            </h2>
            <button type="button" onclick={() => (showForm = false)}
              class="material-symbols-outlined cursor-pointer border-0 bg-transparent text-slate-500 hover:text-primary dark:text-on-surface-variant dark:hover:text-primary"
              aria-label="Close form"
              >close</button>
          </div>

          <div class="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
            <aside
              class="flex min-h-0 min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100dvh-7rem)]"
            >
              <div class="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-0.5">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div class={formAgentType === "gateway" ? "" : "sm:col-span-2 lg:col-span-1"}>
                    <label for="gateway-agent-name" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Name *</label>
                    <input id="gateway-agent-name" bind:value={formName} placeholder="my-gateway-agent"
                      class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
                  </div>
                  {#if formAgentType === "gateway"}
                    <div class="sm:col-span-2 lg:col-span-1">
                      <label for="gateway-agent-schedule" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">
                        Schedule <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/50">(preset or cron, blank = manual)</span>
                      </label>
                      <div class="mb-1.5 flex flex-wrap gap-1">
                        {#each SCHEDULE_PRESETS as preset}
                          <button type="button"
                            onclick={() => (formSchedule = preset.cron)}
                            class="cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[8px] transition-colors
                                   {formSchedule === preset.cron
                              ? 'border-primary/45 bg-violet-100/90 text-violet-900 dark:border-primary/50 dark:bg-primary/[0.18] dark:text-primary'
                              : 'border-[var(--cortex-border)] text-slate-500 hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:border-primary/40 dark:hover:text-primary'}">
                            {preset.label}
                          </button>
                        {/each}
                        {#if formSchedule && !SCHEDULE_PRESETS.some(p => p.cron === formSchedule)}
                          <span class="self-center font-mono text-[8px] text-slate-400 dark:text-on-surface-variant/45">custom:</span>
                        {/if}
                      </div>
                      <input id="gateway-agent-schedule" bind:value={formSchedule} placeholder="*/5 * * * *  or leave blank for manual"
                        class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
                      {#if formSchedule}
                        <p class="mt-1 font-mono text-[9px] text-cyan-800 dark:text-secondary/80">
                          Agent process will start immediately and fire on this schedule.
                        </p>
                      {:else}
                        <p class="mt-1 font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/60">
                          No schedule — use "Trigger Now" to run manually.
                        </p>
                      {/if}
                    </div>
                  {:else}
                    <div class="flex flex-col justify-end pb-2 sm:col-span-2 lg:col-span-1">
                      <p class="font-mono text-[9px] text-slate-600 dark:text-on-surface-variant/70">
                        Ad-hoc agents run on demand only (Trigger Now or API). No schedule.
                      </p>
                    </div>
                  {/if}
                </div>

                <div>
                  <label for="gateway-edit-prompt" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">
                    Prompt <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/50">(default task — same as Builder tab)</span>
                  </label>
                  <textarea id="gateway-edit-prompt" bind:value={formConfig.prompt}
                    placeholder="Describe what this agent should do when triggered or on schedule…" rows="5"
                    class="w-full resize-y rounded-lg border border-[var(--cortex-border)] bg-white px-4 py-3 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:placeholder:text-on-surface-variant/50 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20 min-h-[7.5rem] lg:min-h-[11rem]"
                  ></textarea>
                  <p class="mt-1 font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/65">
                    Model-level instructions live in <span class="text-slate-700 dark:text-on-surface/80">Inference → System Prompt</span> in the panel on the right.
                  </p>
                </div>
              </div>

              <div
                class="flex shrink-0 flex-col gap-2 border-t border-[var(--cortex-border)] pt-4 dark:border-white/10"
              >
                <div class="flex flex-wrap justify-end gap-2">
                  <button type="button" onclick={() => (showForm = false)}
                    class="cursor-pointer rounded border border-[var(--cortex-border)] bg-transparent px-4 py-2 font-mono text-[10px] uppercase text-slate-600 transition-colors hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:text-on-surface">
                    Cancel</button>
                  <button type="button" disabled={formSaving} onclick={saveAgent}
                    class="cursor-pointer rounded border-0 px-6 py-2 font-mono text-[10px] uppercase text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition-all hover:brightness-110 disabled:opacity-40 dark:shadow-[0_0_28px_rgba(139,92,246,0.4)]"
                    style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
                    {formSaving ? "Saving…" : editingAgent ? "Save Changes" : "Create Agent"}
                  </button>
                </div>
              </div>
            </aside>

            <div class="min-w-0">
              <AgentConfigPanel bind:config={formConfig} />
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-5 pt-2 sm:px-5 sm:pb-6 sm:pt-3">
        <div class="mb-3 flex min-w-0 flex-shrink-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <p class="font-mono text-[10px] text-slate-600 dark:text-on-surface-variant/85">
              {gatewayAgents.length} agent{gatewayAgents.length !== 1 ? "s" : ""}
            </p>
            {#if gatewayAgents.length > 0}
              <label
                class="flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-slate-600 transition-colors hover:border-primary/25 hover:text-primary dark:text-on-surface-variant/90 dark:hover:border-primary/35 dark:hover:text-primary"
              >
                <input
                  bind:this={gatewaySelectAllEl}
                  type="checkbox"
                  class="accent-primary h-3.5 w-3.5 shrink-0 rounded border-[var(--cortex-border)]"
                  checked={gatewayAllSelected()}
                  onchange={onGatewaySelectAllChange}
                />
                Select all
              </label>
            {/if}
            {#if selectedGatewayAgentIds.size > 0}
              <button
                type="button"
                onclick={() => (deleteConfirmBulk = selectedGatewayAgents())}
                class="cursor-pointer rounded-md border border-error/35 bg-error/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide text-error transition-colors hover:bg-error/18 dark:border-error/40 dark:bg-error/15 dark:hover:bg-error/25"
              >
                Delete selected ({selectedGatewayAgentIds.size})
              </button>
            {/if}
          </div>
          <button type="button" onclick={openCreate}
            class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border-0 px-4 py-1.5 font-mono text-[10px] uppercase text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition-all hover:brightness-110 dark:shadow-[0_0_28px_rgba(139,92,246,0.4),0_0_20px_rgba(6,182,212,0.12)]"
            style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
            <span class="material-symbols-outlined text-sm">add</span> New Agent
          </button>
        </div>
        <div class="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
        {#if gatewayLoading}
          <div class="flex items-center justify-center h-20">
            <span class="material-symbols-outlined text-primary animate-spin">progress_activity</span>
          </div>
        {:else if gatewayAgents.length === 0}
          <div class="py-12 text-center">
            <span class="material-symbols-outlined mb-3 block text-3xl text-slate-300 dark:text-primary/35">hub</span>
            <p class="font-mono text-xs text-slate-600 dark:text-on-surface-variant/80">No agents yet.</p>
            <p class="mt-1 font-mono text-[10px] text-slate-500 dark:text-on-surface-variant/60">
              Create gateway or ad-hoc saved agents from Builder.
            </p>
          </div>
        {:else}
          {#each gatewayAgents as agent (agent.agentId)}
            <div
              class="rounded-lg border border-[var(--cortex-border)] bg-white/90 p-4 shadow-sm transition-shadow hover:shadow-md dark:border-white/[0.1] dark:bg-surface-container-high/35 dark:shadow-[0_0_0_1px_rgba(139,92,246,0.12),0_8px_32px_-20px_rgba(0,0,0,0.5)] dark:hover:shadow-[0_0_0_1px_rgba(139,92,246,0.22),0_12px_40px_-16px_rgba(6,182,212,0.08)]"
            >
              <div class="flex items-start gap-3">
                <input
                  type="checkbox"
                  class="accent-primary mt-1 h-3.5 w-3.5 shrink-0 rounded border-[var(--cortex-border)]"
                  checked={selectedGatewayAgentIds.has(agent.agentId)}
                  onchange={(e) =>
                    toggleGatewayAgentSelected(
                      agent.agentId,
                      (e.currentTarget as HTMLInputElement).checked,
                    )}
                  aria-label={`Select ${agent.name}`}
                />
                <div class="flex min-w-0 flex-1 items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex flex-wrap items-center gap-2">
                    <span class="font-mono text-[12px] font-semibold text-slate-900 dark:text-on-surface">{agent.name}</span>
                    <span class="rounded border px-1.5 py-0.5 font-mono text-[9px]
                                 {agent.agentType === 'gateway'
                        ? 'border-primary/40 bg-primary/10 text-violet-800 dark:border-primary/45 dark:bg-primary/[0.15] dark:text-primary'
                        : 'border-[var(--cortex-border)] bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-surface-container-high/50 dark:text-on-surface-variant/90'}">
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
                      <span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-600 dark:bg-surface-container-high/55 dark:text-secondary/90">⏰ {agent.schedule}</span>
                    {/if}
                  </div>
                  <div class="flex flex-wrap items-center gap-2 font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/75">
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
                    class="cursor-pointer rounded border border-primary/40 bg-primary/[0.08] px-2 py-1 font-mono text-[9px] text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40 dark:border-primary/50 dark:bg-primary/[0.14] dark:text-primary dark:hover:bg-primary/[0.22]"
                    title={agent.agentType === "gateway" ? "Run now (ignores schedule)" : "Run now using saved config"}>
                    {triggeringAgent === agent.agentId ? "…" : "▶ Run"}
                  </button>
                  <button type="button" onclick={() => useConfigInBuilder(agent)}
                    class="cursor-pointer rounded border border-[var(--cortex-border)] bg-transparent px-2 py-1 font-mono text-[9px] text-slate-600 transition-colors hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:border-secondary/40 dark:hover:text-secondary"
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
                    class="material-symbols-outlined cursor-pointer border-0 bg-transparent p-1 text-sm text-slate-500 hover:text-primary dark:text-on-surface-variant dark:hover:text-primary"
                    title="Edit agent">edit</button>
                  <button type="button" onclick={() => (deleteConfirmAgent = agent)}
                    class="material-symbols-outlined cursor-pointer border-0 bg-transparent p-1 text-sm text-slate-500 hover:text-error dark:text-on-surface-variant dark:hover:text-error"
                    title="Delete agent">delete</button>
                </div>
                </div>
              </div>
            </div>
          {/each}
        {/if}
        </div>
      </div>
    {/if}
    </div>

  <!-- ── SKILLS (workshop layout: catalog | document | meta) ─────────── -->
  {:else if activeTab === "skills"}
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden gap-3">
      {#if showNewSkillForm}
        <div
          class="gradient-border flex-shrink-0 rounded-lg p-4 shadow-md dark:shadow-[0_0_40px_-16px_rgba(139,92,246,0.25)]"
        >
          <div class="max-w-2xl space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="font-headline text-sm font-semibold text-slate-900 dark:text-on-surface">New Skill</h3>
              <button type="button" onclick={() => (showNewSkillForm = false)}
                class="material-symbols-outlined cursor-pointer border-0 bg-transparent text-slate-500 hover:text-primary dark:text-on-surface-variant dark:hover:text-primary"
                >close</button>
            </div>

            <div>
              <label for="new-skill-name" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Name *</label>
              <input id="new-skill-name" bind:value={newSkillName} placeholder="my-skill"
                class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
            </div>

            <div>
              <label for="new-skill-instructions" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Instructions *</label>
              <textarea id="new-skill-instructions" bind:value={newSkillInstructions} placeholder="Describe what this skill does and how to use it…" rows="6"
                class="w-full resize-none rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:placeholder:text-on-surface-variant/50 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20">
              </textarea>
            </div>

            <div>
              <label for="new-skill-description" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Description <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/55">(optional)</span></label>
              <input id="new-skill-description" bind:value={newSkillDescription} placeholder="Brief one-liner"
                class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
            </div>

            <div>
              <label for="new-skill-tags" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Tags <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/55">(comma-separated, optional)</span></label>
              <input id="new-skill-tags" bind:value={newSkillTags} placeholder="analytics, reporting, data"
                class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
            </div>

            <div class="flex justify-end gap-2 pt-2">
              <button type="button" onclick={() => (showNewSkillForm = false)}
                class="cursor-pointer rounded border border-[var(--cortex-border)] bg-transparent px-4 py-1.5 font-mono text-[10px] uppercase text-slate-600 transition-colors hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:text-on-surface">
                Cancel</button>
              <button type="button" disabled={newSkillSaving || !newSkillName.trim() || !newSkillInstructions.trim()} onclick={createNewSkill}
                class="px-6 py-1.5 rounded border-0 cursor-pointer font-mono text-[10px] uppercase text-white disabled:opacity-40 hover:brightness-110 transition-all"
                style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
                {newSkillSaving ? "Saving…" : "Create Skill"}
              </button>
            </div>
          </div>
        </div>
      {/if}

      <header class="flex flex-shrink-0 flex-col gap-2 border-b border-[var(--cortex-border)] pb-3 dark:border-primary/20">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="font-headline text-sm font-semibold tracking-tight text-slate-900 dark:text-on-surface">Skills workshop</h2>
            <p class="mt-1 max-w-3xl font-mono text-[10px] leading-relaxed text-slate-600 dark:text-on-surface-variant/85">
              Open Agent Skills use <code class="text-cyan-800 dark:text-secondary/90">.agents/skills/&lt;skill-name&gt;/SKILL.md</code>
              (YAML + markdown). The desk scans <strong class="text-slate-800 dark:text-on-surface/90">your process cwd</strong> and
              <strong class="text-slate-800 dark:text-on-surface/90">the Cortex app folder</strong> for the roots below, so skills still appear if you start the API from an unexpected directory.
              Optional: set <code class="text-slate-500 dark:text-on-surface-variant/70">CORTEX_SKILL_SCAN_ROOT</code> to add another base path.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={() => {
                void loadSkillDiscover();
                void loadFsSkillSummaries();
              }}
              class="shrink-0 cursor-pointer rounded border border-[var(--cortex-border)] bg-white px-3 py-1.5 font-mono text-[10px] text-slate-700 shadow-sm transition-colors hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-surface-container-high/50 dark:text-on-surface-variant dark:hover:border-secondary/40 dark:hover:text-secondary"
            >
              ↻ Rescan
            </button>
            <button
              type="button"
              onclick={() => (showNewSkillForm = true)}
              class="flex items-center gap-1.5 px-4 py-1.5 rounded border-0 cursor-pointer font-mono text-[10px] uppercase text-white hover:brightness-110 transition-all shrink-0"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
            >
              <span class="material-symbols-outlined text-sm">add</span> New Skill
            </button>
          </div>
        </div>
      </header>

      <div
        class="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden rounded-lg border border-[var(--cortex-border)] bg-white/70 shadow-inner dark:bg-surface-container-low/40 dark:shadow-[inset_0_0_0_1px_rgba(139,92,246,0.08)] md:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(220px,260px)]"
      >
        <!-- 1 — Catalog -->
        <aside
          class="flex min-h-0 flex-col border-b border-[var(--cortex-border)] bg-slate-50/80 dark:border-white/[0.08] dark:bg-surface-container/50 md:border-b-0 md:border-r"
        >
          <div class="flex-shrink-0 space-y-2 border-b border-[var(--cortex-border)] p-3 dark:border-white/[0.06]">
            <label for="skill-catalog-filter" class="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Filter catalog</label>
            <input
              id="skill-catalog-filter"
              bind:value={skillCatalogFilter}
              placeholder="Filter skills…"
              class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/12 dark:bg-surface-container-high/60 dark:text-on-surface dark:placeholder:text-on-surface-variant/45 dark:focus:border-secondary/55 dark:focus:ring-secondary/20"
            />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {#if skillCatalogRows.length === 0}
              <div class="space-y-2 p-4 font-mono text-[10px] leading-relaxed text-slate-600 dark:text-on-surface-variant/80">
                {#if fsSkillSummaries.length === 0 && skills.length === 0}
                  <p>No skills found.</p>
                  <p class="text-slate-500 dark:text-on-surface-variant/65">
                    Create <code class="text-violet-700 dark:text-primary/90">.agents/skills/&lt;name&gt;/SKILL.md</code> (open skill layout), ensure the Cortex server cwd is the folder that contains <code class="text-slate-600 dark:text-on-surface-variant/55">.agents</code>, then <strong class="text-slate-800 dark:text-on-surface/80">Rescan</strong>.
                  </p>
                {:else}
                  <p>No skills match the filter.</p>
                  <p class="text-slate-500 dark:text-on-surface-variant/65">Clear the filter or try another name.</p>
                {/if}
              </div>
            {/if}
            {#each skillCatalogRows as row, idx (row.t === "hdr" ? `h-${idx}-${row.label}` : row.t === "fs" ? `f-${row.s.relPath}` : row.rowKey)}
              {#if row.t === "hdr"}
                <div
                  class="border-t border-[var(--cortex-border)] px-2 pb-1 pt-3 font-mono text-[9px] uppercase tracking-widest text-cyan-800 first:border-t-0 first:pt-1 dark:border-white/[0.06] dark:text-secondary/90"
                >
                  {row.label}
                </div>
              {:else if row.t === "fs"}
                <button
                  type="button"
                  class="w-full rounded-md border p-2.5 text-left transition-all {isFsSkillSelected(row.s)
                    ? 'border-primary/45 bg-violet-100/95 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.18)] dark:border-primary/50 dark:bg-primary/[0.2] dark:shadow-[0_0_24px_-10px_rgba(139,92,246,0.35)]'
                    : 'border-[var(--cortex-border)] bg-white/95 hover:border-primary/35 dark:border-white/10 dark:bg-surface-container-high/45 dark:hover:border-primary/40'}"
                  onclick={() => selectFilesystemSkill(row.s)}
                >
                  <div class="font-mono text-[11px] font-medium leading-snug text-slate-900 dark:text-on-surface">{row.s.name}</div>
                  <div class="mt-1 line-clamp-2 font-mono text-[9px] text-slate-600 dark:text-on-surface-variant/80">{row.s.description || "—"}</div>
                  <div class="mt-1.5 truncate font-mono text-[8px] text-slate-400 dark:text-on-surface-variant/50" title={row.s.relPath}>{row.s.relPath}</div>
                </button>
              {:else}
                <div class="flex items-stretch gap-1">
                  <button
                    type="button"
                    class="flex-1 rounded-md border p-2.5 text-left transition-all {isSqliteSkillSelected(row.s)
                      ? 'border-primary/45 bg-violet-100/95 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.18)] dark:border-primary/50 dark:bg-primary/[0.2] dark:shadow-[0_0_24px_-10px_rgba(139,92,246,0.35)]'
                      : 'border-[var(--cortex-border)] bg-white/95 hover:border-primary/35 dark:border-white/10 dark:bg-surface-container-high/45 dark:hover:border-primary/40'}"
                    onclick={() => selectSqliteSkill(row.s)}
                  >
                    <div class="mb-0.5 flex items-center gap-1.5">
                      <span class="rounded border border-[var(--cortex-border)] px-1 font-mono text-[7px] uppercase text-slate-500 dark:border-white/12 dark:text-on-surface-variant/70">db</span>
                      <span class="font-mono text-[11px] font-medium text-slate-900 dark:text-on-surface">{row.s.name ?? row.s.id ?? "skill"}</span>
                    </div>
                    <div class="line-clamp-2 font-mono text-[9px] text-slate-600 dark:text-on-surface-variant/80">{row.s.description ?? ""}</div>
                  </button>
                  <button
                    type="button"
                    onclick={() => (deleteConfirmSkill = row.s)}
                    class="flex cursor-pointer items-center justify-center rounded-md border border-[var(--cortex-border)] bg-transparent p-2.5 text-slate-500 transition-colors hover:border-error/40 hover:text-error dark:border-white/10 dark:text-on-surface-variant dark:hover:text-error"
                    title="Delete skill"
                  >
                    <span class="material-symbols-outlined text-sm">delete</span>
                  </button>
                </div>
              {/if}
            {/each}
          </div>
        </aside>

        <!-- 2 — Document (primary reading column) -->
        <main class="flex min-h-0 min-w-0 flex-col border-b border-[var(--cortex-border)] bg-white/80 dark:border-white/[0.08] dark:bg-surface-container-low/30 md:border-b-0 xl:border-r">
          {#if skillDetailLoading}
            <div class="flex flex-1 items-center justify-center gap-2 p-8 font-mono text-xs text-slate-500 dark:text-on-surface-variant/80">
              <span class="material-symbols-outlined animate-spin text-primary">progress_activity</span>
              Loading…
            </div>
          {:else if skillDetailError}
            <div class="m-4 rounded border border-error/40 bg-error/10 p-4 font-mono text-[11px] text-error dark:bg-error/15 dark:text-red-200">{skillDetailError}</div>
          {:else if skillDetail}
            <div class="flex-shrink-0 border-b border-[var(--cortex-border)] bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-surface-container-high/30">
              <div class="flex flex-wrap items-start gap-2">
                <span class="material-symbols-outlined shrink-0 text-xl text-cyan-700 dark:text-secondary" aria-hidden="true">bolt</span>
                <div class="min-w-0 flex-1">
                  <h3 class="font-headline text-lg font-bold uppercase tracking-tight text-slate-900 dark:text-on-surface">{skillDetail.name}</h3>
                  <div class="flex flex-wrap gap-1.5 mt-2">
                    <span
                      class="rounded border border-[var(--cortex-border)] px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider text-slate-600 dark:border-white/12 dark:text-on-surface-variant/85"
                    >
                      {skillDetail.filePath.startsWith("sqlite:") ? "SQLite" : "Open skill"}
                    </span>
                    {#if skillDetail.description}
                      <span class="rounded border border-cyan-400/40 px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider text-cyan-800 dark:border-secondary/35 dark:text-secondary/90">when to use</span>
                    {/if}
                  </div>
                </div>
              </div>
              {#if skillDetail.description}
                <p class="mt-3 border-l-2 border-cyan-500/50 pl-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-secondary/45 dark:text-on-surface/85">
                  {skillDetail.description}
                </p>
              {/if}
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto p-4">
              <div class="mb-2 font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/80">Core instructions</div>
              <MarkdownRich markdown={skillDetail.instructions} class="text-sm max-w-none" showCopy={true} />
            </div>
          {:else}
            <div class="flex flex-1 items-center justify-center px-6 py-16 text-center font-mono text-xs text-slate-500 dark:text-on-surface-variant/75">
              Pick a skill from the catalog to preview instructions.
            </div>
          {/if}
        </main>

        <!-- 3 — Meta sidebar (YAML, roots, wire-up) -->
        <aside
          class="flex max-h-[50vh] min-h-0 flex-col overflow-y-auto border-t border-[var(--cortex-border)] bg-slate-50/90 md:col-span-2 md:max-h-none xl:col-span-1 xl:max-h-full dark:border-white/[0.06] dark:bg-surface-container/40"
        >
          <div class="space-y-3 border-b border-[var(--cortex-border)] p-3 dark:border-white/[0.06]">
            <div class="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Skill roots scanned</div>
            <p class="font-mono text-[9px] leading-relaxed text-slate-600 dark:text-on-surface-variant/75">
              Under each scan base, Cortex looks for: <code class="text-cyan-800 dark:text-secondary/90">.agents/skills</code>,
              <code class="text-slate-700 dark:text-on-surface-variant/80">skills</code>, <code class="text-slate-700 dark:text-on-surface-variant/80">.claude/skills</code>,
              <code class="text-slate-700 dark:text-on-surface-variant/80">apps/cortex/.agents/skills</code> (last is for monorepo-root cwd).
            </p>
            {#if discoveredSkillPaths.length === 0}
              <p class="font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/65">No roots found on disk from this cwd.</p>
            {:else}
              <ul class="space-y-2">
                {#each discoveredSkillPaths as p (p)}
                  <li class="flex flex-col gap-1.5 font-mono text-[9px]">
                    <code class="break-all rounded bg-white px-2 py-1 text-cyan-800 shadow-sm dark:bg-surface-container-high/60 dark:text-secondary/90">{p}</code>
                    <button
                      type="button"
                      disabled={skillPathInBuilder(p)}
                      onclick={() => appendPathsToBuilderLivingSkills([p])}
                      class="self-start cursor-pointer rounded border border-primary/40 bg-primary/[0.08] px-2 py-1 text-[8px] text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40 dark:border-primary/50 dark:bg-primary/[0.14] dark:hover:bg-primary/[0.22]"
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
                  class="w-full cursor-pointer rounded-md border-0 py-2 font-mono text-[9px] uppercase text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition-all hover:brightness-110 dark:shadow-[0_0_26px_rgba(139,92,246,0.4)]"
                  style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
                >
                  Add all roots to Builder
                </button>
              {/if}
            {/if}
            <p class="font-mono text-[8px] leading-relaxed text-slate-500 dark:text-on-surface-variant/65">
              Framework runs use <strong class="text-slate-700 dark:text-on-surface/80">Living skills</strong> paths in Builder → Agent config.
            </p>
          </div>

          {#if skillDetail && !skillDetailLoading && !skillDetailError}
            <div class="p-3 space-y-3 flex-1">
              {#if skillDetail.declaredFields && Object.keys(skillDetail.declaredFields).length > 0}
                <div>
                  <div class="mb-2 font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/80">Frontmatter</div>
                  <div class="flex flex-wrap gap-1">
                    {#each Object.entries(skillDetail.declaredFields) as [k, v] (k)}
                      <span
                        class="max-w-full break-all rounded border border-[var(--cortex-border)] bg-white px-1.5 py-0.5 font-mono text-[8px] text-slate-800 dark:border-white/10 dark:bg-surface-container-high/55 dark:text-on-surface/90"
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
                  <summary class="flex cursor-pointer list-none items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-slate-600 dark:text-on-surface-variant/80">
                    <span class="material-symbols-outlined text-[14px] text-slate-400 dark:text-on-surface-variant/60">expand_more</span>
                    metadata block
                  </summary>
                  <pre
                    class="mt-2 max-h-40 overflow-y-auto overflow-x-auto break-words whitespace-pre-wrap rounded border border-[var(--cortex-border)] bg-white p-2 font-mono text-[9px] text-slate-800 dark:border-white/10 dark:bg-surface-container-high/50 dark:text-on-surface/85"
                  >{JSON.stringify(skillDetail.metadata, null, 2)}</pre>
                </details>
              {/if}
              {#if skillDetail.resources && (skillDetail.resources.scripts.length + skillDetail.resources.references.length + skillDetail.resources.assets.length > 0)}
                <div>
                  <div class="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/80">Resources</div>
                  <ul class="space-y-0.5 font-mono text-[9px] text-slate-600 dark:text-on-surface-variant/80">
                    {#if skillDetail.resources.scripts.length}<li>scripts: {skillDetail.resources.scripts.join(", ")}</li>{/if}
                    {#if skillDetail.resources.references.length}<li>references: {skillDetail.resources.references.join(", ")}</li>{/if}
                    {#if skillDetail.resources.assets.length}<li>assets: {skillDetail.resources.assets.join(", ")}</li>{/if}
                  </ul>
                </div>
              {/if}
              <div class="border-t border-[var(--cortex-border)] pt-2 font-mono text-[8px] text-slate-500 dark:border-white/[0.06] dark:text-on-surface-variant/65">
                File: <span class="break-all text-slate-700 dark:text-on-surface/75">{skillDetail.filePath}</span>
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

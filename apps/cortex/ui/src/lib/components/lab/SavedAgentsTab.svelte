<script lang="ts">
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import HighlightedField from "$lib/components/HighlightedField.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { SCHEDULE_PRESETS, relativeTime, type BuilderAgentConfig } from "$lib/lab-builder.js";
  import type { GatewayAgentsStore, GatewayRow, SavedAgentsUi } from "$lib/stores/gateway-agents-store.js";

  interface Props {
    store: GatewayAgentsStore;
    /** View state the page keeps across tab switches. */
    ui: SavedAgentsUi<BuilderAgentConfig>;
    /** Builder defaults (static defaults + Settings provider/model). */
    defaults: () => BuilderAgentConfig;
    /** Reload the list (keeps the selection to agents still listed). */
    onReload: () => Promise<void>;
    onNewAgent: () => void;
    onTrigger: (agent: GatewayRow) => void;
    onUseInBuilder: (agent: GatewayRow) => void;
    onExport: (target: { config: AgentConfig; name: string }) => void;
    onDelete: (agent: GatewayRow) => void;
    onDeleteMany: (agents: GatewayRow[]) => void;
  }
  let { store, ui = $bindable(), defaults, onReload, onNewAgent, onTrigger, onUseInBuilder, onExport, onDelete, onDeleteMany }: Props = $props();

  const gatewayAgents = $derived($store.agents);
  const gatewayLoading = $derived($store.loading);
  const agentStats = $derived($store.stats);
  let gatewaySelectAllEl = $state<HTMLInputElement | undefined>(undefined);

  $effect(() => {
    for (const agent of gatewayAgents) void store.loadStats(agent.agentId);
  });

  $effect(() => {
    const el = gatewaySelectAllEl;
    if (!el) return;
    const n = ui.selected.size;
    const t = gatewayAgents.length;
    el.indeterminate = t > 0 && n > 0 && n < t;
  });

  function openEdit(agent: GatewayRow) {
    ui.formConfig = { ...defaults(), ...agent.config };
    ui.formName = agent.name; ui.formSchedule = agent.schedule ?? "";
    ui.formAgentType = agent.agentType;
    ui.editingAgent = agent; ui.showForm = true;
  }

  async function saveAgent() {
    if (!ui.formName.trim()) { toast.warning("Name is required"); return; }
    ui.formSaving = true;
    try {
      await store.save(ui.editingAgent?.agentId ?? null, {
        name: ui.formName.trim(),
        type: ui.formAgentType,
        config: { ...ui.formConfig, prompt: ui.formConfig.prompt.trim() },
        schedule: ui.formAgentType === "gateway" ? (ui.formSchedule.trim() || null) : null,
      });
      toast.success(ui.editingAgent ? "Agent updated" : "Agent created");
      ui.showForm = false;
      await onReload();
    } catch (e) {
      toast.error("Save failed", String(e));
    } finally { ui.formSaving = false; }
  }

  async function toggleStatus(agent: GatewayRow) {
    await store.toggleStatus(agent);
    await onReload();
  }

  function gatewayAllSelected(): boolean {
    return gatewayAgents.length > 0 && gatewayAgents.every((a) => ui.selected.has(a.agentId));
  }

  function onGatewaySelectAllChange(ev: Event) {
    const el = ev.currentTarget as HTMLInputElement;
    if (el.checked) ui.selected = new Set(gatewayAgents.map((a) => a.agentId));
    else ui.selected = new Set();
  }

  function toggleGatewayAgentSelected(agentId: string, selected: boolean) {
    const next = new Set(ui.selected);
    if (selected) next.add(agentId);
    else next.delete(agentId);
    ui.selected = next;
  }

  function selectedGatewayAgents(): GatewayRow[] {
    return gatewayAgents.filter((a) => ui.selected.has(a.agentId));
  }
</script>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if ui.showForm}
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-5">
        <div class="mx-auto w-full max-w-5xl space-y-5 xl:max-w-6xl 2xl:max-w-7xl">
          <div class="flex shrink-0 items-center justify-between gap-3">
            <h2 class="font-headline text-base font-semibold text-slate-900 dark:text-on-surface">
              {ui.editingAgent
                ? (ui.formAgentType === "gateway" ? "Edit Gateway Agent" : "Edit Ad-hoc Agent")
                : "New Gateway Agent"}
            </h2>
            <button type="button" onclick={() => (ui.showForm = false)}
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
                  <div class={ui.formAgentType === "gateway" ? "" : "sm:col-span-2 lg:col-span-1"}>
                    <label for="gateway-agent-name" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Name *</label>
                    <input id="gateway-agent-name" bind:value={ui.formName} placeholder="my-gateway-agent"
                      class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
                  </div>
                  {#if ui.formAgentType === "gateway"}
                    <div class="sm:col-span-2 lg:col-span-1">
                      <label for="gateway-agent-schedule" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">
                        Schedule <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/50">(preset or cron, blank = manual)</span>
                      </label>
                      <div class="mb-1.5 flex flex-wrap gap-1">
                        {#each SCHEDULE_PRESETS as preset}
                          <button type="button"
                            onclick={() => (ui.formSchedule = preset.cron)}
                            class="cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[8px] transition-colors
                                   {ui.formSchedule === preset.cron
                              ? 'border-primary/45 bg-violet-100/90 text-violet-900 dark:border-primary/50 dark:bg-primary/[0.18] dark:text-primary'
                              : 'border-[var(--cortex-border)] text-slate-500 hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:border-primary/40 dark:hover:text-primary'}">
                            {preset.label}
                          </button>
                        {/each}
                        {#if ui.formSchedule && !SCHEDULE_PRESETS.some(p => p.cron === ui.formSchedule)}
                          <span class="self-center font-mono text-[8px] text-slate-400 dark:text-on-surface-variant/45">custom:</span>
                        {/if}
                      </div>
                      <input id="gateway-agent-schedule" bind:value={ui.formSchedule} placeholder="*/5 * * * *  or leave blank for manual"
                        class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
                      {#if ui.formSchedule}
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
                  <div class="mb-1.5 flex items-end justify-between gap-2">
                    <label for="gateway-edit-prompt" class="block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">
                      Prompt <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/50">(default task — same as Builder tab)</span>
                    </label>
                    <PromptPickerButton
                      types={["task", "snippet"]}
                      defaultSaveType="task"
                      placement="down"
                      title="Insert a saved prompt"
                      onSelect={(body) => {
                        ui.formConfig = { ...ui.formConfig, prompt: ui.formConfig.prompt ? `${ui.formConfig.prompt}\n${body}` : body };
                      }}
                    />
                  </div>
                  <HighlightedField
                    multiline
                    id="gateway-edit-prompt"
                    value={ui.formConfig.prompt}
                    oninput={(e) => (ui.formConfig.prompt = (e.currentTarget as HTMLTextAreaElement).value)}
                    placeholder="Describe what this agent should do when triggered or on schedule…"
                    rows={5}
                    frameClass="rounded-lg border border-[var(--cortex-border)] bg-white shadow-sm transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus-within:border-secondary/55 dark:focus-within:ring-secondary/20"
                    textClass="w-full resize-y bg-transparent px-4 py-3 font-mono text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400 dark:text-on-surface dark:placeholder:text-on-surface-variant/50 min-h-[7.5rem] lg:min-h-[11rem]"
                  />
                  <p class="mt-1 font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/65">
                    Model-level instructions live in <span class="text-slate-700 dark:text-on-surface/80">Inference → System Prompt</span> in the panel on the right.
                  </p>
                </div>
              </div>

              <div
                class="flex shrink-0 flex-col gap-2 border-t border-[var(--cortex-border)] pt-4 dark:border-white/10"
              >
                <div class="flex flex-wrap justify-end gap-2">
                  <button type="button" onclick={() => (ui.showForm = false)}
                    class="cursor-pointer rounded border border-[var(--cortex-border)] bg-transparent px-4 py-2 font-mono text-[10px] uppercase text-slate-600 transition-colors hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:text-on-surface">
                    Cancel</button>
                  <button type="button" disabled={ui.formSaving} onclick={saveAgent}
                    class="cursor-pointer rounded border-0 px-6 py-2 font-mono text-[10px] uppercase text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition-all hover:brightness-110 disabled:opacity-40 dark:shadow-[0_0_28px_rgba(139,92,246,0.4)]"
                    style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
                    {ui.formSaving ? "Saving…" : ui.editingAgent ? "Save Changes" : "Create Agent"}
                  </button>
                </div>
              </div>
            </aside>

            <div class="min-w-0">
              <AgentConfigPanel bind:config={ui.formConfig} />
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
            {#if ui.selected.size > 0}
              <button
                type="button"
                onclick={() => onDeleteMany(selectedGatewayAgents())}
                class="cursor-pointer rounded-md border border-error/35 bg-error/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide text-error transition-colors hover:bg-error/20 dark:border-error/40 dark:bg-error/15 dark:hover:bg-error/25"
              >
                Delete selected ({ui.selected.size})
              </button>
            {/if}
          </div>
          <button type="button" onclick={onNewAgent}
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
                  checked={ui.selected.has(agent.agentId)}
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
                  {#if agentStats[agent.agentId] && agentStats[agent.agentId].runCount > 0}
                    {@const s = agentStats[agent.agentId]}
                    <div class="flex gap-3 font-mono text-[9px] text-outline mt-1 tabular-nums">
                      <span>{Math.round(s.successRate * 100)}% ok</span>
                      <span>{Math.round(s.avgTokens).toLocaleString()} avg tok</span>
                      {#if s.totalCostUsd > 0}<span>${(s.totalCostUsd * 100).toFixed(2)}¢ total</span>{/if}
                    </div>
                  {/if}
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <!-- Run: gateway (manual fire vs cron) and ad-hoc (on-demand saved config) -->
                  <button type="button" onclick={() => onTrigger(agent)}
                    disabled={ui.triggeringAgent === agent.agentId || (agent.agentType === "gateway" && !!agent.processRunning)}
                    class="cursor-pointer rounded border border-primary/40 bg-primary/[0.08] px-2 py-1 font-mono text-[9px] text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40 dark:border-primary/50 dark:bg-primary/[0.14] dark:text-primary dark:hover:bg-primary/[0.22]"
                    title={agent.agentType === "gateway" ? "Run now (ignores schedule)" : "Run now using saved config"}>
                    {ui.triggeringAgent === agent.agentId ? "…" : "▶ Run"}
                  </button>
                  <button type="button" onclick={() => onUseInBuilder(agent)}
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
                  <button type="button" onclick={() => onExport({ config: agent.config, name: agent.name })}
                    class="material-symbols-outlined cursor-pointer border-0 bg-transparent p-1 text-sm text-slate-500 hover:text-primary dark:text-on-surface-variant dark:hover:text-primary"
                    title="Export agent (TS / JSON)">ios_share</button>
                  <button type="button" onclick={() => onDelete(agent)}
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

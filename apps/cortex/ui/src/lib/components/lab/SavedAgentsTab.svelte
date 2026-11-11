<script lang="ts">
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import HighlightedField from "$lib/components/HighlightedField.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { SCHEDULE_PRESETS, relativeTime, type BuilderAgentConfig } from "$lib/lab-builder.js";
  import { savedAgentStatusOf, type GatewayAgentsStore, type GatewayRow, type SavedAgentsUi } from "$lib/stores/gateway-agents-store.js";
  import { formatCost, formatTokens } from "@reactive-agents/ui-core";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";

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

<div class="saved">
{#if ui.showForm}
  <div class="form-wrap">
    <div class="form-h">
      <h2>
        {ui.editingAgent
          ? (ui.formAgentType === "gateway" ? "Edit gateway agent" : "Edit on-demand agent")
          : "New gateway agent"}
      </h2>
      <IconButton icon="x" label="Close the form" onclick={() => (ui.showForm = false)} />
    </div>

    <div class="form-grid">
      <aside class="form-side">
        <Field id="gateway-agent-name" label="Name">
          <Input id="gateway-agent-name" bind:value={ui.formName} mono placeholder="my-gateway-agent" />
        </Field>
        {#if ui.formAgentType === "gateway"}
          <div class="sched">
            <Field id="gateway-agent-schedule" label="Schedule" hint={ui.formSchedule ? "The process starts now and runs on this schedule." : "No schedule: use Run to start it by hand."}>
              <Input id="gateway-agent-schedule" bind:value={ui.formSchedule} mono placeholder="*/5 * * * * (cron), or blank" describedBy="gateway-agent-schedule-hint" />
            </Field>
            <div class="presets" role="group" aria-label="Schedule presets">
              {#each SCHEDULE_PRESETS as preset (preset.cron)}
                <Chip on={ui.formSchedule === preset.cron} onclick={() => (ui.formSchedule = preset.cron)}>{preset.label}</Chip>
              {/each}
            </div>
          </div>
        {:else}
          <p class="note">On-demand agents run only when you start them (Run or the API); they have no schedule.</p>
        {/if}

        <div class="task">
          <div class="task-h">
            <label for="gateway-edit-prompt">Task</label>
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
            placeholder="What this agent does when it is started or its schedule fires"
            rows={6}
            frameClass="ci-frame"
            textClass="ci-text task-text resize-y"
          />
          <p class="note">Model instructions live in the settings on the right (Model · System prompt).</p>
        </div>

        <div class="form-actions">
          <Button variant="ghost" onclick={() => (ui.showForm = false)}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={ui.formSaving} onclick={saveAgent}>
            {ui.formSaving ? "Saving…" : ui.editingAgent ? "Save changes" : "Create agent"}
          </Button>
        </div>
      </aside>

      <div class="min-w-0">
        <AgentConfigPanel bind:config={ui.formConfig} />
      </div>
    </div>
  </div>
{:else}
  <div class="list-wrap">
    <div class="toolbar">
      <span class="count">{gatewayAgents.length} agent{gatewayAgents.length !== 1 ? "s" : ""}</span>
      {#if gatewayAgents.length > 0}
        <label class="selall">
          <input
            bind:this={gatewaySelectAllEl}
            type="checkbox"
            checked={gatewayAllSelected()}
            onchange={onGatewaySelectAllChange}
          />
          Select all
        </label>
      {/if}
      {#if ui.selected.size > 0}
        <Button size="sm" variant="danger" icon="trash" onclick={() => onDeleteMany(selectedGatewayAgents())}>Delete {ui.selected.size}</Button>
      {/if}
      <span class="grow"></span>
      <Button variant="primary" icon="plus" onclick={onNewAgent}>New agent</Button>
    </div>

    <div class="list">
    {#if gatewayLoading}
      <p class="note" role="status">Loading saved agents…</p>
    {:else if gatewayAgents.length === 0}
      <EmptyState icon="agents" title="No saved agents yet" description="Save an agent from the Builder to run it on demand or keep it running as a gateway process.">
        {#snippet actions()}
          <Button size="sm" variant="primary" icon="plus" onclick={onNewAgent}>New agent</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="rows">
      {#each gatewayAgents as agent (agent.agentId)}
        {@const st = savedAgentStatusOf(agent.status)}
        {@const s = agentStats[agent.agentId]}
        <li class="row">
          <input
            type="checkbox"
            class="sel"
            checked={ui.selected.has(agent.agentId)}
            onchange={(e) => toggleGatewayAgentSelected(agent.agentId, (e.currentTarget as HTMLInputElement).checked)}
            aria-label={`Select ${agent.name}`}
          />
          <div class="main">
            <div class="name-line">
              <span class="name">{agent.name}</span>
              <Badge tone={agent.agentType === "gateway" ? "accent" : "neutral"}>{agent.agentType === "gateway" ? "Gateway" : "On demand"}</Badge>
              <Badge tone={st.tone}>{st.label}</Badge>
              {#if agent.schedule}<Badge tone="io" data><Icon name="clock" size="sm" />{agent.schedule}</Badge>{/if}
            </div>
            <div class="meta">
              <span>{agent.config?.provider ?? "?"} / {agent.config?.model || "default"}</span>
              <span>{agent.config?.strategy ?? "reactive"}</span>
              <span>{agent.runCount} run{agent.runCount === 1 ? "" : "s"}</span>
              {#if agent.lastRunAt}<span>last {relativeTime(agent.lastRunAt)}</span>{/if}
              {#if s && s.runCount > 0}
                <span>{Math.round(s.successRate * 100)}% ok</span>
                <span>{formatTokens(Math.round(s.avgTokens))} avg tok</span>
                {#if s.totalCostUsd > 0}<span>{formatCost(s.totalCostUsd)} total</span>{/if}
              {/if}
            </div>
          </div>
          <div class="actions">
            <Button size="sm" icon="play"
              onclick={() => onTrigger(agent)}
              disabled={ui.triggeringAgent === agent.agentId || (agent.agentType === "gateway" && !!agent.processRunning)}
              title={agent.agentType === "gateway" ? "Run now (ignores the schedule)" : "Run now with the saved settings"}>
              {ui.triggeringAgent === agent.agentId ? "Starting…" : "Run"}
            </Button>
            {#if agent.agentType === "gateway"}
              <Button size="sm" icon={agent.status === "active" ? "pause" : "power"} onclick={() => toggleStatus(agent)}>
                {agent.status === "active" ? "Pause" : "Activate"}
              </Button>
            {/if}
            <Button size="sm" variant="ghost" onclick={() => onUseInBuilder(agent)} title="Load this agent's settings into the Builder">Use in Builder</Button>
            <IconButton icon="edit" size="sm" label={`Edit ${agent.name}`} onclick={() => openEdit(agent)} />
            <IconButton icon="external" size="sm" label={`Export ${agent.name}`} onclick={() => onExport({ config: agent.config, name: agent.name })} />
            <IconButton icon="trash" size="sm" label={`Delete ${agent.name}`} onclick={() => onDelete(agent)} />
          </div>
        </li>
      {/each}
      </ul>
    {/if}
    </div>
  </div>
{/if}
</div>

<style>
  .saved { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .form-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 32px 48px; }
  .form-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  .form-h h2 { margin: 0; font-size: var(--cortex-t-lg); font-weight: 600; color: var(--cortex-text); }
  .form-grid { display: grid; grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr); gap: 32px; align-items: start; }
  .form-side { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 0; }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 16px; border-top: 1px solid var(--cortex-line); }
  .sched { display: grid; gap: 8px; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .task { display: grid; gap: 6px; }
  .task-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .task-h label { font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .task :global(.task-text) { min-height: 8.5rem; font-family: var(--cortex-font-ui); font-size: var(--cortex-t-sm); }
  .note { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }

  .list-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 16px 32px 24px; gap: 12px; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .count { font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .selall { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); cursor: pointer; }
  .selall input, .sel { accent-color: var(--cortex-accent-fill); }
  .grow { flex: 1; }
  .list { flex: 1; min-height: 0; overflow-y: auto; }
  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-width: 1280px; }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border-radius: var(--cortex-r-panel);
    border: 1px solid var(--cortex-line);
    background: var(--cortex-surface-1);
  }
  .sel { margin-top: 4px; flex: none; }
  .main { flex: 1; min-width: 0; display: grid; gap: 6px; }
  .name-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .name { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px; flex: none; }
  @media (max-width: 1100px) { .form-grid { grid-template-columns: 1fr; } .form-side { position: static; } }
</style>

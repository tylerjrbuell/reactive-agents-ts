<script lang="ts">
  /**
   * The Lab builder (Bench `lab.html`): three columns. The section nav (from
   * the `BUILDER_NAV` registry, with "Find a setting"), one section group at a
   * time (AgentConfigPanel in nav mode, so the builder edits the same config
   * every other surface does), and the "Run this agent" launch panel.
   */
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import LaunchPanel from "./LaunchPanel.svelte";
  import BuilderSectionNav from "./BuilderSectionNav.svelte";
  import { builderNavEntry } from "$lib/agent-config-sections.js";
  import type { BuilderAdHocAction, BuilderAgentConfig } from "$lib/lab-builder.js";

  interface Props {
    config: BuilderAgentConfig;
    agentType?: "ad-hoc" | "persistent";
    name?: string;
    schedule?: string;
    /** Selected section-nav entry (kept by the page across tab switches). */
    section?: string;
    running: boolean;
    saving: boolean;
    /** Strategy display name for the summary (`ReAct` for `reactive`). */
    strategyLabel?: string;
    onAction: (action: BuilderAdHocAction) => void | Promise<void>;
    onCreatePersistent: () => void | Promise<void>;
  }
  let {
    config = $bindable(), agentType = $bindable("ad-hoc"), name = $bindable(""), schedule = $bindable(""), section = $bindable("model"),
    running, saving, strategyLabel, onAction, onCreatePersistent,
  }: Props = $props();

  const entry = $derived(builderNavEntry(section));

  // A new section opens at its top.
  let formEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    void entry.id;
    formEl?.scrollTo({ top: 0 });
  });
</script>

<div class="builder">
  <BuilderSectionNav bind:value={section} {config} />

  <div class="form" role="region" aria-labelledby="lab-section-title" bind:this={formEl}>
    <div class="form-h">
      <h2 id="lab-section-title">{entry.label}</h2>
      <p>{entry.description}</p>
    </div>
    <AgentConfigPanel bind:config navSection={entry.id} onNavigate={(id) => (section = id)} />
  </div>

  <LaunchPanel
    bind:config
    bind:agentType
    bind:name
    bind:schedule
    {running}
    {saving}
    {strategyLabel}
    {onAction}
    {onCreatePersistent}
  />
</div>

<style>
  .builder {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) 340px;
  }
  .form {
    min-height: 0;
    overflow-y: auto;
    padding: 20px 32px 48px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .form > :global(*) { width: 100%; max-width: 880px; }
  .form-h h2 { margin: 0; font-size: var(--cortex-t-lg); font-weight: 600; color: var(--cortex-text); }
  .form-h p { margin: 4px 0 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  @media (max-width: 1100px) {
    .builder { grid-template-columns: 200px minmax(0, 1fr); grid-template-rows: auto auto; overflow-y: auto; }
    .builder > :global(.launch) { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--cortex-line); }
  }
</style>

<script lang="ts">
  /**
   * "Run this agent" (Bench `lab.html`): the agent kind (On demand / Gateway
   * process), its name, the task, a gateway schedule, a summary of what will
   * run, then Save and run / Save (on demand: also Run without saving) or
   * Create gateway agent. The page runs the action (`onAction`).
   */
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import HighlightedField from "$lib/components/HighlightedField.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import {
    SCHEDULE_PRESETS,
    adHocPrimaryDisabled,
    adHocPrimaryTitle,
    launchSummaryOf,
    type BuilderAdHocAction,
    type BuilderAgentConfig,
  } from "$lib/lab-builder.js";

  interface Props {
    config: BuilderAgentConfig;
    agentType?: "ad-hoc" | "persistent";
    name?: string;
    schedule?: string;
    running: boolean;
    saving: boolean;
    /** Strategy display name for the summary. */
    strategyLabel?: string;
    /** Run, save, or save and run (on-demand agents). */
    onAction: (action: BuilderAdHocAction) => void | Promise<void>;
    /** Create the gateway (persistent) agent. */
    onCreatePersistent: () => void | Promise<void>;
  }
  let {
    config = $bindable(), agentType = $bindable("ad-hoc"), name = $bindable(""), schedule = $bindable(""),
    running, saving, strategyLabel, onAction, onCreatePersistent,
  }: Props = $props();

  const busy = $derived(running || saving);
  const btn = (action: BuilderAdHocAction) => ({ action, busy, prompt: config.prompt, name });
  const summary = $derived(launchSummaryOf(config, strategyLabel));
  /** Why Save and run is off (shown under the buttons; the title says the same). */
  const saveRunHint = $derived(
    !busy && adHocPrimaryDisabled(btn("save-run"))
      ? !name.trim()
        ? "Name the agent to save it."
        : (adHocPrimaryTitle(btn("save-run")) ?? "")
      : "",
  );
</script>

<aside class="launch" aria-labelledby="lab-launch-title">
  <h2 id="lab-launch-title">Run this agent</h2>

  <div class="seg" role="group" aria-label="Agent kind">
    <button type="button" aria-pressed={agentType === "ad-hoc"} onclick={() => (agentType = "ad-hoc")}>On demand</button>
    <button type="button" aria-pressed={agentType === "persistent"} onclick={() => (agentType = "persistent")}>Gateway process</button>
  </div>

  <Field id="builder-persistent-name" label="Name" hint={agentType === "persistent" ? "The gateway process runs under this name." : "Needed to save; a run without saving needs none."}>
    <Input id="builder-persistent-name" bind:value={name} mono placeholder={agentType === "persistent" ? "my-gateway-agent" : "research-assistant"} describedBy="builder-persistent-name-hint" />
  </Field>

  <div class="task">
    <div class="task-h">
      <label for="builder-prompt">Task</label>
      <PromptPickerButton
        types={["task", "snippet"]}
        defaultSaveType="task"
        placement="down"
        title="Insert a saved prompt"
        onSelect={(body) => {
          config = { ...config, prompt: config.prompt ? `${config.prompt}\n${body}` : body };
        }}
      />
    </div>
    <HighlightedField
      multiline
      id="builder-prompt"
      value={config.prompt}
      oninput={(e) => (config.prompt = (e.currentTarget as HTMLTextAreaElement).value)}
      placeholder="Describe what the agent should do"
      rows={6}
      frameClass="ci-frame"
      textClass="ci-text task-text resize-y"
    />
    <p class="hint">Write <code>{"{{name}}"}</code> to ask for a value at run time.</p>
  </div>

  {#if agentType === "persistent"}
    <div class="sched">
      <Field id="builder-persistent-schedule" label="Schedule" hint={schedule ? "The process starts now and runs on this schedule." : "No schedule: start the process from Saved agents."}>
        <Input id="builder-persistent-schedule" bind:value={schedule} mono placeholder="*/5 * * * * (cron), or blank" describedBy="builder-persistent-schedule-hint" />
      </Field>
      <div class="presets" role="group" aria-label="Schedule presets">
        {#each SCHEDULE_PRESETS as preset (preset.cron)}
          <Chip on={schedule === preset.cron} onclick={() => (schedule = preset.cron)}>{preset.label}</Chip>
        {/each}
      </div>
    </div>
  {/if}

  <dl class="summary" aria-label="What will run">
    {#each summary as row (row.label)}
      <div><dt>{row.label}</dt><dd use:tooltip={row.value}>{row.value}</dd></div>
    {/each}
  </dl>

  {#if agentType === "ad-hoc"}
    <div class="split">
      <Button
        variant="primary"
        icon="send"
        disabled={adHocPrimaryDisabled(btn("save-run"))}
        title={adHocPrimaryTitle(btn("save-run"))}
        onclick={() => void onAction("save-run")}
      >{saving ? "Saving…" : "Save and run"}</Button>
      <Button disabled={adHocPrimaryDisabled(btn("save"))} onclick={() => void onAction("save")}>Save</Button>
    </div>
    <Button variant="ghost" icon="play" disabled={adHocPrimaryDisabled(btn("run"))} onclick={() => void onAction("run")}>
      {running ? "Starting…" : "Run without saving"}
    </Button>
    {#if saveRunHint}<p class="hint" role="status">{saveRunHint}</p>{/if}
  {:else}
    <Button variant="primary" icon="server" disabled={!name.trim() || saving} onclick={() => void onCreatePersistent()}>
      {saving ? "Creating…" : "Create gateway agent"}
    </Button>
  {/if}
</aside>

<style>
  .launch {
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    border-left: 1px solid var(--cortex-line);
    background: var(--cortex-surface-1);
  }
  h2 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .seg { display: grid; grid-template-columns: 1fr 1fr; padding: 2px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .seg button {
    border: 0;
    background: none;
    padding: 6px;
    border-radius: 6px;
    font-family: var(--cortex-font-ui);
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-2);
    cursor: pointer;
  }
  .seg button[aria-pressed="true"] { background: var(--cortex-surface-1); color: var(--cortex-text); box-shadow: 0 0 0 1px var(--cortex-line-strong); }
  .seg button:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; }
  .task { display: grid; gap: 6px; }
  .task-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .task-h label { font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .task :global(.task-text) { min-height: 8.5rem; font-family: var(--cortex-font-ui); font-size: var(--cortex-t-sm); }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .hint code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-accent); background: var(--cortex-accent-tint); padding: 0 4px; border-radius: 4px; }
  .sched { display: grid; gap: 8px; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .summary {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 12px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-canvas);
    font-size: var(--cortex-t-xs);
  }
  .summary div { display: flex; justify-content: space-between; gap: 12px; min-width: 0; }
  .summary dt { color: var(--cortex-text-2); }
  .summary dd {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    font-weight: 500;
    color: var(--cortex-text);
  }
  .split { display: flex; gap: 6px; }
  .split :global(.cx-btn-primary) { flex: 1; justify-content: center; }
</style>

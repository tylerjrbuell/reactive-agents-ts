<script lang="ts">
  /**
   * The plan's steps as a checklist. Read-only it shows each step's status and tool hint; editable it
   * lets the user reword, reorder, remove and add steps (rules in `lib/plan-edit.ts`, which the
   * parent applies through `onchange`). The list is the framework `Plan`'s: nothing here decides what
   * a step means. One compact line per step: status dot, the title taking the width, a small tool
   * control, a chip for dependencies/args that opens its editor in place, and icon-only controls.
   * Row rules: `lib/plan-row.ts`.
   */
  import { tick } from "svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import { extrasChip, toggleId, toolControl } from "$lib/plan-row.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import type { SelectOption } from "$lib/select.js";
  import { addStep, moveStep, removeStep, setStepTitle, setStepTool, stepStatusLabel, type DraftStep } from "$lib/plan-edit.js";
  import { dependsLabel, NO_EXTRAS, setArgs, toggleDependsOn, type ExtrasMap } from "$lib/plan-extras.js";
  import PlanStepExtrasEditor from "./PlanStepExtrasEditor.svelte";

  interface Props {
    steps: readonly DraftStep[];
    editable?: boolean;
    /** The edited list (editable only). */
    onchange?: (next: readonly DraftStep[]) => void;
    /** Each step's `dependsOn` / `args` (`lib/plan-extras.ts`); shown read-only as chips, editable in a fold under the step. */
    extras?: ExtrasMap;
    /** The edited extras (editable only). */
    onextras?: (next: ExtrasMap) => void;
    /** Unique per card on the page: prefixes the input ids. */
    idBase: string;
    /** The tools a step may name (`lib/plan-tool-options.ts`); "No tool" clears the hint. */
    toolChoices?: readonly SelectOption[];
  }
  const { steps, editable = false, onchange, extras = NO_EXTRAS, onextras, idBase, toolChoices }: Props = $props();

  const ICON = { pending: "circle", "in-progress": "retry", done: "check-circle", skipped: "skip-forward" } as const;
  let newTitle = $state("");
  // Rows whose dependencies/args editor is open, and rows whose "+ tool" was clicked (the pick list shows).
  let openExtras = $state<readonly string[]>([]);
  let toolShown = $state<readonly string[]>([]);

  function add() {
    const next = addStep(steps, newTitle);
    if (next === steps) return;
    onchange?.(next);
    newTitle = "";
    // Keep typing: the next step goes in the same box.
    void tick().then(() => document.getElementById(`${idBase}-new`)?.focus());
  }
  const rename = (id: string, e: Event) => onchange?.(setStepTitle(steps, id, (e.currentTarget as HTMLInputElement).value));
  // The tool dropdown's choices; with none given, a step can only keep the hint it has.
  const toolOptions = $derived<readonly SelectOption[]>(toolChoices ?? [{ value: "", label: "No tool" }, ...steps.flatMap((s) => (s.tool !== undefined ? [{ value: s.tool, label: s.tool }] : []))]);
</script>

<ol class="steps" data-testid="plan-steps">
  {#each steps as step, i (step.id)}
    {@const chip = extrasChip(steps, extras[step.id])}
    {@const panelId = `${idBase}-x-${step.id}`}
    {@const extrasOpen = openExtras.includes(step.id)}
    <li class="step" class:ro={!editable} data-status={step.status} data-testid="plan-step">
      <div class="line">
        <span class="ico" role="img" aria-label={stepStatusLabel(step.status)}><Icon name={ICON[step.status]} size="sm" /></span>
        {#if editable}
          <Input id="{idBase}-t-{step.id}" class="title-in" value={step.title} aria-label="Step {i + 1} title" onchange={(e) => rename(step.id, e)} />
          {#if toolControl(step.tool, toolShown.includes(step.id)) === "select"}
            <Select id="{idBase}-h-{step.id}" class="tool-in" value={step.tool ?? ""} options={toolOptions} placeholder="No tool" aria-label="Step {i + 1} tool" onchange={(v) => onchange?.(setStepTool(steps, step.id, v))} />
          {:else}
            <Chip icon="plus" class="add-tool" title="Give step {i + 1} a tool" onclick={() => (toolShown = toggleId(toolShown, step.id))}>tool</Chip>
          {/if}
          <button type="button" class="xchip" class:set={chip.set} aria-expanded={extrasOpen} aria-controls={panelId} use:tooltip={"Dependencies and args for step " + (i + 1)} onclick={() => (openExtras = toggleId(openExtras, step.id))} data-testid="plan-step-extras-toggle">{chip.label}</button>
          <span class="ctl">
            <IconButton icon="down" size="sm" class="up" label="Move step {i + 1} up" disabled={i === 0} onclick={() => onchange?.(moveStep(steps, step.id, -1))} />
            <IconButton icon="down" size="sm" label="Move step {i + 1} down" disabled={i === steps.length - 1} onclick={() => onchange?.(moveStep(steps, step.id, 1))} />
            <IconButton icon="trash" size="sm" label="Remove step {i + 1}" onclick={() => onchange?.(removeStep(steps, step.id))} />
          </span>
        {:else}
          <span class="title">{step.title}</span>
          {#if step.tool}<span class="tool">{step.tool}</span>{/if}
          {#if extras[step.id]?.dependsOn}<span class="tool" data-testid="plan-step-after">{dependsLabel(steps, extras[step.id]?.dependsOn)}</span>{/if}
          {#if extras[step.id]?.args}<span class="tool" data-testid="plan-step-args">args</span>{/if}
        {/if}
      </div>
      {#if editable}
        <PlanStepExtrasEditor
          open={extrasOpen}
          {panelId}
          stepId={step.id}
          position={i + 1}
          {steps}
          extras={extras[step.id] ?? {}}
          {idBase}
          ontoggle={(dep) => onextras?.(toggleDependsOn(extras, step.id, dep))}
          onargs={(args) => onextras?.(setArgs(extras, step.id, args))}
        />
      {/if}
    </li>
  {/each}
</ol>

{#if editable}
  <form class="add" onsubmit={(e) => { e.preventDefault(); add(); }}>
    <Input id="{idBase}-new" bind:value={newTitle} placeholder="Add a step" aria-label="New step title" />
    <Button size="field" icon="plus" type="submit" disabled={newTitle.trim() === ""} data-testid="plan-add-step">Add</Button>
  </form>
{/if}

<style>
  /* Compact rows: the plan's controls are 28px tall here (the kit's control-height token, set locally). */
  .steps { --cortex-control-h: 28px; margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
  .step { min-width: 0; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); }
  .line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
  .step.ro .line { align-items: baseline; gap: 2px 6px; }
  .ico { display: inline-flex; flex: none; color: var(--cortex-text-3); }
  .xchip { flex: none; height: 24px; padding: 0 8px; border: 1px dashed var(--cortex-line-strong); border-radius: var(--cortex-r-chip); background: transparent; color: var(--cortex-text-3); font-family: var(--cortex-font-ui); font-size: var(--cortex-t-xs); white-space: nowrap; cursor: pointer; }
  .xchip.set { border-style: solid; border-color: transparent; background: var(--cortex-surface-2); color: var(--cortex-text-2); font-family: var(--cortex-font-data); }
  .xchip:hover, .xchip[aria-expanded="true"] { color: var(--cortex-text); border-color: var(--cortex-line-strong); }
  .xchip:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .line :global(.add-tool) { flex: none; background: transparent; color: var(--cortex-text-3); border: 1px dashed var(--cortex-line-strong); }
  .step[data-status="done"] .ico { color: var(--cortex-ok); }
  .step[data-status="in-progress"] .ico { color: var(--cortex-accent); }
  .step[data-status="done"] .title, .step[data-status="skipped"] .title { color: var(--cortex-text-2); }
  .title { min-width: 0; overflow-wrap: anywhere; }
  .tool { flex: none; padding: 0 6px; border-radius: var(--cortex-r-chip); background: var(--cortex-surface-2); color: var(--cortex-text-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .step :global(.title-in) { flex: 1 1 180px; min-width: 0; }
  .step :global(.tool-in) { flex: 0 1 128px; min-width: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .ctl { display: inline-flex; flex: none; margin-left: auto; }
  .ctl :global(.up) { transform: rotate(180deg); }
  .add { display: flex; gap: 6px; margin-top: 8px; }
  .add :global(input) { flex: 1 1 auto; min-width: 0; }
</style>

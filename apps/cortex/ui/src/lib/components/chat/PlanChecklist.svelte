<script lang="ts">
  /**
   * The plan's steps as a checklist. Read-only it shows each step's status and tool hint; editable it
   * lets the user reword, reorder, remove and add steps (rules in `lib/plan-edit.ts`, which the
   * parent applies through `onchange`). The list is the framework `Plan`'s: nothing here decides what
   * a step means.
   */
  import { tick } from "svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import type { SelectOption } from "$lib/select.js";
  import { addStep, moveStep, removeStep, setStepTitle, setStepTool, stepStatusLabel, type DraftStep } from "$lib/plan-edit.js";

  interface Props {
    steps: readonly DraftStep[];
    editable?: boolean;
    /** The edited list (editable only). */
    onchange?: (next: readonly DraftStep[]) => void;
    /** Unique per card on the page: prefixes the input ids. */
    idBase: string;
    /** The tools a step may name (`lib/plan-tool-options.ts`); "No tool" clears the hint. */
    toolChoices?: readonly SelectOption[];
  }
  const { steps, editable = false, onchange, idBase, toolChoices }: Props = $props();

  const ICON = { pending: "circle", "in-progress": "retry", done: "check-circle", skipped: "skip-forward" } as const;
  let newTitle = $state("");

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
    <li class="step" data-status={step.status} data-testid="plan-step">
      <span class="ico" role="img" aria-label={stepStatusLabel(step.status)}><Icon name={ICON[step.status]} size="sm" /></span>
      {#if editable}
        <Input id="{idBase}-t-{step.id}" class="title-in" value={step.title} aria-label="Step {i + 1} title" onchange={(e) => rename(step.id, e)} />
        <Select id="{idBase}-h-{step.id}" class="tool-in" value={step.tool ?? ""} options={toolOptions} placeholder="No tool" aria-label="Step {i + 1} tool" onchange={(v) => onchange?.(setStepTool(steps, step.id, v))} />
        <span class="ctl">
          <IconButton icon="down" size="sm" class="up" label="Move step {i + 1} up" disabled={i === 0} onclick={() => onchange?.(moveStep(steps, step.id, -1))} />
          <IconButton icon="down" size="sm" label="Move step {i + 1} down" disabled={i === steps.length - 1} onclick={() => onchange?.(moveStep(steps, step.id, 1))} />
          <IconButton icon="trash" size="sm" label="Remove step {i + 1}" onclick={() => onchange?.(removeStep(steps, step.id))} />
        </span>
      {:else}
        <span class="title">{step.title}</span>
        {#if step.tool}<span class="tool">{step.tool}</span>{/if}
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
  .steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .step { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); }
  .ico { display: inline-flex; flex: none; color: var(--cortex-text-3); }
  .step[data-status="done"] .ico { color: var(--cortex-ok); }
  .step[data-status="in-progress"] .ico { color: var(--cortex-accent); }
  .step[data-status="done"] .title, .step[data-status="skipped"] .title { color: var(--cortex-text-2); }
  .title { min-width: 0; overflow-wrap: anywhere; }
  .tool { flex: none; padding: 0 6px; border-radius: var(--cortex-r-chip); background: var(--cortex-surface-2); color: var(--cortex-text-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .step :global(.title-in) { flex: 1 1 auto; min-width: 0; }
  .step :global(.tool-in) { flex: 0 0 150px; min-width: 0; }
  .ctl { display: inline-flex; flex: none; }
  .ctl :global(.up) { transform: rotate(180deg); }
  .add { display: flex; gap: 6px; margin-top: 8px; }
  .add :global(input) { flex: 1 1 auto; min-width: 0; }
</style>

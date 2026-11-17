<script lang="ts">
  /**
   * One plan step's `dependsOn` and `args`, folded away until asked for. "Waits for" lists the other
   * steps to tick (so only real step ids can be named); "Args" is a JSON object the step passes its
   * tool. A broken JSON text is flagged here and is not applied. Whether the whole graph can run
   * (unknown id, self reference, cycle) is the framework's check, shown by the card. Rules in
   * `lib/plan-extras.ts`.
   */
  import Textarea from "$lib/components/kit/Textarea.svelte";
  import { argsText, dependsLabel, parseArgsText, type StepExtras } from "$lib/plan-extras.js";

  interface Props {
    /** This step's id and its 1-based position (for labels). */
    stepId: string;
    position: number;
    /** Every step of the plan, in order. */
    steps: readonly { readonly id: string; readonly title: string }[];
    extras: StepExtras;
    /** Unique per card on the page: prefixes the input ids. */
    idBase: string;
    /** Tick or untick a prerequisite. */
    ontoggle: (dep: string) => void;
    /** A valid args object, or `undefined` when the field was cleared. */
    onargs: (args: Readonly<Record<string, unknown>> | undefined) => void;
  }
  const { stepId, position, steps, extras, idBase, ontoggle, onargs }: Props = $props();

  // What the person typed; `null` = show the saved args. A text that stops matching the saved args
  // (an import, a removed step) is dropped so the field never shows stale JSON.
  let typed = $state<string | null>(null);
  const shown = $derived(typed ?? argsText(extras.args));
  const parsed = $derived(typed === null ? undefined : parseArgsText(typed));
  const error = $derived(parsed !== undefined && !parsed.ok ? parsed.error : undefined);
  $effect(() => {
    if (typed === null) return;
    const p = parseArgsText(typed);
    if (p.ok && JSON.stringify(p.args ?? null) !== JSON.stringify(extras.args ?? null)) typed = null;
  });

  function input(e: Event) {
    typed = (e.currentTarget as HTMLTextAreaElement).value;
    const p = parseArgsText(typed);
    if (p.ok) onargs(p.args);
  }

  const others = $derived(steps.flatMap((s, i) => (s.id === stepId ? [] : [{ id: s.id, title: s.title, n: i + 1 }])));
  const summary = $derived([dependsLabel(steps, extras.dependsOn), extras.args !== undefined ? "args" : ""].filter((x) => x !== "").join(" · "));
</script>

<details class="extras" data-testid="plan-step-extras">
  <summary>Dependencies and args{#if summary}<span class="sum">{summary}</span>{/if}</summary>
  <div class="body">
    <fieldset class="deps">
      <legend>Step {position} waits for</legend>
      {#if others.length === 0}
        <span class="none">No other steps yet.</span>
      {:else}
        {#each others as o (o.id)}
          <label class="dep">
            <input type="checkbox" checked={extras.dependsOn?.includes(o.id) ?? false} onchange={() => ontoggle(o.id)} />
            <span>{o.n}. {o.title}</span>
          </label>
        {/each}
      {/if}
    </fieldset>
    <div class="args">
      <label for="{idBase}-a-{stepId}">Args (JSON object)</label>
      <Textarea id="{idBase}-a-{stepId}" value={shown} rows={3} mono invalid={error !== undefined} describedBy={error !== undefined ? `${idBase}-a-${stepId}-err` : undefined} placeholder={'{"query": "…"}'} oninput={input} />
      {#if error}<p class="err" id="{idBase}-a-{stepId}-err" role="alert" data-testid="plan-args-error">{error}</p>{/if}
    </div>
  </div>
</details>

<style>
  .extras { flex: 1 1 100%; min-width: 0; margin: 2px 0 4px 24px; font-size: var(--cortex-t-xs); }
  summary { cursor: pointer; color: var(--cortex-text-2); }
  .sum { margin-left: 8px; font-family: var(--cortex-font-data); color: var(--cortex-text-3); }
  .body { display: grid; gap: 8px; margin-top: 6px; }
  .deps { margin: 0; padding: 0; border: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .deps legend { float: left; padding: 0 8px 0 0; color: var(--cortex-text-2); }
  .dep { display: inline-flex; align-items: center; gap: 4px; color: var(--cortex-text); }
  .none { color: var(--cortex-text-3); }
  .args { display: grid; gap: 4px; }
  .args label { color: var(--cortex-text-2); }
  .err { margin: 0; color: var(--cortex-bad); }
</style>

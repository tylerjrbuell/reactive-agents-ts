<script lang="ts">
  // The typed result of an agent with an output schema: the object as a field table
  // (Raw JSON one click away), and a "How output was obtained" panel from the framework's
  // StructuredOutputReport (layer, repairs, field errors as JSON Pointers). Rules and wording
  // are ui-core `fieldRowsOf` / `obtainedOf`; this only lays them out. Used by the run view's
  // Answer and by a chat turn.
  import { fieldRowsOf, hasFieldRows, obtainedOf, type StructuredOutputReportWire } from "@reactive-agents/ui-core";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import BoundedText from "$lib/components/BoundedText.svelte";

  interface Props {
    /** The schema-valid value; absent when none was produced. */
    object?: unknown;
    /** Why no schema-valid value was produced. */
    error?: string | null;
    /** The extraction's provenance report. */
    report?: StructuredOutputReportWire | null;
    /** The output JSON Schema, for field descriptions and key order. */
    schema?: unknown;
  }
  const { object, error = null, report = null, schema }: Props = $props();

  let raw = $state(false);
  const present = $derived(object !== undefined && object !== null && hasFieldRows(object));
  const rows = $derived(present ? fieldRowsOf(object, schema, report?.fieldErrors ?? []) : []);
  const obtained = $derived(obtainedOf(report ?? undefined, error ?? undefined));
  const json = $derived(present ? JSON.stringify(object, null, 2) : "");
  const badge = $derived(
    !present && (error || report?.outcome === "failure")
      ? ({ tone: "bad", text: "no valid value" } as const)
      : obtained.tone === "attention"
        ? ({ tone: "warn", text: "needed help" } as const)
        : null,
  );
</script>

{#if present || error || report}
  <div class="so" data-testid="structured-result">
    <div class="head">
      <span class="h">Structured output</span>
      {#if badge}<Badge tone={badge.tone}>{badge.text}</Badge>{/if}
      {#if present}
        <span class="views" role="group" aria-label="View">
          <Chip on={!raw} onclick={() => (raw = false)}>Fields</Chip>
          <Chip on={raw} onclick={() => (raw = true)}>Raw JSON</Chip>
        </span>
      {/if}
    </div>

    {#if present}
      {#if raw}
        <BoundedText text={json} preview={6000} maxHeight="20rem" />
      {:else}
        <table class="fields">
          <thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
          <tbody>
            {#each rows as row (row.pointer)}
              <tr class:bad={row.error !== undefined}>
                <th scope="row" style="padding-left: {row.depth * 14 + 8}px">
                  <span class="name">{row.label}</span>
                  {#if row.description}<span class="desc">{row.description}</span>{/if}
                </th>
                <td>
                  {#if row.kind === "object"}<span class="dim">object</span>{:else}<span class="val val-{row.kind}">{row.display}</span>{/if}
                  {#if row.error}<span class="rowerr">{row.error}</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if error}
      <p class="err">{error}</p>
    {/if}

    <details class="how" open={obtained.tone === "bad"}>
      <summary>How output was obtained</summary>
      <p class="line">{obtained.headline} {#if obtained.layer}{obtained.layer}{/if}</p>
      {#if obtained.failure}
        <p class="line bad-t">{obtained.failure.kind} {obtained.failure.message}</p>
      {/if}
      {#if obtained.facts.length > 0}
        <dl class="facts">
          {#each obtained.facts as f (f.label)}<dt>{f.label}</dt><dd>{f.value}</dd>{/each}
        </dl>
      {/if}
      {#if obtained.repairs.length > 0}
        <p class="sub">Repairs applied, in order</p>
        <ol class="repairs">{#each obtained.repairs as r, i (i)}<li>{r}</li>{/each}</ol>
      {/if}
      {#if obtained.fieldErrors.length > 0}
        <p class="sub">Fields that failed</p>
        <ul class="ferrs">
          {#each obtained.fieldErrors as e (e.pointer + e.message)}
            <li><code>{e.pointer === "" ? "(root)" : e.pointer}</code> <span>{e.message}</span></li>
          {/each}
        </ul>
      {/if}
    </details>
  </div>
{/if}

<style>
  .so { display: grid; gap: 8px; max-width: var(--cortex-measure); padding: 10px 12px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .h { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); font-weight: 600; }
  .views { display: inline-flex; gap: 4px; margin-left: auto; }
  .fields { width: 100%; border-collapse: collapse; font-size: var(--cortex-t-sm); }
  .fields thead th { text-align: left; padding: 4px 8px; font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-3); border-bottom: 1px solid var(--cortex-line); }
  .fields tbody th, .fields td { text-align: left; vertical-align: top; padding: 5px 8px; border-bottom: 1px solid var(--cortex-line); font-weight: 400; }
  .fields tbody tr:last-child th, .fields tbody tr:last-child td { border-bottom: 0; }
  .name { display: block; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .desc { display: block; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .val { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); overflow-wrap: anywhere; white-space: pre-wrap; }
  .val-number { color: var(--cortex-io); }
  .val-boolean, .val-null { color: var(--cortex-accent); }
  .dim { color: var(--cortex-text-3); font-size: var(--cortex-t-xs); }
  tr.bad td, tr.bad th { background: var(--cortex-bad-tint); }
  .rowerr { display: block; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
  .err { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-bad); overflow-wrap: anywhere; }
  .how { border-top: 1px solid var(--cortex-line); padding-top: 6px; }
  .how summary { cursor: pointer; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .how summary:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .line { margin: 6px 0 0; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .bad-t { color: var(--cortex-bad); }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 2px 14px; margin: 8px 0 0; font-size: var(--cortex-t-xs); }
  .facts dt { color: var(--cortex-text-3); }
  .facts dd { margin: 0; color: var(--cortex-text); }
  .sub { margin: 8px 0 2px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .repairs, .ferrs { margin: 0; padding-left: 18px; font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .ferrs { list-style: none; padding-left: 0; display: grid; gap: 2px; }
  .ferrs code { font-family: var(--cortex-font-data); color: var(--cortex-io); }
</style>

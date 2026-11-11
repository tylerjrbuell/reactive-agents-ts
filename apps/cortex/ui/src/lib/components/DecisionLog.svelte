<script lang="ts">
  /**
   * The inspector's Decisions tab: every adaptation the reactive controller
   * made (`ReactiveDecision`, wrapped `Custom` variants) and every kernel
   * strategy switch (`StrategySwitched`), with the loop and the entropy change.
   */
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { IconName } from "$lib/icons.js";

  interface Ev {
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly ts: number;
  }
  interface Props {
    events: Ev[];
  }
  let { events }: Props = $props();

  type DecisionRow = {
    iteration: number;
    decision: string;
    reason: string;
    entropyBefore: number | undefined;
    entropyAfter: number | undefined;
    triggered: boolean;
  };

  const decisions = $derived.by((): DecisionRow[] => {
    const out: DecisionRow[] = [];
    for (const e of events) {
      // A kernel strategy switch is an adaptation too; without this row the panel
      // claimed "no interventions" on runs that switched strategy mid-run.
      if (e.type === "StrategySwitched") {
        const sp = e.payload;
        const from = typeof sp.from === "string" ? sp.from : "?";
        const to = typeof sp.to === "string" ? sp.to : "?";
        out.push({
          iteration: typeof sp.iteration === "number" ? sp.iteration : 0,
          decision: "switch-strategy",
          reason: `${from} → ${to}${typeof sp.reason === "string" && sp.reason ? `: ${sp.reason}` : ""}`,
          entropyBefore: undefined,
          entropyAfter: undefined,
          triggered: true,
        });
        continue;
      }
      // Match top-level ReactiveDecision events AND wrapped variants where the
      // event type is "ReactiveDecision" but payload carries nested data.
      let p: Record<string, unknown> | null = null;
      if (e.type === "ReactiveDecision") {
        p = e.payload;
      } else if (
        e.type === "Custom" &&
        typeof e.payload.type === "string" &&
        e.payload.type === "ReactiveDecision" &&
        e.payload.payload &&
        typeof e.payload.payload === "object"
      ) {
        p = e.payload.payload as Record<string, unknown>;
      }
      if (!p) continue;
      // Skip if no decision field — might be an unrelated event that leaked through
      if (typeof p.decision !== "string" || !p.decision) continue;
      out.push({
        iteration: typeof p.iteration === "number" ? p.iteration : 0,
        decision: p.decision,
        reason: typeof p.reason === "string" ? p.reason : "",
        entropyBefore: typeof p.entropyBefore === "number" ? p.entropyBefore : 0,
        entropyAfter: typeof p.entropyAfter === "number" ? p.entropyAfter : undefined,
        triggered: p.triggered !== false,
      });
    }
    return out;
  });

  const ICON: Record<string, IconName> = {
    "early-stop": "stop",
    compress: "compress",
    "switch-strategy": "strategy",
    branch: "fork",
    attribute: "info",
  };

  const label = (d: string): string => {
    const s = d.replace(/[-_]/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
</script>

{#if decisions.length === 0}
  <div class="decision">
    <span class="t">No interventions</span>
    <span class="s">The controller did not need to adapt this run.</span>
  </div>
{:else}
  <ul class="list">
    {#each decisions as d, i (i)}
      <li class="decision">
        <span class="t"><Icon name={ICON[d.decision] ?? "bolt"} size="sm" />{label(d.decision)}<span class="loop">Loop {d.iteration}</span>{#if !d.triggered}<span class="loop">not triggered</span>{/if}</span>
        {#if d.reason}<span class="s" title={d.reason}>{d.reason}</span>{/if}
        {#if d.entropyBefore !== undefined}
          <span class="eta">η {d.entropyBefore.toFixed(3)}{#if d.entropyAfter !== undefined} → {d.entropyAfter.toFixed(3)}{/if}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
  .decision { display: grid; gap: 2px; padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .t { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cortex-t-sm); font-weight: 500; color: var(--cortex-text); }
  .t :global(svg) { color: var(--cortex-accent); }
  .loop { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); font-weight: 400; color: var(--cortex-text-3); }
  .s { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); line-height: var(--cortex-lh-ui); overflow-wrap: anywhere; }
  .eta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
</style>

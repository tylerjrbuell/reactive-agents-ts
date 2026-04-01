<script lang="ts">
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
    entropyBefore: number;
    entropyAfter: number | undefined;
    triggered: boolean;
  };

  const decisions = $derived.by((): DecisionRow[] => {
    const out: DecisionRow[] = [];
    for (const e of events) {
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
        decision: typeof p.decision === "string" ? p.decision : "?",
        reason: typeof p.reason === "string" ? p.reason : "",
        entropyBefore: typeof p.entropyBefore === "number" ? p.entropyBefore : 0,
        entropyAfter: typeof p.entropyAfter === "number" ? p.entropyAfter : undefined,
        triggered: p.triggered !== false,
      });
    }
    return out;
  });

  const decisionIcon: Record<string, string> = {
    "early-stop": "stop_circle",
    compress: "compress",
    "switch-strategy": "swap_horiz",
    branch: "call_split",
    attribute: "label",
  };
</script>

<div class="h-full overflow-y-auto px-4 py-3 space-y-2">
  {#if decisions.length === 0}
    <p class="font-mono text-[10px] text-outline text-center mt-4">
      No reactive interventions — agent ran without the controller needing to adapt.
    </p>
  {:else}
    {#each decisions as d}
      <div
        class="flex items-start gap-3 p-2 rounded bg-surface-container-low border border-outline-variant/10 hover:border-primary/20 transition-colors"
      >
        <span class="material-symbols-outlined text-sm text-primary flex-shrink-0 mt-0.5">
          {decisionIcon[d.decision] ?? "electric_bolt"}
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            <span class="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
              iter {String(d.iteration).padStart(2, "0")}
            </span>
            <span class="text-[10px] font-mono text-on-surface uppercase">{d.decision}</span>
            {#if !d.triggered}
              <span class="text-[9px] font-mono text-outline">(not triggered)</span>
            {/if}
          </div>
          <p class="text-[10px] font-mono text-on-surface/60 leading-relaxed truncate">{d.reason}</p>
          <div class="flex gap-2 mt-1">
            <span class="text-[9px] font-mono text-outline">
              η {d.entropyBefore.toFixed(3)}
              {#if d.entropyAfter !== undefined}→ {d.entropyAfter.toFixed(3)}{/if}
            </span>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>

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

  type WorkingRow = { key: string; preview: string };

  type Snap = {
    episodicCount?: number;
    semanticCount?: number;
    skillsActive?: string[];
    working?: WorkingRow[];
  };

  type MemorySummary = {
    bootstrappedTiers: string[];
    flushCount: number;
    snapshotCount: number;
    lastMemoryTs?: number;
  };

  const snapshot = $derived.by((): Snap | null => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === "MemorySnapshot") {
        return events[i]!.payload as Snap;
      }
    }
    return null;
  });

  const summary = $derived.by((): MemorySummary => {
    const tiers = new Set<string>();
    let flushCount = 0;
    let snapshotCount = 0;
    let lastMemoryTs: number | undefined;
    for (const e of events) {
      if (e.type === "MemoryBootstrapped") {
        if (typeof e.payload.tier === "string") tiers.add(e.payload.tier);
        lastMemoryTs = e.ts;
      } else if (e.type === "MemoryFlushed") {
        flushCount += 1;
        lastMemoryTs = e.ts;
      } else if (e.type === "MemorySnapshotSaved") {
        snapshotCount += 1;
        lastMemoryTs = e.ts;
      }
    }
    return { bootstrappedTiers: [...tiers], flushCount, snapshotCount, lastMemoryTs };
  });
</script>

<div class="h-full overflow-y-auto px-4 py-3">
  {#if !snapshot && summary.flushCount === 0 && summary.snapshotCount === 0 && summary.bootstrappedTiers.length === 0}
    <p class="font-mono text-[10px] text-outline text-center mt-4">No memory events yet.</p>
  {:else}
    <div class="space-y-3">
      <div class="flex gap-4 font-mono text-[10px] flex-wrap">
        <span class="text-primary">{snapshot?.episodicCount ?? 0}</span><span class="text-outline">EPISODIC</span>
        <span class="text-primary">{snapshot?.semanticCount ?? 0}</span><span class="text-outline">SEMANTIC</span>
        <span class="text-secondary">{(snapshot?.skillsActive ?? []).length}</span><span class="text-outline"
          >SKILLS</span
        >
      </div>
      {#if (snapshot?.skillsActive?.length ?? 0) > 0}
        <div class="flex flex-wrap gap-1">
          {#each snapshot?.skillsActive ?? [] as skill}
            <span
              class="px-2 py-0.5 bg-secondary/10 border border-secondary/20 text-[9px] font-mono text-secondary rounded"
              >{skill}</span
            >
          {/each}
        </div>
      {/if}
      {#if (snapshot?.working?.length ?? 0) > 0}
        <div class="space-y-1">
          {#each snapshot?.working ?? [] as item}
            <div class="flex gap-2 text-[10px] font-mono">
              <span class="text-primary/60 flex-shrink-0">{item.key}</span>
              <span class="text-on-surface/40 truncate">{item.preview}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if !snapshot}
        <div class="space-y-1 pt-1 border-t border-white/5">
          <div class="flex gap-4 font-mono text-[10px] flex-wrap text-outline">
            <span>{summary.bootstrappedTiers.length} tiers bootstrapped</span>
            <span>{summary.flushCount} flushes</span>
            <span>{summary.snapshotCount} snapshots</span>
          </div>
          {#if summary.bootstrappedTiers.length > 0}
            <div class="flex flex-wrap gap-1">
              {#each summary.bootstrappedTiers as tier}
                <span class="px-2 py-0.5 bg-primary/10 border border-primary/20 text-[9px] font-mono text-primary rounded">{tier}</span>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

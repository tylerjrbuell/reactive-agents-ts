<script lang="ts">
  /**
   * The strategy / approval-gate note for a config the panel or chat bar holds: asks the server whether
   * the framework would refuse the run (`fetchStrategyConflict`) and shows the answer. Re-asks, debounced,
   * whenever the config changes; a stale answer never replaces a newer one. Draws nothing until there is a conflict.
   */
  import type { ConflictResolution, StrategyApprovalConflict } from "@reactive-agents/ui-core";
  import { fetchStrategyConflict } from "$lib/strategy-visuals/conflict.js";
  import StrategyConflictNote from "./StrategyConflictNote.svelte";

  interface Props {
    cfg: Readonly<Record<string, unknown>>;
    /** False for a chat with tools off (no tool layer, so no conflict); leave unset for a desk or Lab run. */
    toolsEnabled?: boolean;
    onResolve: (resolution: ConflictResolution) => void;
  }
  const { cfg, toolsEnabled, onResolve }: Props = $props();

  let conflict = $state<StrategyApprovalConflict | undefined>(undefined);

  $effect(() => {
    const snapshot = $state.snapshot(cfg);
    const opts = toolsEnabled === undefined ? {} : { toolsEnabled };
    let current = true;
    const timer = setTimeout(() => {
      void fetchStrategyConflict(snapshot, opts).then((c) => {
        if (current) conflict = c;
      });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  });
</script>

{#if conflict}
  <div class="live"><StrategyConflictNote {conflict} {onResolve} /></div>
{/if}

<style>
  .live { flex: 1 0 100%; }
</style>

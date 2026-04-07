<script lang="ts">
  import { page } from "$app/stores";
  import RunDetail from "$lib/components/RunDetail.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
</script>

<CortexDeskShell>
  {#key $page.params.runId}
    <div class="relative z-10 h-full min-h-0">
      <RunDetail runId={$page.params.runId ?? ""} />
    </div>
  {/key}
</CortexDeskShell>

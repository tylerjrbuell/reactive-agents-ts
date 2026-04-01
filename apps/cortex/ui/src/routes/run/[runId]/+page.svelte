<script lang="ts">
  import { page } from "$app/stores";
  import RunDetail from "$lib/components/RunDetail.svelte";
</script>

{#key $page.params.runId}
  <RunDetail runId={$page.params.runId ?? ""} />
{/key}

<script lang="ts">
  /**
   * A quiet note for a config that still lists a switched-off MCP server: the framework build skips
   * it, so the agent gets none of its tools. Each server has an Enable action (the same call as the
   * Lab > Tools switch); the page reloads its server list afterwards. Words: `lib/mcp-servers-view.ts`.
   */
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { disabledInUseText } from "$lib/mcp-servers-view.js";
  import { setServerEnabled } from "$lib/tools-page-data.js";

  interface Props {
    /** The switched-off servers the config lists. */
    servers: readonly { readonly serverId: string; readonly name: string }[];
    /** Reload the server list after one was enabled. */
    onChanged: () => void | Promise<void>;
  }
  const { servers, onChanged }: Props = $props();

  async function enable(serverId: string, name: string) {
    const r = await setServerEnabled({ base: CORTEX_SERVER_URL }, serverId, true);
    if (!r.ok) toast.error("Could not enable the server", r.error);
    else toast.success(`${name} enabled`);
    await onChanged();
  }
</script>

{#if servers.length > 0}
  <div class="dn" data-testid="mcp-disabled-note">
    <p class="dn-text">{disabledInUseText(servers.map((s) => s.name))}</p>
    <div class="dn-acts">
      {#each servers as s (s.serverId)}
        <Button size="sm" onclick={() => enable(s.serverId, s.name)}>Enable {s.name}</Button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .dn { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px dashed var(--cortex-line-strong); border-radius: var(--cortex-r-ctl); }
  .dn-text { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .dn-acts { display: flex; flex-wrap: wrap; gap: 6px; }
</style>

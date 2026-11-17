<script lang="ts">
  /**
   * Lab > Tools: three sub-tabs. Servers (MCP servers: status, tools, options, credentials),
   * Custom tools (the Lab's own) and Catalog and test (every tool an agent can get, with a panel
   * to call it). This shell only loads the two shared lists and switches tabs; each tab owns its
   * state (`components/tools/`), every call is in `lib/tools-page-data.ts`.
   */
  import { onMount } from "svelte";
  import Tabs from "$lib/components/kit/Tabs.svelte";
  import CatalogTab from "$lib/components/tools/CatalogTab.svelte";
  import CustomToolsTab from "$lib/components/tools/CustomToolsTab.svelte";
  import ServersTab from "$lib/components/tools/ServersTab.svelte";
  import { fetchCatalog, fetchServers, type ApiCtx } from "$lib/tools-page-data.js";
  import { tabId, tabPanelId } from "$lib/tablist.js";
  import { customToolsOf, TOOLS_TABS, toolsTabCounts, type ToolsTab } from "$lib/tools-tabs.js";
  import type { CatalogEntry, McpListRow } from "$lib/tool-workshop.js";

  interface Props {
    serverUrl: string;
  }
  const { serverUrl }: Props = $props();

  const ctx: ApiCtx = $derived({ base: serverUrl });
  let tab = $state<ToolsTab>("servers");
  let servers = $state<McpListRow[]>([]);
  let catalog = $state<CatalogEntry[]>([]);
  let loading = $state(true);

  async function reload() {
    const [s, c] = await Promise.all([fetchServers(ctx), fetchCatalog(ctx)]);
    servers = s.ok ? s.value : [];
    catalog = c.ok ? c.value : [];
    loading = false;
  }

  const items = $derived(toolsTabCounts(TOOLS_TABS, { servers: servers.length, custom: customToolsOf(catalog).length, catalog: catalog.length }, loading));

  onMount(() => void reload());
</script>

<div class="tw">
  <Tabs {items} bind:value={tab} label="Tools sections" idBase="tw" />
  <div class="tw-panel" role="tabpanel" id={tabPanelId("tw", tab)} aria-labelledby={tabId("tw", tab)}>
    {#if tab === "servers"}
      <ServersTab {ctx} {servers} {loading} onChanged={reload} />
    {:else if tab === "custom"}
      <CustomToolsTab {ctx} {catalog} {loading} onChanged={reload} />
    {:else}
      <CatalogTab {ctx} {catalog} {loading} onChanged={reload} />
    {/if}
  </div>
</div>

<style>
  .tw { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 8px 32px 24px; overflow-y: auto; }
  .tw-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>

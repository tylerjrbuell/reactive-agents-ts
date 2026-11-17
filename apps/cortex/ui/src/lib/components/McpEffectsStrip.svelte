<script lang="ts">
  /**
   * What the current tool selection lets an agent do: read-only MCP tools, tools that ask first,
   * and the shell. Words and rules: `lib/mcp-attach.ts` (`effectsOf`, `effectsLines`). Links to
   * Lab > Tools > Servers, where those options are set.
   */
  import { onMount } from "svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { effectsLines, effectsOf, type AttachServer, type EffectsCfg } from "$lib/mcp-attach.js";

  interface Props {
    config: EffectsCfg;
    servers: readonly AttachServer[];
  }
  const { config, servers }: Props = $props();

  let required = $state<string[]>([]);
  onMount(() => {
    fetch(`${CORTEX_SERVER_URL}/api/tools/approval-required`)
      .then((r) => (r.ok ? (r.json() as Promise<{ tools: string[] }>) : { tools: [] }))
      .then((r) => (required = r.tools))
      .catch(() => (required = []));
  });

  const lines = $derived(effectsLines(effectsOf(config, servers, required)));

  /** Open Lab > Tools (Servers is its first tab); the Lab page switches on the same event the palette uses. */
  async function openServers() {
    const { goto } = await import("$app/navigation");
    await goto("/lab#tools");
    window.dispatchEvent(new CustomEvent("cortex:lab-tab", { detail: "tools" }));
  }
</script>

<div class="fx" data-testid="mcp-effects" role="group" aria-label="What this selection allows">
  {#each lines as line (line.id)}
    <Chip data={line.id === "shell"} title={line.names.length > 0 ? `${line.detail} ${line.names.join(", ")}` : line.detail}>{line.label}</Chip>
  {/each}
  <a class="fx-link" href="/lab#tools" onclick={(e) => { e.preventDefault(); void openServers(); }}>Manage servers in Lab</a>
</div>

<style>
  .fx { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .fx-link { margin-left: auto; font-size: var(--cortex-t-xs); color: var(--cortex-accent); }
  .fx-link:hover { text-decoration: underline; }
  .fx-link:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
</style>

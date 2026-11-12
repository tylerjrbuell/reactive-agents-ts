<script lang="ts">
  /**
   * One-line MCP server add for Lab Tools: paste a command (`npx -y @scope/server`) or a
   * URL (`https://host/mcp`); the server is saved and its tools listed. The same parser
   * and calls as the chat's `/mcp add` (`lib/mcp-quick-add.ts`). The manual form below
   * stays for headers, env and the rest.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { addMcpServer, parseMcpQuickAdd } from "$lib/mcp-quick-add.js";

  interface Props {
    /** Called after a server is saved (reload the lists). */
    onAdded: () => void | Promise<void>;
  }
  const { onAdded }: Props = $props();

  let line = $state("");
  let busy = $state(false);

  async function add() {
    const parsed = parseMcpQuickAdd(line);
    if (!parsed.ok) return void toast.error("Cannot add this server", parsed.error);
    busy = true;
    try {
      const s = await addMcpServer(parsed.body);
      line = "";
      await onAdded();
      if (s.discoveryError) toast.warning(`${s.name} saved, tools not listed`, `${s.discoveryError}. Use Refresh tools on it below.`);
      else toast.success(`${s.name} added`, `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}. Turn it on in a chat with /mcp.`);
    } catch (e) {
      toast.error("Could not add the server", e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
</script>

<form class="qa" onsubmit={(e) => { e.preventDefault(); void add(); }} aria-label="Add an MCP server">
  <label class="sr" for="mcp-quick-add">Add an MCP server from a command or URL</label>
  <Input id="mcp-quick-add" bind:value={line} placeholder="Add MCP server: npx -y @scope/server or https://host/mcp" mono disabled={busy} />
  <Button type="submit" size="sm" icon="plus" disabled={busy || line.trim() === ""}>{busy ? "Adding…" : "Add"}</Button>
</form>

<style>
  .qa { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 320px; }
  .qa :global(input) { min-width: 0; flex: 1; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

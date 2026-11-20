<script lang="ts">
  /**
   * "Signed in with rax": stored MCP logins no saved server uses (made with `rax mcp login`), each
   * with Add, which opens the server form prefilled with the name, URL and transport. A saved server
   * at that URL uses the login automatically (framework stored-login rule). Rules in
   * `lib/mcp-oauth-view.ts`; renders nothing when there are none.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { loginLabel, visibleLogins, type McpUnusedLogin } from "$lib/mcp-oauth-view.js";

  interface Props {
    logins: readonly McpUnusedLogin[];
    onAdd: (login: McpUnusedLogin) => void;
  }
  const { logins, onAdd }: Props = $props();
  let expanded = $state(false);
  const shown = $derived(visibleLogins(logins, expanded));
</script>

{#if logins.length > 0}
  <section class="rl" aria-label="Signed in with rax" data-testid="rax-logins">
    <h4>Signed in with rax</h4>
    <p class="rl-note">Logins on this computer that no server here uses yet.</p>
    <ul>
      {#each shown.rows as l (l.resourceKey)}
        <li class="rl-row">
          <span class="rl-text">
            <span class="rl-name">{loginLabel(l)}</span>
            <span class="rl-url">{l.url}</span>
          </span>
          <Status tone={l.status === "expired" ? "attention" : "done"} label={l.status === "expired" ? "Expired" : "Signed in"} />
          <Button size="sm" icon="plus" onclick={() => onAdd(l)}>Add</Button>
        </li>
      {/each}
    </ul>
    {#if shown.hidden > 0}
      <Button size="sm" variant="ghost" onclick={() => (expanded = true)}>Show all {logins.length}</Button>
    {/if}
  </section>
{/if}

<style>
  .rl { margin-top: 14px; display: grid; gap: 6px; }
  h4 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .rl-note { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .rl-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px dashed var(--cortex-line); border-radius: var(--cortex-r-ctl); }
  .rl-text { display: grid; min-width: 0; flex: 1; }
  .rl-name { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); color: var(--cortex-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rl-url { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

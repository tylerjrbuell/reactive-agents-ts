<script lang="ts">
  /**
   * The one "Allowed commands" control for `shell-execute`: the exact list the agent gets,
   * as removable chips (framework defaults pre-filled), an input to add commands, and
   * quick-add buttons for the opt-in groups. Edits write `terminalShellAdditionalCommands`
   * or `terminalShellAllowedCommands` and clear legacy `commandAccess` (`shell-allowlist.ts`).
   */
  import { onMount } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { defaultShellOptions, type AgentConfig } from "$lib/types/agent-config.js";
  import {
    SHELL_QUICK_ADD,
    effectiveShellCommands,
    isOptInCommand,
    missingGroupCommands,
    parseCommandInput,
    shellCommandsPatch,
    withCommands,
    type ShellCommandCatalog,
  } from "$lib/shell-allowlist.js";

  let { config = $bindable() }: { config: AgentConfig } = $props();

  let catalog = $state<ShellCommandCatalog | null>(null);
  let loadFailed = $state(false);
  let draft = $state("");
  let inputError = $state("");

  onMount(async () => {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/tools/shell-commands`);
      if (res.ok) catalog = (await res.json()) as ShellCommandCatalog;
      else loadFailed = true;
    } catch {
      loadFailed = true;
    }
  });

  const shellOpts = $derived({ ...defaultShellOptions(), ...(config.terminalShellOptions ?? {}) });
  const fields = $derived({
    terminalShellAdditionalCommands: config.terminalShellAdditionalCommands ?? "",
    terminalShellAllowedCommands: config.terminalShellAllowedCommands ?? "",
    commandAccess: shellOpts.commandAccess ?? [],
  });
  const list = $derived(catalog ? effectiveShellCommands(fields, catalog) : []);
  const replacesDefaults = $derived(catalog !== null && catalog.defaults.some((d) => !list.includes(d)));
  const added = $derived(catalog ? list.filter((c) => !catalog!.defaults.includes(c)) : []);
  const quickAdds = $derived(
    catalog ? SHELL_QUICK_ADD.map((g) => ({ ...g, missing: missingGroupCommands(list, g.id, catalog!) })).filter((g) => g.missing.length > 0) : [],
  );

  function setList(next: readonly string[]) {
    if (!catalog || next.length === 0) return;
    const p = shellCommandsPatch(next, catalog);
    config = {
      ...config,
      terminalShellAdditionalCommands: p.terminalShellAdditionalCommands,
      terminalShellAllowedCommands: p.terminalShellAllowedCommands,
      terminalShellOptions: { ...shellOpts, commandAccess: p.commandAccess },
    };
  }

  function addDraft() {
    const { valid, invalid } = parseCommandInput(draft);
    inputError = invalid.length > 0 ? `Not a command name: ${invalid.join(", ")}` : "";
    if (valid.length > 0) setList(withCommands(list, valid));
    draft = invalid.join(" ");
  }
</script>

<div class="acp-field">
  <span id="acp-shell-commands-label" class="config-label">Allowed commands</span>
  {#if catalog}
    <p data-testid="shell-commands-summary" class="acp-hint">
      {list.length} commands ·
      {#if replacesDefaults}custom list (replaces the framework defaults){:else if added.length > 0}framework defaults + {added.length} added{:else}framework defaults{/if}
    </p>
    <ul class="acp-chips" aria-labelledby="acp-shell-commands-label" data-testid="shell-commands">
      {#each list as cmd (cmd)}
        {@const risky = isOptInCommand(cmd, catalog)}
        <li class="acp-cmd" class:risky title={risky ? `${cmd}: opt-in command, can run code or move data` : undefined}>
          {cmd}
          <button
            type="button"
            aria-label={`Remove ${cmd}`}
            disabled={list.length <= 1}
            onclick={() => setList(list.filter((c) => c !== cmd))}
          >
            <Icon name="x" size="sm" />
          </button>
        </li>
      {/each}
    </ul>
    <div class="flex items-center gap-1.5">
      <input
        id="acp-shell-command-add"
        type="text"
        class="config-input acp-mono min-w-0 flex-1"
        placeholder="Add a command, e.g. stripe (Enter)"
        aria-label="Add allowed command"
        bind:value={draft}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addDraft();
          }
        }}
      />
      <Button size="sm" onclick={addDraft}>Add</Button>
      {#if replacesDefaults || added.length > 0}
        <Button size="sm" variant="ghost" onclick={() => setList(catalog!.defaults)}>Reset</Button>
      {/if}
    </div>
    {#if inputError}
      <p class="acp-hint acp-bad" role="alert">{inputError}</p>
    {/if}
    {#if quickAdds.length > 0}
      <div class="flex flex-col gap-1" data-testid="shell-quick-add">
        <span class="acp-hint">Opt-in commands. Add them only if you accept the risk:</span>
        {#each quickAdds as g (g.id)}
          <button type="button" class="acp-quickadd" onclick={() => setList(withCommands(list, g.missing))}>
            <span class="acp-data">+ {g.label}: {g.missing.join(" ")}</span>
            <span class="acp-hint">{g.note}</span>
          </button>
        {/each}
      </div>
    {/if}
  {:else if loadFailed}
    <p class="acp-hint acp-bad">Could not load the framework allowlist from the server, so the command list cannot be edited right now.</p>
  {:else}
    <p class="acp-hint" role="status">Loading allowed commands…</p>
  {/if}
</div>

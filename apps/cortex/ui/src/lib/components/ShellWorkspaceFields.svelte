<script lang="ts">
  /**
   * Workspace directory + host shell (`shell-execute`) options for the Lab builder.
   * Maps to `.withTools({ workspace, terminal })`; rendered inside AgentConfigPanel's
   * Tools section, whose field styles cascade in via `.agent-config-panel`.
   */
  import WorkspaceField from "$lib/components/WorkspaceField.svelte";
  import {
    SHELL_COMMAND_GROUPS,
    defaultShellOptions,
    type AgentConfig,
    type ShellOptions,
  } from "$lib/types/agent-config.js";

  let { config = $bindable() }: { config: AgentConfig } = $props();

  // Host-shell options, read over their defaults (older saves predate the field).
  const shellOpts = $derived<ShellOptions>({ ...defaultShellOptions(), ...(config.terminalShellOptions ?? {}) });
  const setShell = (patch: Partial<ShellOptions>) => (config = { ...config, terminalShellOptions: { ...shellOpts, ...patch } });
</script>

<div class="acp-field">
  <label for="acp-workspace" class="config-label mb-0 text-[11px]">Workspace</label>
  <WorkspaceField id="acp-workspace" value={config.workspace ?? ""} onChange={(p) => (config = { ...config, workspace: p })} />
  <p class="font-mono text-[10px] text-outline/70 leading-relaxed">
    File tools read and write inside this directory, and the shell runs in it. Empty: file tools use the server's directory and the shell gets a fresh /tmp sandbox.
  </p>
</div>
<div
  class="acp-callout"
>
  <p class="font-mono text-[10px] font-semibold uppercase tracking-wide text-tertiary">Host shell — use at your own risk</p>
  <p class="font-mono text-[10px] text-[var(--cortex-text-muted)] leading-relaxed">
    The <code class="text-[10px]">shell-execute</code> tool runs allowlisted commands on <strong>this machine</strong> (not an isolated container). Allowed commands are defined by the framework defaults; risky patterns are blocklisted, but no sandbox is perfect.
    Only enable for trusted projects and accounts. For stronger isolation, use code from your app with Docker sandboxing — see
    <a class="text-primary underline decoration-primary/40" href="https://docs.reactiveagents.dev/" target="_blank" rel="noreferrer">docs</a>
    (shell execution / sandbox).
  </p>
  <label class="flex cursor-pointer items-center gap-2">
    <input type="checkbox" bind:checked={config.terminalTools} class="accent-primary shrink-0" />
    <span class="font-mono text-[11px] text-[var(--cortex-text)]">Enable host shell (<code class="text-[10px]">shell-execute</code>)</span>
  </label>
  {#if config.terminalTools || config.tools.includes("shell-execute")}
    <div class="acp-stack border-t border-[color-mix(in_srgb,var(--ra-amber)_25%,transparent)] pt-3">
      <div class="acp-field">
        <label for="acp-shell-additional-commands" class="config-label mb-0 text-[11px]">Extra allowed commands</label>
        <textarea
          id="acp-shell-additional-commands"
          rows={2}
          bind:value={config.terminalShellAdditionalCommands}
          placeholder="e.g. node, bun, gh, stripe (comma or newline — merged onto framework defaults)"
          class="config-input font-mono text-[11px] min-h-[2.25rem] resize-y"
        ></textarea>
        <p class="font-mono text-[10px] text-outline/70 leading-relaxed">
          Opt-in CLIs like <code class="text-[10px]">node</code>/<code class="text-[10px]">curl</code> are not in the base list; add them here only if you accept the risk.
        </p>
      </div>
      <div class="acp-field">
        <label for="acp-shell-allowed-commands" class="config-label mb-0 text-[11px]">Replace default allowlist <span class="text-outline/70 font-normal">(advanced)</span></label>
        <textarea
          id="acp-shell-allowed-commands"
          rows={2}
          bind:value={config.terminalShellAllowedCommands}
          placeholder="Leave empty. If set, this list becomes the only allowed executables (plus “Extra” above)."
          class="config-input font-mono text-[11px] min-h-[2.25rem] resize-y border-[color-mix(in_srgb,var(--ra-amber)_30%,var(--cortex-border))]"
        ></textarea>
      </div>
      <div class="acp-field">
        <span class="config-label mb-0 text-[11px]">Command groups</span>
        <div class="flex flex-wrap gap-x-3 gap-y-1">
          {#each SHELL_COMMAND_GROUPS as grp (grp.id)}
            {@const on = shellOpts.commandAccess.includes(grp.id)}
            <label class="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-[var(--cortex-text)]" title={grp.commands}>
              <input type="checkbox" class="accent-primary" checked={on}
                onchange={() => setShell({ commandAccess: on ? shellOpts.commandAccess.filter((c) => c !== grp.id) : [...shellOpts.commandAccess, grp.id] })} />
              {grp.label}
            </label>
          {/each}
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="acp-field">
          <label for="acp-shell-sandbox" class="config-label mb-0 text-[11px]">Runs on</label>
          <select id="acp-shell-sandbox" class="config-input text-[11px]" value={shellOpts.sandbox}
            onchange={(e) => setShell({ sandbox: (e.currentTarget as HTMLSelectElement).value === "docker" ? "docker" : "host" })}>
            <option value="host">This machine</option>
            <option value="docker">Docker sandbox (no host files)</option>
          </select>
        </div>
        <div class="acp-field">
          <label for="acp-shell-cwd" class="config-label mb-0 text-[11px]">Shell directory</label>
          <input id="acp-shell-cwd" type="text" class="config-input text-[11px]" placeholder="workspace root" value={shellOpts.cwd}
            onchange={(e) => setShell({ cwd: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        <div class="acp-field">
          <label for="acp-shell-timeout" class="config-label mb-0 text-[11px]">Timeout (s, 0 = 30)</label>
          <input id="acp-shell-timeout" type="number" min="0" max="3600" class="config-input text-[11px]" value={Math.round(shellOpts.timeoutMs / 1000)}
            onchange={(e) => setShell({ timeoutMs: Math.max(0, parseInt((e.currentTarget as HTMLInputElement).value || "0", 10)) * 1000 })} />
        </div>
        <div class="acp-field">
          <label for="acp-shell-maxout" class="config-label mb-0 text-[11px]">Output cap (chars, 0 = 4000)</label>
          <input id="acp-shell-maxout" type="number" min="0" class="config-input text-[11px]" value={shellOpts.maxOutputChars}
            onchange={(e) => setShell({ maxOutputChars: Math.max(0, parseInt((e.currentTarget as HTMLInputElement).value || "0", 10)) })} />
        </div>
      </div>
      <label class="flex cursor-pointer items-center gap-2">
        <input type="checkbox" class="accent-primary shrink-0" checked={shellOpts.allowUnsafeCwd} onchange={(e) => setShell({ allowUnsafeCwd: (e.currentTarget as HTMLInputElement).checked })} />
        <span class="font-mono text-[10px] text-[var(--cortex-text)]">Allow a shell directory outside the workspace</span>
      </label>
    </div>
  {/if}
</div>

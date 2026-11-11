<script lang="ts">
  /**
   * Workspace directory + host shell (`shell-execute`) options for the Lab builder.
   * Maps to `.withTools({ workspace, terminal })`; rendered inside AgentConfigPanel's
   * Tools section, whose field styles cascade in via `.agent-config-panel`.
   */
  import WorkspaceField from "$lib/components/WorkspaceField.svelte";
  import ShellCommandsField from "$lib/components/ShellCommandsField.svelte";
  import {
    defaultShellOptions,
    type AgentConfig,
    type ShellOptions,
  } from "$lib/types/agent-config.js";

  import { shellCheckboxClick, shellCheckboxView, type ShellPresets } from "$lib/shell-from-picks.js";

  let { config = $bindable(), shellPresets = {} }: { config: AgentConfig; shellPresets?: ShellPresets } = $props();

  // A shell toolset pick (git) brings shell-execute by itself, so the box never shows
  // unchecked while one is picked; a click still flips the user's own `terminalTools`
  // (git · gh only <-> full shell).
  const shellBox = $derived(shellCheckboxView(config.terminalTools, config.tools, shellPresets));
  function onShellClick(e: Event) {
    const terminalTools = shellCheckboxClick(config.terminalTools);
    config = { ...config, terminalTools };
    // The browser already flipped the box; set it to the new view (stays checked while a toolset is picked).
    (e.currentTarget as HTMLInputElement).checked = shellCheckboxView(terminalTools, config.tools, shellPresets).checked;
  }

  // Host-shell options, read over their defaults (older saves predate the field).
  const shellOpts = $derived<ShellOptions>({ ...defaultShellOptions(), ...(config.terminalShellOptions ?? {}) });
  const setShell = (patch: Partial<ShellOptions>) => (config = { ...config, terminalShellOptions: { ...shellOpts, ...patch } });
</script>

<div class="acp-field">
  <label for="acp-workspace" class="config-label mb-0 text-[11px]">Workspace</label>
  <WorkspaceField id="acp-workspace" value={config.workspace ?? ""} onChange={(p) => (config = { ...config, workspace: p })} />
  <p class="acp-hint leading-relaxed">
    File tools read and write inside this directory, and the shell runs in it. Empty: file tools use the server's directory and the shell gets a fresh /tmp sandbox.
  </p>
</div>
<div
  class="acp-callout"
>
  <p class="acp-check-t" style="font-weight: 600">Full host shell: use at your own risk</p>
  <p class="acp-hint">
    <code>shell-execute</code> runs the allowed commands below on <strong>this machine</strong>, not in an isolated container. Risky patterns are blocked, but no sandbox is perfect.
    Turn it on only for trusted projects. For stronger isolation, run the Docker sandbox from your app (see the
    <a class="acp-link" href="https://docs.reactiveagents.dev/" target="_blank" rel="noreferrer">shell execution docs</a>).
  </p>
  <label class="acp-check">
    <input
      type="checkbox"
      checked={shellBox.checked}
      aria-describedby={shellBox.hint ? "acp-shell-hint" : undefined}
      onchange={onShellClick}
    />
    <span><span class="acp-check-t">Full host shell (<code>shell-execute</code>)</span></span>
  </label>
  {#if shellBox.hint}
    <p id="acp-shell-hint" data-testid="shell-hint" class="acp-hint">{shellBox.hint}</p>
  {/if}
  {#if config.terminalTools || config.tools.includes("shell-execute")}
    <div class="acp-stack acp-group">
      <ShellCommandsField bind:config />
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
      <label class="acp-check">
        <input type="checkbox" checked={shellOpts.allowUnsafeCwd} onchange={(e) => setShell({ allowUnsafeCwd: (e.currentTarget as HTMLInputElement).checked })} />
        <span><span class="acp-check-t">Allow a shell directory outside the workspace</span></span>
      </label>
    </div>
  {/if}
</div>

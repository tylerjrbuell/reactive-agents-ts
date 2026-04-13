<script lang="ts">
  /**
   * Host shell warning + optional `ShellExecuteConfig` fields for desk chat
   * (mirrors AgentConfigPanel host shell section — keep wording aligned).
   * Parent renders this only when host shell (`shell-execute`) is selected.
   */
  interface Props {
    /** Comma/newline list merged onto framework default allowlist (first tokens). */
    additionalCommands?: string;
    /** When non-empty, replaces the default allowlist (advanced). */
    allowedCommands?: string;
    /** Smaller typography for run tab strip vs main chat sidebar. */
    readonly compact?: boolean;
    /** Suffix for textarea `id` / `for` (avoids duplicate ids if both panels exist). */
    readonly idSuffix?: string;
  }

  let {
    additionalCommands = $bindable(""),
    allowedCommands = $bindable(""),
    compact = false,
    idSuffix = "",
  }: Props = $props();

  const sid = $derived(idSuffix ? `-${idSuffix}` : "");

  const p = $derived(compact ? "text-[7px]" : "text-[8px]");
  const label = $derived(compact ? "text-[7px]" : "text-[9px]");
  const input = $derived(compact ? "text-[8px] min-h-[2rem]" : "text-[9px] min-h-[2.25rem]");
</script>

<div
    class="rounded-lg border border-[color-mix(in_srgb,var(--ra-amber)_40%,var(--cortex-border))] bg-[color-mix(in_srgb,var(--ra-amber)_10%,transparent)] px-2 py-2 space-y-2"
  >
    <p class="font-mono {compact ? 'text-[7px]' : 'text-[8px]'} font-semibold uppercase tracking-wide text-tertiary">
      Host shell — use at your own risk
    </p>
    <p class="font-mono {p} text-[var(--cortex-text-muted)] leading-relaxed">
      The <code class="{compact ? 'text-[6px]' : 'text-[7px]'}">shell-execute</code> tool runs allowlisted commands on
      <strong>this machine</strong> (not an isolated container). Allowed commands are defined by the framework defaults; risky
      patterns are blocklisted, but no sandbox is perfect. Only enable for trusted projects and accounts. For stronger isolation,
      use Docker sandboxing — see
      <a class="text-primary underline decoration-primary/40" href="https://docs.reactiveagents.dev/" target="_blank" rel="noreferrer"
        >docs</a
      >
      (shell execution / sandbox).
    </p>
    <div class="space-y-2 border-t border-[color-mix(in_srgb,var(--ra-amber)_25%,transparent)] pt-2">
      <div class="space-y-1">
        <label for={`chat-shell-addl${sid}`} class="font-mono {label} uppercase tracking-widest text-[var(--cortex-text-muted)] mb-0"
          >Extra allowed commands</label
        >
        <textarea
          id={`chat-shell-addl${sid}`}
          rows={compact ? 2 : 2}
          bind:value={additionalCommands}
          placeholder="e.g. node, bun, gh (comma or newline — merged onto defaults)"
          class="w-full rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface)] px-2 py-1 font-mono {input} resize-y"
        ></textarea>
        <p class="font-mono {compact ? 'text-[6px]' : 'text-[7px]'} text-outline/50 leading-relaxed">
          Opt-in CLIs like <code class="text-[6px]">node</code>/<code class="text-[6px]">curl</code> are not in the base list; add them
          here only if you accept the risk.
        </p>
      </div>
      <div class="space-y-1">
        <label for={`chat-shell-allow${sid}`} class="font-mono {label} uppercase tracking-widest text-[var(--cortex-text-muted)] mb-0"
          >Replace default allowlist <span class="text-outline/40 font-normal normal-case">(advanced)</span></label
        >
        <textarea
          id={`chat-shell-allow${sid}`}
          rows={2}
          bind:value={allowedCommands}
          placeholder="Leave empty. If set, this list is the only allowed executables (plus “Extra” above)."
          class="w-full rounded-md border border-[color-mix(in_srgb,var(--ra-amber)_30%,var(--cortex-border))] bg-[var(--cortex-surface)] px-2 py-1 font-mono {input} resize-y"
        ></textarea>
      </div>
    </div>
  </div>

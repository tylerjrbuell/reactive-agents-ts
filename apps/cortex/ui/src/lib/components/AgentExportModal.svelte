<script lang="ts">
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { generateAgentTs, generateAgentJson } from "$lib/agent-export.js";
  import { toast } from "$lib/stores/toast-store.js";

  interface Props {
    config: AgentConfig;
    name: string;
    onClose: () => void;
  }
  const { config, name, onClose }: Props = $props();

  let format = $state<"ts" | "json">("ts");
  const code = $derived(format === "ts" ? generateAgentTs(config, name) : generateAgentJson(config, name));
  const filename = $derived(
    `${(name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"}.${format === "ts" ? "ts" : "json"}`,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Copied", `${format.toUpperCase()} copied to clipboard`);
    } catch {
      toast.error("Copy failed");
    }
  }

  function download() {
    const blob = new Blob([code], {
      type: format === "ts" ? "text/typescript" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
  role="button"
  tabindex="-1"
  onclick={onClose}
  onkeydown={(e) => e.key === "Enter" && onClose()}
>
  <div
    class="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--cortex-border)] bg-surface-container-lowest shadow-2xl"
    role="dialog"
    aria-modal="true"
    aria-label="Export agent"
    tabindex="0"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[var(--cortex-border)] px-4 py-3">
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-symbols-outlined text-[18px] text-primary">ios_share</span>
        <h2 class="font-mono text-[12px] font-semibold uppercase tracking-wider text-on-surface truncate m-0">
          Export “{name || "agent"}”
        </h2>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="p-1 rounded text-outline hover:text-on-surface transition-colors"
        aria-label="Close"
      >
        <span class="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>

    <!-- Format toggle + actions -->
    <div class="flex flex-shrink-0 items-center gap-2 border-b border-[var(--cortex-border)] px-4 py-2">
      <div class="flex gap-1">
        <button
          type="button"
          class="rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider border transition-colors
                 {format === 'ts' ? 'border-primary/50 text-primary bg-primary/10' : 'border-[var(--cortex-border)] text-outline hover:border-primary/30'}"
          onclick={() => (format = "ts")}
        >
          TypeScript
        </button>
        <button
          type="button"
          class="rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider border transition-colors
                 {format === 'json' ? 'border-primary/50 text-primary bg-primary/10' : 'border-[var(--cortex-border)] text-outline hover:border-primary/30'}"
          onclick={() => (format = "json")}
        >
          JSON
        </button>
      </div>
      <div class="flex-1"></div>
      <button
        type="button"
        onclick={copy}
        class="flex items-center gap-1 rounded border border-[var(--cortex-border)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-outline hover:text-primary hover:border-primary/40 transition-colors"
      >
        <span class="material-symbols-outlined text-[14px] leading-none">content_copy</span> Copy
      </button>
      <button
        type="button"
        onclick={download}
        class="flex items-center gap-1 rounded bg-primary px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-on-primary hover:bg-primary/90 transition-colors"
      >
        <span class="material-symbols-outlined text-[14px] leading-none">download</span> {filename}
      </button>
    </div>

    <!-- Code -->
    <div class="min-h-0 flex-1 overflow-auto bg-surface-container-low/40 p-4">
      <pre class="m-0 font-mono text-[11px] leading-relaxed text-on-surface/85 whitespace-pre">{code}</pre>
    </div>

    <div class="flex-shrink-0 border-t border-[var(--cortex-border)] px-4 py-2 font-mono text-[9px] text-outline/60">
      {#if format === "ts"}
        Paste into a project with <code>reactive-agents</code> installed. Tools register at build time; MCP servers and skills are configured separately.
      {:else}
        Portable config envelope — re-import via the Lab builder or your own loader.
      {/if}
    </div>
  </div>
</div>

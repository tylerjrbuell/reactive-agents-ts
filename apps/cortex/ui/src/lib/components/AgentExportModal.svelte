<script lang="ts">
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { generateAgentTs, generateAgentJson } from "$lib/agent-export.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";

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
  class="fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
  role="button"
  tabindex="-1"
  onclick={onClose}
  onkeydown={(e) => e.key === "Enter" && onClose()}
>
  <div
    class="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--cortex-line)] bg-canvas shadow-2xl"
    role="dialog"
    aria-modal="true"
    aria-label="Export agent"
    tabindex="0"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[var(--cortex-line)] px-4 py-3">
      <h2 class="m-0 truncate text-[15px] font-semibold text-text">
        Export {name || "agent"}
      </h2>
      <IconButton icon="x" label="Close" onclick={onClose} />
    </div>

    <!-- Format toggle + actions -->
    <div class="flex flex-shrink-0 items-center gap-2 border-b border-[var(--cortex-line)] px-4 py-2">
      <div class="flex gap-1" role="group" aria-label="Format">
        <Chip on={format === "ts"} onclick={() => (format = "ts")}>TypeScript</Chip>
        <Chip on={format === "json"} onclick={() => (format = "json")}>JSON</Chip>
      </div>
      <div class="flex-1"></div>
      <Button size="sm" icon="copy" onclick={copy}>Copy</Button>
      <Button size="sm" variant="primary" icon="download" onclick={download}>{filename}</Button>
    </div>

    <!-- Code -->
    <div class="min-h-0 flex-1 overflow-auto bg-surface-1/40 p-4">
      <pre class="m-0 font-mono text-[11px] leading-relaxed text-text/85 whitespace-pre">{code}</pre>
    </div>

    <div class="flex-shrink-0 border-t border-[var(--cortex-line)] px-4 py-2 text-[12px] text-text-3">
      {#if format === "ts"}
        Paste into a project with <code class="font-mono text-[11px]">reactive-agents</code> installed. Tools register at build time; MCP servers and skills are set up separately.
      {:else}
        A portable config: load it with the Lab's Import or your own loader.
      {/if}
    </div>
  </div>
</div>

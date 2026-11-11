<script lang="ts">
  /**
   * Export as code. TypeScript comes from the server (`POST /api/agent-config/source`):
   * the framework's `agentConfigToSource` over the AgentConfig Cortex builds from, plus
   * the Cortex-only settings the code leaves out. JSON is the Lab's import envelope.
   */
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { agentExportFilename, fetchAgentSource, generateAgentJson, type AgentSourceResult } from "$lib/agent-export.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import Overlay from "$lib/components/kit/Overlay.svelte";

  interface Props {
    config: AgentConfig;
    name: string;
    onClose: () => void;
  }
  const { config, name, onClose }: Props = $props();

  let format = $state<"ts" | "json">("ts");
  let ts = $state<AgentSourceResult | null>(null);

  $effect(() => {
    const cfg = config;
    const n = name;
    ts = null;
    let live = true;
    void fetchAgentSource(cfg, n).then((r) => {
      if (live) ts = r;
    });
    return () => {
      live = false;
    };
  });

  const code = $derived(
    format === "json" ? generateAgentJson(config, name) : ts?.ok ? ts.value.source : "",
  );
  const filename = $derived(agentExportFilename(name, format));
  const notInCode = $derived(format === "ts" && ts?.ok ? ts.value.notInCode : []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Copied", `${filename} copied to the clipboard`);
    } catch {
      toast.error("Copy failed");
    }
  }

  function download() {
    const blob = new Blob([code], { type: format === "ts" ? "text/typescript" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<Overlay open title={`Export ${name || "agent"}`} onclose={onClose} width={760}>
  <div class="flex flex-col gap-3">
    <div class="flex gap-1" role="group" aria-label="Format">
      <Chip on={format === "ts"} onclick={() => (format = "ts")}>TypeScript</Chip>
      <Chip on={format === "json"} onclick={() => (format = "json")}>JSON</Chip>
    </div>

    {#if format === "ts" && ts === null}
      <p class="m-0 text-[13px] text-text-2">Writing the code…</p>
    {:else if format === "ts" && ts && !ts.ok}
      <p class="m-0 text-[13px] text-bad" role="alert">Could not export this agent: {ts.error}</p>
    {:else}
      <pre
        class="m-0 max-h-[50vh] overflow-auto rounded-md border border-line bg-surface-1 p-3 font-mono text-[12px] leading-relaxed text-text whitespace-pre"
        aria-label="Exported code">{code}</pre>
    {/if}

    {#if format === "ts" && notInCode.length > 0}
      <section aria-label="Not in this code" class="flex flex-col gap-1">
        <h3 class="m-0 text-[13px] font-semibold text-text">Not in this code</h3>
        <p class="m-0 text-[12px] text-text-2">
          Cortex adds these when it runs the agent. Add the call yourself to match.
        </p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-[12px]">
          {#each notInCode as s (s.setting + s.call)}
            <li class="flex flex-wrap items-baseline gap-x-2">
              <span class="text-text">{s.setting}</span>
              <code class="font-mono text-[11px] text-io">{s.call}</code>
              {#if s.detail}<span class="text-text-2">{s.detail}</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {:else if format === "json"}
      <p class="m-0 text-[12px] text-text-2">A portable config: load it with the Lab's Import.</p>
    {/if}
  </div>

  {#snippet actions()}
    <Button size="sm" icon="copy" onclick={copy} disabled={code === ""}>Copy</Button>
    <Button size="sm" variant="primary" icon="download" onclick={download} disabled={code === ""}>Download {filename}</Button>
  {/snippet}
</Overlay>

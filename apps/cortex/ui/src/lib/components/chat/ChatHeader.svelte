<script lang="ts">
  /**
   * The conversation header: the chat's name, its model, the context meter and
   * session cost, Export and the Trace toggle (spec section 8, Chat).
   */
  import ChatContextMeter from "$lib/components/ChatContextMeter.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import ChatExportMenu from "$lib/components/ChatExportMenu.svelte";
  import ModelLink from "$lib/components/ModelLink.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import type { ExportFormat } from "$lib/chat-export.js";
  import type { ComponentProps } from "svelte";

  interface Props {
    /** The chat's name. */
    title: string;
    provider: string;
    model: string;
    /** Context meter inputs (`contextMeterOf`). */
    meter: Omit<ComponentProps<typeof ChatContextMeter>, "onOpenPanel">;
    /** No turns yet: export is disabled. */
    empty: boolean;
    traceOpen: boolean;
    onExport: (format: ExportFormat) => void | Promise<void>;
    /** Open the inspector on its Context tab. */
    onOpenContext: () => void;
    onToggleTrace: () => void;
  }
  const { title, provider, model, meter, empty, traceOpen, onExport, onOpenContext, onToggleTrace }: Props = $props();
</script>

<header class="convo-h">
  <h1 use:tooltip={title}>{title}</h1>
  {#if provider}
    <span class="chip"><ModelLink {provider} />{#if model}&nbsp;/&nbsp;<ModelLink {provider} {model} />{/if}</span>
  {/if}
  <div class="ctx">
    <ChatContextMeter {...meter} onOpenPanel={onOpenContext} />
    <ChatExportMenu disabled={empty} {onExport} />
    <Button size="sm" icon="trace" aria-pressed={traceOpen} class={traceOpen ? "trace-on" : ""} onclick={onToggleTrace}>Trace</Button>
  </div>
</header>

<style>
  .convo-h {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-height: 53px;
    padding: 10px 24px;
    border-bottom: 1px solid var(--cortex-line);
  }
  h1 {
    min-width: 0;
    max-width: 40ch;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--cortex-t-md);
    font-weight: 600;
    color: var(--cortex-text);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 8px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    white-space: nowrap;
  }
  .ctx { display: flex; align-items: center; gap: 12px; margin-left: auto; }
  .ctx :global(.trace-on) { background: var(--cortex-surface-3); border-color: var(--cortex-line-strong); }
</style>

<script lang="ts">
  /**
   * The paperclip: opens a small menu of what can be attached (picture, audio, text file).
   * A kind the session's model cannot take is disabled, and its tooltip says why. Dropping
   * or pasting files on the composer goes through the same checks.
   */
  import { gateAttachmentKind, type AttachmentKind, type InputCapabilitiesLike } from "@reactive-agents/ui-core";
  import { acceptFor } from "$lib/composer-attachments.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { IconName } from "$lib/icons.js";

  interface Props {
    caps: InputCapabilitiesLike | undefined;
    model: string;
    onFiles: (files: File[]) => void | Promise<void>;
  }
  const { caps, model, onFiles }: Props = $props();

  let open = $state(false);
  let input = $state<HTMLInputElement | null>(null);
  let accept = $state("");
  let rootEl = $state<HTMLSpanElement | null>(null);

  const KINDS: readonly { kind: AttachmentKind; label: string; icon: IconName }[] = [
    { kind: "image", label: "Picture", icon: "image" },
    { kind: "audio", label: "Audio", icon: "mic" },
    { kind: "text", label: "Text file", icon: "file" },
  ];
  const gates = $derived(KINDS.map((k) => ({ ...k, gate: gateAttachmentKind(k.kind, caps, model || "this model") })));

  function choose(kind: AttachmentKind) {
    accept = acceptFor(kind);
    open = false;
    // `accept` is applied before the picker opens.
    queueMicrotask(() => input?.click());
  }

  $effect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootEl?.contains(e.target)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    };
  });
</script>

<span class="wrap" bind:this={rootEl}>
  <button type="button" class="clip" aria-label="Attach a file" aria-haspopup="menu" aria-expanded={open} use:tooltip={"Attach a picture, audio or text file. You can also drop or paste files."} onclick={() => (open = !open)} data-testid="attach-button">
    <Icon name="paperclip" size="sm" />
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label="Attach">
      {#each gates as g (g.kind)}
        <!-- A disabled button gets no pointer events: the wrapper carries the reason. -->
        <span class="tip" use:tooltip={g.gate.allowed ? "" : (g.gate.reason ?? "")}>
          <button type="button" role="menuitem" class="item" disabled={!g.gate.allowed} aria-disabled={!g.gate.allowed} aria-label={g.gate.allowed ? undefined : `${g.label}, unavailable: ${g.gate.reason}`} data-testid="attach-{g.kind}" onclick={() => choose(g.kind)}>
            <Icon name={g.icon} size="sm" />{g.label}
          </button>
        </span>
      {/each}
    </div>
  {/if}
  <input
    bind:this={input}
    type="file"
    {accept}
    multiple
    hidden
    onchange={(e) => {
      const el = e.currentTarget;
      const files = Array.from(el.files ?? []);
      el.value = "";
      if (files.length > 0) void onFiles(files);
    }}
  />
</span>

<style>
  .wrap { position: relative; display: inline-flex; }
  .clip { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0; border-radius: var(--cortex-r-ctl); background: none; color: var(--cortex-text-2); cursor: pointer; }
  .clip:hover { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .clip:focus-visible, .item:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .menu { position: absolute; left: 0; bottom: calc(100% + 6px); z-index: var(--cortex-z-drawer, 30); min-width: 11rem; padding: 4px; border: 1px solid var(--cortex-line-strong); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); box-shadow: 0 8px 28px rgb(0 0 0 / 0.18); display: grid; }
  .tip { display: grid; }
  .item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 0; border-radius: var(--cortex-r-ctl); background: none; color: var(--cortex-text); font: 400 var(--cortex-t-xs) var(--cortex-font-ui); text-align: left; cursor: pointer; }
  .item:hover:not(:disabled) { background: var(--cortex-surface-2); }
  .item:disabled { color: var(--cortex-text-3); cursor: not-allowed; }
</style>

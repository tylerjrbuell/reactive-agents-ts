<script lang="ts">
  /**
   * An input/textarea that highlights `{{template tokens}}` inline. A highlight
   * "backdrop" sits behind a transparent-background field: the user's real text
   * (and caret + focus styles) stay on the field, the colored token rectangles
   * show through from behind. Both layers share `textClass` (font / padding /
   * sizing) so they stay pixel-aligned; the visible frame (border / bg / radius /
   * focus ring) lives on the wrapper via `frameClass` (use `focus-within:` there).
   *
   * `multiline` switches between `<textarea>` (wrapping) and `<input>` (single
   * line, horizontal-scroll synced).
   */
  interface Props {
    value?: string;
    multiline?: boolean;
    id?: string;
    rows?: number;
    placeholder?: string;
    /** Border / background / radius — on the wrapper so the field looks framed. */
    frameClass?: string;
    /** Font / padding / sizing — on BOTH the field and the backdrop (must match). */
    textClass?: string;
    /** Forwarded to the field — for callers that commit via a setter (e.g. a parsed
     * draft or an immutable nested patch) instead of relying on `bind:value`. */
    oninput?: (e: Event) => void;
    onblur?: (e: FocusEvent) => void;
  }
  let {
    value = $bindable(""),
    multiline = false,
    id,
    rows = 2,
    placeholder,
    frameClass = "",
    textClass = "",
    oninput,
    onblur,
  }: Props = $props();

  let field = $state<HTMLTextAreaElement | HTMLInputElement>();
  let scrollX = $state(0);
  let scrollY = $state(0);

  const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

  /** Escape HTML, then wrap `{{tokens}}` in highlight spans. Trailing newline keeps
   * a textarea's last line aligned. */
  function highlight(text: string): string {
    const esc = (text ?? "").replace(/[&<>]/g, (c) => ESC[c] ?? c);
    const marked = esc.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full: string, name: string) =>
      name.startsWith("secret.")
        ? `<span class="hl-secret">${full}</span>`
        : `<span class="hl-token">${full}</span>`,
    );
    return multiline ? marked + "\n" : marked;
  }

  function syncScroll() {
    if (!field) return;
    scrollX = field.scrollLeft;
    scrollY = field.scrollTop;
  }
</script>

<div class="hl-wrap {frameClass}">
  <div class="hl-backdrop {textClass}" class:hl-nowrap={!multiline} aria-hidden="true">
    <div class="hl-content" style="transform: translate({-scrollX}px, {-scrollY}px)">{@html highlight(value)}</div>
  </div>
  {#if multiline}
    <textarea
      bind:this={field}
      {id}
      {rows}
      {placeholder}
      class="hl-field {textClass}"
      bind:value
      onscroll={syncScroll}
      oninput={(e) => { syncScroll(); oninput?.(e); }}
      {onblur}
    ></textarea>
  {:else}
    <input
      bind:this={field}
      {id}
      {placeholder}
      class="hl-field hl-nowrap {textClass}"
      bind:value
      onscroll={syncScroll}
      oninput={(e) => { syncScroll(); oninput?.(e); }}
      onkeyup={syncScroll}
      onclick={syncScroll}
      {onblur}
    />
  {/if}
</div>

<style>
  .hl-wrap {
    position: relative;
    display: block;
  }
  .hl-backdrop {
    position: absolute;
    inset: 0;
    margin: 0;
    overflow: hidden;
    pointer-events: none;
    color: transparent;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: break-word;
    border-color: transparent !important;
    background: transparent !important;
  }
  .hl-backdrop.hl-nowrap {
    white-space: pre;
    word-break: normal;
    overflow-wrap: normal;
  }
  .hl-content {
    will-change: transform;
  }
  .hl-field {
    position: relative;
    display: block;
    margin: 0;
    background: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  .hl-field.hl-nowrap {
    white-space: pre;
  }
  .hl-backdrop :global(.hl-token) {
    border-radius: 3px;
    background: color-mix(in oklab, var(--cortex-primary, #8b5cf6) 24%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--cortex-primary, #8b5cf6) 42%, transparent);
  }
  .hl-backdrop :global(.hl-secret) {
    border-radius: 3px;
    background: color-mix(in oklab, #ef4444 20%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, #ef4444 38%, transparent);
  }
</style>

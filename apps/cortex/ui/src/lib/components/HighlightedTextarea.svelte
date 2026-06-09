<script lang="ts">
  /**
   * A textarea that highlights `{{template tokens}}` inline — for fun (and a bit
   * of guidance). Renders a highlight "backdrop" behind a transparent-background
   * textarea: the user's real text sits on top, the colored token rectangles
   * show through from behind. The two layers share `textClass` (font / padding /
   * sizing) so they stay pixel-aligned; the visible frame (border / bg / rounded)
   * lives on the wrapper via `frameClass`.
   */
  interface Props {
    value: string;
    id?: string;
    rows?: number;
    placeholder?: string;
    /** Border / background / radius — applied to the wrapper so the field looks framed. */
    frameClass?: string;
    /** Font / padding / sizing — applied to BOTH the textarea and the backdrop (must match). */
    textClass?: string;
  }
  let {
    value = $bindable(""),
    id,
    rows = 4,
    placeholder,
    frameClass = "",
    textClass = "",
  }: Props = $props();

  let ta = $state<HTMLTextAreaElement>();
  let scrollY = $state(0);

  const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

  /** Escape HTML, then wrap `{{tokens}}` in highlight spans. Trailing newline keeps
   * the backdrop's last line in step with the textarea's. */
  function highlight(text: string): string {
    const esc = text.replace(/[&<>]/g, (c) => ESC[c] ?? c);
    return (
      esc.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full: string, name: string) =>
        name.startsWith("secret.")
          ? `<span class="hl-secret">${full}</span>`
          : `<span class="hl-token">${full}</span>`,
      ) + "\n"
    );
  }
</script>

<div class="hl-wrap {frameClass}">
  <div class="hl-backdrop {textClass}" aria-hidden="true">
    <div class="hl-content" style="transform: translateY({-scrollY}px)">{@html highlight(value)}</div>
  </div>
  <textarea
    bind:this={ta}
    {id}
    {rows}
    {placeholder}
    class="hl-textarea {textClass}"
    bind:value
    onscroll={() => { if (ta) scrollY = ta.scrollTop; }}
  ></textarea>
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
  .hl-content {
    will-change: transform;
  }
  .hl-textarea {
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

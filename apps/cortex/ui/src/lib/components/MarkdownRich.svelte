<script lang="ts">
  /**
   * Renders GitHub-flavored markdown to sanitized HTML (client-only).
   * Display math: `$$...$$` (outside fenced code) is rendered with KaTeX (`\text`, `\xrightarrow`, etc.).
   * Code blocks have per-block copy buttons.
   */
  import { browser } from "$app/environment";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { renderMarkdownWithMath } from "$lib/markdown/render-markdown-with-math.js";
  import "katex/dist/katex.min.css";

  interface Props {
    markdown: string;
    class?: string;
    /** Show floating copy control (copies raw markdown). Default true. */
    showCopy?: boolean;
  }
  let {
    markdown,
    class: className = "",
    showCopy = true,
  }: Props = $props();

  let html = $state("");
  let renderError = $state(false);
  let containerRef = $state<HTMLDivElement | null>(null);
  let copiedBlockId = $state<string | null>(null);

  $effect(() => {
    if (!browser) return;
    const md = markdown;
    if (!md.trim()) {
      html = "";
      renderError = false;
      return;
    }
    let cancelled = false;
    renderError = false;
    void (async () => {
      try {
        const safe = await renderMarkdownWithMath(md);
        if (!cancelled) html = safe;
      } catch {
        if (!cancelled) {
          renderError = true;
          html = "";
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // Add copy buttons to code blocks after rendering
  $effect(() => {
    if (!browser || !containerRef || !html) return;

    const preElements = containerRef.querySelectorAll("pre");
    preElements.forEach((pre, index) => {
      const blockId = `code-block-${index}`;
      const code = pre.querySelector("code");

      if (!code) return;

      // Check if we've already added a button to this block
      if (pre.querySelector(`[data-copy-block-id="${blockId}"]`)) {
        return;
      }

      // Create button wrapper
      const buttonWrapper = document.createElement("div");
      buttonWrapper.setAttribute("data-copy-block-id", blockId);
      buttonWrapper.className =
        "absolute top-1 right-1 z-10 flex items-center gap-1";

      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "flex items-center gap-1 px-2 py-1 rounded-md border border-secondary/25 " +
        "text-secondary/90 font-mono text-[9px] uppercase tracking-wider " +
        "bg-surface-container-low/90 hover:bg-secondary/10 hover:border-secondary/40 " +
        "transition-colors cursor-pointer shadow-sm";
      button.setAttribute("aria-label", "Copy code block");

      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined text-[14px] leading-none";
      icon.textContent = "content_copy";

      const label = document.createElement("span");
      label.textContent = "Copy";

      button.appendChild(icon);
      button.appendChild(label);

      button.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const codeText = code.innerText;
          await navigator.clipboard.writeText(codeText);
          toast.success("Copied", "Code block copied to clipboard");
          copiedBlockId = blockId;
          setTimeout(() => {
            copiedBlockId = null;
          }, 2000);
        } catch {
          toast.error("Copy failed");
        }
      });

      buttonWrapper.appendChild(button);
      pre.style.position = "relative";
      pre.insertBefore(buttonWrapper, code);
    });
  });

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Copied", "Markdown copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }
</script>

<div class="relative min-w-0 {className}">
  {#if showCopy && browser && markdown.trim()}
    <div class="absolute top-0 right-0 z-10 flex items-start pt-0.5">
      <Tooltip text="Copy as Markdown">
        <button
          type="button"
          onclick={() => void copyRaw()}
          aria-label="Copy markdown source"
          class="flex items-center gap-1 px-2 py-1 rounded-md border border-secondary/25
                 text-secondary/90 font-mono text-[9px] uppercase tracking-wider
                 bg-surface-container-low/90 hover:bg-secondary/10 hover:border-secondary/40
                 transition-colors cursor-pointer shadow-sm"
        >
          <span class="material-symbols-outlined text-[14px] leading-none">content_copy</span>
          Copy
        </button>
      </Tooltip>
    </div>
  {/if}

  {#if browser && html}
    <div bind:this={containerRef} class="markdown-deliverable pr-24 max-w-none">{@html html}</div>
  {:else if browser && markdown.trim() && !renderError}
    <p class="font-mono text-[10px] text-outline/40 m-0 py-2">Formatting…</p>
  {:else if renderError}
    <pre
      class="font-mono text-[11px] text-on-surface/80 leading-relaxed whitespace-pre-wrap break-words m-0"
    >{markdown}</pre>
  {:else if !browser && markdown.trim()}
    <pre
      class="font-mono text-[11px] text-on-surface/70 leading-relaxed whitespace-pre-wrap break-words m-0"
    >{markdown}</pre>
  {/if}
</div>

<style>
  /* Theme tokens: --cortex-md-* in app.css (:root + html.dark) */
  .markdown-deliverable :global(p) {
    margin: 0.5rem 0;
    line-height: 1.55;
    color: var(--cortex-md-text);
  }
  .markdown-deliverable :global(p:first-child) {
    margin-top: 0;
  }
  .markdown-deliverable :global(p:last-child) {
    margin-bottom: 0;
  }
  .markdown-deliverable :global(h1),
  .markdown-deliverable :global(h2),
  .markdown-deliverable :global(h3) {
    font-family: ui-monospace, monospace;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--cortex-md-h1);
    margin: 1rem 0 0.5rem;
    line-height: 1.25;
    font-size: 0.7rem;
  }
  .markdown-deliverable :global(h1:first-child),
  .markdown-deliverable :global(h2:first-child),
  .markdown-deliverable :global(h3:first-child) {
    margin-top: 0;
  }
  .markdown-deliverable :global(h4),
  .markdown-deliverable :global(h5),
  .markdown-deliverable :global(h6) {
    font-weight: 600;
    color: var(--cortex-md-h4);
    margin: 0.75rem 0 0.35rem;
    font-size: 0.8rem;
  }
  .markdown-deliverable :global(ul),
  .markdown-deliverable :global(ol) {
    margin: 0.35rem 0 0.5rem;
    padding-left: 1.25rem;
  }
  .markdown-deliverable :global(li) {
    margin: 0.2rem 0;
    line-height: 1.5;
    color: var(--cortex-md-text-muted);
  }
  .markdown-deliverable :global(blockquote) {
    margin: 0.5rem 0;
    padding: 0.35rem 0 0.35rem 0.75rem;
    border-left: 3px solid var(--cortex-md-blockquote-border);
    color: var(--cortex-md-blockquote);
    font-size: 0.85em;
  }
  .markdown-deliverable :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
    padding: 0.1rem 0.35rem;
    border-radius: 0.25rem;
    background: var(--cortex-md-code-bg);
    border: 1px solid var(--cortex-md-code-border);
    color: var(--cortex-md-code-fg);
  }
  .markdown-deliverable :global(pre) {
    margin: 0.5rem 0;
    padding: 0.65rem 0.75rem;
    border-radius: 0.375rem;
    background: var(--cortex-md-pre-bg);
    border: 1px solid var(--cortex-md-pre-border);
    overflow-x: auto;
    max-height: min(50vh, 24rem);
  }
  .markdown-deliverable :global(pre code) {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--cortex-md-pre-fg);
    font-size: 0.7rem;
    line-height: 1.45;
  }
  .markdown-deliverable :global(a) {
    color: var(--cortex-md-link);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .markdown-deliverable :global(a:hover) {
    color: var(--cortex-md-link-hover);
  }
  .markdown-deliverable :global(hr) {
    margin: 0.75rem 0;
    border: 0;
    border-top: 1px solid var(--cortex-md-hr);
  }
  .markdown-deliverable :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
    margin: 0.5rem 0;
  }
  .markdown-deliverable :global(th),
  .markdown-deliverable :global(td) {
    border: 1px solid var(--cortex-md-table-border);
    padding: 0.35rem 0.5rem;
    text-align: left;
  }
  .markdown-deliverable :global(td) {
    color: var(--cortex-md-text);
  }
  .markdown-deliverable :global(th) {
    background: var(--cortex-md-th-bg);
    color: var(--cortex-md-th-text);
    font-family: ui-monospace, monospace;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .markdown-deliverable :global(.katex-display-shell) {
    text-align: center;
  }
  /* KaTeX default CSS fixes black text; inherit so theme --cortex-md-katex applies */
  .markdown-deliverable :global(.katex-display-shell .katex) {
    color: var(--cortex-md-katex);
    font-size: 1.05em;
  }
  .markdown-deliverable :global(.katex-display-shell .katex *) {
    color: inherit;
  }
  .markdown-deliverable :global(.katex-display-shell .katex svg) {
    fill: currentColor;
    stroke: currentColor;
  }
</style>

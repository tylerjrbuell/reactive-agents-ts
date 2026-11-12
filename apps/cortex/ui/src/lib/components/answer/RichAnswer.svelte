<script lang="ts">
  /**
   * A final answer, read and used: the markdown (tables, code with copy and a language
   * label, callouts, task lists, math, safe links), a toolbar that copies it rendered or as
   * Markdown and saves it as a file (Markdown or a standalone HTML page), an outline of a
   * long answer's headings, and the deliverables the run produced as cards. One component
   * for the chat turn and the run view.
   */
  import { deliverablesOf, outlineOf, type DeclaredDeliverableLike, type DeliverableCallLike } from "@reactive-agents/ui-core";
  import { answerTitleOf, exportFileName, htmlDocument } from "$lib/answer-export.js";
  import { saveTextFile } from "$lib/chat-download.js";
  import { toast } from "$lib/stores/toast-store.js";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
  import DeliverablesStrip from "$lib/components/answer/DeliverablesStrip.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    markdown: string;
    /** The run's tool calls: file writes and edits become deliverables. */
    calls?: readonly DeliverableCallLike[];
    /** Deliverables the run's receipt declared. */
    declared?: readonly DeclaredDeliverableLike[];
    /** The typed result object, when the run had an output schema. */
    structured?: unknown;
    /** Show the toolbar for every answer; otherwise only for a long one, one with an outline or deliverables. */
    toolbar?: "auto" | "always";
    /** The host already shows a Copy; hide this one's Copy answer. */
    hostCopies?: boolean;
    /** The markdown's own floating Copy (for a short answer with no toolbar and no host Copy). */
    inlineCopy?: boolean;
  }
  const { markdown, calls = [], declared = [], structured, toolbar = "auto", hostCopies = false, inlineCopy = false }: Props = $props();

  let bodyEl = $state<HTMLDivElement | null>(null);
  let menu = $state<"outline" | "save" | null>(null);

  const outline = $derived(outlineOf(markdown));
  const items = $derived(deliverablesOf({ toolCalls: calls, declared, structured }));
  const substantial = $derived(markdown.length >= 700 || outline.length > 0 || items.length > 0);
  // No toolbar without text (a run that only produced files shows just its deliverables).
  const showToolbar = $derived(markdown.trim() !== "" && (toolbar === "always" || substantial));

  const renderedHtml = () => bodyEl?.querySelector(".markdown-deliverable")?.innerHTML ?? "";
  const renderedText = () => (bodyEl?.querySelector(".markdown-deliverable") as HTMLElement | null)?.innerText ?? markdown;

  /** Copy as rich text (HTML plus plain) so it pastes formatted into docs and mail; plain where rich is unavailable. */
  async function copyAnswer() {
    try {
      const html = renderedHtml();
      if (html !== "" && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([renderedText()], { type: "text/plain" }) }),
        ]);
      } else {
        await navigator.clipboard.writeText(renderedText());
      }
      toast.success("Copied", "Answer copied");
    } catch {
      toast.error("Copy failed");
    }
  }
  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Copied", "Markdown copied");
    } catch {
      toast.error("Copy failed");
    }
  }
  const saveMarkdown = () => {
    menu = null;
    saveTextFile(markdown, exportFileName(markdown, "md"), "text/markdown");
  };
  const saveHtml = () => {
    menu = null;
    saveTextFile(htmlDocument(answerTitleOf(markdown), renderedHtml()), exportFileName(markdown, "html"), "text/html");
  };

  function jump(id: string) {
    menu = null;
    const target = bodyEl?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  }

  $effect(() => {
    if (menu === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") menu = null;
    };
    const onDoc = (e: PointerEvent) => {
      if (e.target instanceof Element && !e.target.closest("[data-answer-menu]")) menu = null;
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDoc, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDoc, true);
    };
  });
</script>

<div class="rich" data-testid="rich-answer">
  {#if showToolbar}
    <div class="bar" role="toolbar" aria-label="Answer actions" data-answer-menu>
      {#if !hostCopies}<Button size="sm" variant="ghost" icon="copy" onclick={() => void copyAnswer()}>Copy answer</Button>{/if}
      <Button size="sm" variant="ghost" icon="code" onclick={() => void copyMarkdown()}>Copy as Markdown</Button>
      <span class="menu-wrap">
        <Button size="sm" variant="ghost" icon="download" aria-haspopup="menu" aria-expanded={menu === "save"} onclick={() => (menu = menu === "save" ? null : "save")}>Save as file</Button>
        {#if menu === "save"}
          <div class="menu" role="menu" aria-label="Save as">
            <button type="button" role="menuitem" onclick={saveMarkdown}><Icon name="file" size="sm" />Markdown (.md)</button>
            <button type="button" role="menuitem" onclick={saveHtml}><Icon name="file" size="sm" />Web page (.html)</button>
          </div>
        {/if}
      </span>
      {#if outline.length > 0}
        <span class="menu-wrap right">
          <Button size="sm" variant="ghost" icon="list" aria-haspopup="menu" aria-expanded={menu === "outline"} onclick={() => (menu = menu === "outline" ? null : "outline")}>Outline</Button>
          {#if menu === "outline"}
            <div class="menu wide" role="menu" aria-label="Outline">
              {#each outline as h (h.id)}
                <button type="button" role="menuitem" style:padding-left="{10 + (h.depth - 1) * 12}px" onclick={() => jump(h.id)}>{h.text}</button>
              {/each}
            </div>
          {/if}
        </span>
      {/if}
    </div>
  {/if}
  {#if markdown.trim() !== ""}
    <div bind:this={bodyEl}>
      <GuardedMarkdown {markdown} showCopy={inlineCopy && !showToolbar} />
    </div>
  {/if}
  {#if items.length > 0}<DeliverablesStrip {items} />{/if}
</div>

<style>
  .rich { display: grid; gap: 12px; min-width: 0; }
  /* Sticky so a long answer keeps its actions and outline in reach. */
  .bar { position: sticky; top: 0; z-index: var(--cortex-z-sticky, 10); display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; padding: 4px 0; background: var(--cortex-canvas); border-bottom: 1px solid var(--cortex-line); }
  .menu-wrap { position: relative; display: inline-flex; }
  .menu-wrap.right { margin-left: auto; }
  .menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: var(--cortex-z-drawer, 30); display: grid; min-width: 12rem; padding: 4px; border: 1px solid var(--cortex-line-strong); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); box-shadow: 0 8px 28px rgb(0 0 0 / 0.18); }
  .menu-wrap.right .menu { left: auto; right: 0; }
  .menu.wide { min-width: 16rem; max-width: 22rem; max-height: 18rem; overflow: auto; }
  .menu button { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 0; border-radius: var(--cortex-r-ctl); background: none; color: var(--cortex-text); font: 400 var(--cortex-t-xs) var(--cortex-font-ui); text-align: left; cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: var(--cortex-surface-2); outline: none; }
</style>

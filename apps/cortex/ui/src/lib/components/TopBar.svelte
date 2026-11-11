<script lang="ts">
  /**
   * The app frame's 52px top bar (Bench spec section 8, "App frame"): the
   * neural mark and "Cortex", nav Beacon · Chat · Runs · Lab (the current page
   * marked by an accent underline, a live count on Runs), then a running-agents
   * pill, the command button with its shortcut, the theme switch and Settings.
   * While any agent runs, a 1px signal hairline sits under the bar (static).
   * Icons come from the kit (`Icon`), never a ligature font, so names stay clean.
   */
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import NeuralMark from "$lib/components/kit/NeuralMark.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import type { IconName } from "$lib/icons.js";

  interface Props {
    /** Current path (`$page.url.pathname`). */
    pathname: string;
    /** Agents working now (live cognitive states). */
    running: number;
    isDark: boolean;
    onToggleTheme: () => void;
    onOpenPalette: () => void;
    /** Chat only: the narrow-screen sessions toggle. */
    chatSidebarOpen?: boolean;
    onToggleChatSidebar?: () => void;
  }

  let { pathname, running, isDark, onToggleTheme, onOpenPalette, chatSidebarOpen = false, onToggleChatSidebar }: Props = $props();

  const NAV: readonly { readonly label: string; readonly href: string; readonly icon: IconName }[] = [
    { label: "Beacon", href: "/", icon: "beacon" },
    { label: "Chat", href: "/chat", icon: "chat" },
    { label: "Runs", href: "/runs", icon: "runs" },
    { label: "Lab", href: "/lab", icon: "lab" },
  ];

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
</script>

<header class="topbar" data-live={running > 0 || undefined}>
  {#if pathname.startsWith("/chat") && onToggleChatSidebar}
    <IconButton
      class="sidebar-toggle"
      id="chat-sidebar-toggle"
      icon={chatSidebarOpen ? "x" : "menu"}
      label={chatSidebarOpen ? "Close sessions" : "Open sessions"}
      aria-expanded={chatSidebarOpen}
      aria-controls="chat-sidebar"
      onclick={onToggleChatSidebar}
    />
  {/if}
  <a class="brand" href="/" aria-label="Cortex home">
    <NeuralMark size={22} />
    <span>Cortex</span>
  </a>

  <nav class="nav cortex-no-scrollbar" aria-label="Primary">
    {#each NAV as item (item.href)}
      <a href={item.href} title={item.label} aria-current={isActive(item.href) ? "page" : undefined}>
        <Icon name={item.icon} />
        <span class="lbl">{item.label}</span>
        {#if item.href === "/runs" && running > 0}<span class="count">{running} live</span>{/if}
      </a>
    {/each}
  </nav>

  <div class="right">
    {#if running > 0}
      <span class="live-pill"><Status tone="running" label="Running" dotOnly />{running} {running === 1 ? "agent" : "agents"} running</span>
    {/if}
    <button type="button" class="cmd" onclick={onOpenPalette} aria-label="Search or run a command" aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}>
      <Icon name="search" size="sm" />
      <span class="cmd-text">Search or run a command</span>
      <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
    <IconButton icon={isDark ? "sun" : "moon"} label={isDark ? "Switch to light theme" : "Switch to dark theme"} onclick={onToggleTheme} />
    <IconButton icon="settings" label="Settings" href="/settings" />
  </div>
</header>

<style>
  .topbar {
    position: relative;
    z-index: var(--cortex-z-nav);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    height: 52px;
    padding: 0 20px;
    border-bottom: 1px solid var(--cortex-line);
    background: var(--cortex-canvas);
  }
  .topbar[data-live]::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 1px;
    background: linear-gradient(90deg, transparent 4%, #8b5cf6 30%, #22d3ee 70%, transparent 96%);
    opacity: 0.7;
    pointer-events: none;
  }
  .topbar :global(.sidebar-toggle) { margin-left: -8px; }
  /* The chat rail is a drawer below 1024px only (routes/chat); above it the rail is always shown. */
  @media (min-width: 1024px) { .topbar :global(.sidebar-toggle) { display: none; } }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    font-size: var(--cortex-t-md);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--cortex-text);
    text-decoration: none;
  }
  .brand:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 3px; border-radius: var(--cortex-r-ctl); }
  .nav { display: flex; gap: 2px; margin-left: 16px; min-width: 0; overflow-x: auto; }
  .nav a {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--cortex-r-ctl);
    color: var(--cortex-text-2);
    text-decoration: none;
    font-size: var(--cortex-t-sm);
    font-weight: 500;
    white-space: nowrap;
  }
  .nav a:hover { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .nav a:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .nav a[aria-current="page"] {
    color: var(--cortex-text);
    background: var(--cortex-surface-2);
    box-shadow: inset 0 -2px 0 var(--cortex-accent);
    border-radius: var(--cortex-r-ctl) var(--cortex-r-ctl) 2px 2px;
  }
  .count { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .right { margin-left: auto; display: flex; align-items: center; gap: 4px; flex: none; }
  .live-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px 3px 7px;
    border-radius: 999px;
    background: var(--cortex-surface-2);
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-2);
    white-space: nowrap;
  }
  .cmd {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: transparent;
    color: var(--cortex-text-2);
    font: 500 var(--cortex-t-xs) var(--cortex-font-ui);
    cursor: pointer;
    white-space: nowrap;
  }
  .cmd:hover { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .cmd:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  kbd {
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    padding: 1px 6px;
    border-radius: var(--cortex-r-chip);
    border: 1px solid var(--cortex-line-strong);
    color: var(--cortex-text-2);
    background: var(--cortex-surface-1);
  }
  @media (max-width: 1100px) { .cmd-text { display: none; } }
  @media (max-width: 900px) { .live-pill { display: none; } }
  @media (max-width: 640px) {
    .topbar { gap: 8px; padding: 0 12px; }
    .nav { margin-left: 0; }
    .count, .brand span { display: none; }
    /* Icon-only nav, but the name stays for screen readers. */
    .lbl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  }
</style>

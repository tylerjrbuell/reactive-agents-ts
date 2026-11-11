/**
 * The command palette's built-in commands, one list for the whole app (the
 * layout used to register a second, overlapping set). Side effects come in
 * through `PaletteDeps`, so the list is testable without a browser.
 */
import type { Command } from "./stores/command-palette.js";
import type { IconName } from "./icons.js";
import { LAB_TABS, labTabHash, type LabTab } from "./lab-tabs.js";

/** What the commands need from the app. */
export interface PaletteDeps {
  /** SvelteKit navigation. */
  readonly goto: (path: string) => Promise<void>;
  /** Fire a window event (`cortex:lab-tab`, `cortex:focus-input`, `cortex:toggle-theme`). */
  readonly dispatch: (name: string, detail?: string) => void;
  /** Cortex server base URL (`CORTEX_SERVER_URL`). */
  readonly serverUrl: string;
  /** Write text to the clipboard; failures are ignored. */
  readonly copy: (text: string) => Promise<void>;
  /** Fetch the newest run id, or null. */
  readonly latestRunId: () => Promise<string | null>;
}

const LAB_TAB_META: Record<LabTab, { icon: IconName; description: string; keywords: string[] }> = {
  builder: { icon: "edit", description: "Configure and run a new agent", keywords: ["builder", "create", "configure", "agent"] },
  agents: { icon: "agents", description: "Saved and gateway agents", keywords: ["saved", "gateway", "scheduled", "persistent"] },
  skills: { icon: "think", description: "Agent skills and skill files", keywords: ["skills", "living"] },
  memory: { icon: "server", description: "What an agent remembers", keywords: ["memory", "facts", "workflows", "studio"] },
  tools: { icon: "tool", description: "Tool registry and MCP servers", keywords: ["tools", "mcp", "registry"] },
  prompts: { icon: "book", description: "Reusable prompts", keywords: ["prompts", "library", "templates", "snippets"] },
};

/** The built-in palette commands: pages, Lab tabs, runs and app actions. */
export function paletteCommands(deps: PaletteDeps): Command[] {
  const go = (path: string) => () => void deps.goto(path);
  const labTab = (tab: LabTab) => () =>
    // The event covers being on /lab already, where the navigation does not remount the page.
    void deps.goto(`/lab${labTabHash(tab)}`).then(() => deps.dispatch("cortex:lab-tab", tab));

  return [
    { id: "go-beacon", group: "Navigate", label: "Beacon", description: "Running agents and the prompt bar", icon: "beacon", keywords: ["home", "agents", "launch", "board", "field"], action: go("/") },
    { id: "go-chat", group: "Navigate", label: "Chat", description: "Conversations with an agent", icon: "chat", keywords: ["conversation", "session", "messages", "new"], action: go("/chat") },
    { id: "go-runs", group: "Navigate", label: "Runs", description: "Run history and traces", icon: "runs", keywords: ["history", "trace", "log"], action: go("/runs") },
    { id: "go-lab", group: "Navigate", label: "Lab", description: "Build, save and inspect agents", icon: "lab", keywords: ["builder", "configure"], action: go("/lab") },
    { id: "go-settings", group: "Navigate", label: "Settings", description: "Providers, defaults, appearance", icon: "settings", keywords: ["preferences", "config", "keys", "providers"], action: go("/settings") },
    ...LAB_TABS.map(
      (t): Command => ({
        id: `lab-${t.id}`,
        group: "Lab",
        label: t.label,
        description: LAB_TAB_META[t.id].description,
        icon: LAB_TAB_META[t.id].icon,
        keywords: ["lab", ...LAB_TAB_META[t.id].keywords],
        action: labTab(t.id),
      }),
    ),
    {
      id: "view-last-run",
      group: "Runs",
      label: "Open the latest run",
      description: "Jump to the newest run's trace",
      icon: "signal",
      keywords: ["last", "recent", "newest", "run", "trace"],
      action: async () => {
        const id = await deps.latestRunId();
        if (id) await deps.goto(`/run/${encodeURIComponent(id)}`);
      },
    },
    {
      id: "focus-input",
      group: "Actions",
      label: "Write a prompt",
      description: "Go to Beacon and focus the prompt bar",
      icon: "edit",
      shortcut: "R",
      keywords: ["input", "prompt", "focus", "type", "run"],
      action: () => void deps.goto("/").then(() => deps.dispatch("cortex:focus-input")),
    },
    {
      id: "toggle-theme",
      group: "Actions",
      label: "Switch light or dark theme",
      description: "Flip the colour scheme",
      icon: "sun",
      keywords: ["theme", "dark", "light", "mode", "appearance"],
      action: () => deps.dispatch("cortex:toggle-theme"),
    },
    {
      id: "connect-snippet",
      group: "Actions",
      label: "Copy .withCortex() call",
      description: "Connect an agent to this Cortex",
      icon: "code",
      keywords: ["connect", "snippet", "copy", "url"],
      action: () => deps.copy(`.withCortex("${deps.serverUrl}")`),
    },
    {
      id: "copy-env",
      group: "Actions",
      label: "Copy CORTEX_URL",
      description: "The server URL as an environment variable",
      icon: "copy",
      keywords: ["env", "url", "copy", "cortex_url"],
      action: () => deps.copy(`CORTEX_URL=${deps.serverUrl}`),
    },
  ];
}

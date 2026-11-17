/**
 * The tool dropdown of a plan step: the tools the chat session offers (its own tools and the tools
 * of the MCP servers it attaches, grouped by server), read from the same catalog the quick bar's
 * tools chip uses (`chat-quickbar-data.ts`) under the same availability rules
 * (`chat-quickbar.ts`, `tool-selection.ts`). A hint the session no longer offers stays in the list
 * under its own heading, so an old or imported plan never loses a name silently. Pure.
 */
import type { QuickbarCatalog } from "./chat-quickbar-data.js";
import { selectedTools, toolsOn } from "./chat-quickbar.js";
import { mcpToolAvailable } from "./tool-selection.js";
import type { SelectOption } from "./select.js";

/** Heading for hinted names the session does not offer. */
export const UNAVAILABLE_TOOLS_GROUP = "Not in this session's tools";
/** Heading for the session's own tools. */
export const OWN_TOOLS_GROUP = "Tools";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Options for one step's tool `Select`: "No tool" first, then the session's own tools, then each
 * attached MCP server's available tools, then any `hinted` name nothing above offers. A name is
 * listed once (first heading wins). With tools off the session offers nothing, so only hinted
 * names remain.
 */
export function planToolOptions(cfg: Record<string, unknown>, catalog: QuickbarCatalog, hinted: readonly string[]): SelectOption[] {
  const out: SelectOption[] = [{ value: "", label: "No tool" }];
  const seen = new Set<string>([""]);
  const add = (value: string, label: string, group: string): void => {
    if (seen.has(value)) return;
    seen.add(value);
    out.push({ value, label, group });
  };

  if (toolsOn(cfg)) {
    const mcpCfg = { tools: strings(cfg.tools), mcpServerIds: strings(cfg.mcpServerIds) };
    // A tool of a switched-off server is not offered (`catalog.mcpServers` holds enabled servers only) and is not an own tool either.
    const mcpNames = new Set([...catalog.mcpServers, ...(catalog.disabledMcpServers ?? [])].flatMap((s) => s.tools));
    const labels = new Map(catalog.builtinTools.map((t) => [t.name, t.label] as const));
    for (const name of selectedTools(cfg)) {
      if (!mcpNames.has(name)) add(name, labels.get(name) ?? name, OWN_TOOLS_GROUP);
    }
    for (const server of catalog.mcpServers) {
      if (!mcpCfg.mcpServerIds.includes(server.serverId)) continue;
      for (const tool of server.tools) {
        if (mcpToolAvailable(mcpCfg, server, tool)) add(tool, tool, server.name);
      }
    }
  }
  for (const name of hinted) if (name !== "") add(name, name, UNAVAILABLE_TOOLS_GROUP);
  return out;
}

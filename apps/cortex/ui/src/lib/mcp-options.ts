/** Choices for a server's read-only option, as the Select shows them. */
import type { McpDraft } from "./tool-workshop.js";

/** The `readOnly` modes and their words. */
export const READ_ONLY_MODES: readonly { readonly value: McpDraft["readOnlyMode"]; readonly label: string }[] = [
  { value: "off", label: "Not declared" },
  { value: "all", label: "All tools are read-only" },
  { value: "tools", label: "Only specific tools" },
];

/** MCP transports the form offers, in menu order. */
export const MCP_TRANSPORTS = ["stdio", "sse", "websocket", "streamable-http"] as const;

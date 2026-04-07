/**
 * Shared provider allowlists for Chat / Lab.
 * Model options are loaded at runtime via `/api/models/framework/:provider` and `/api/models/ollama`
 * — see `$lib/framework-models.ts`.
 */
export const CHAT_PROVIDERS = ["anthropic", "openai", "gemini", "ollama", "litellm", "test"] as const;
export type ChatProviderId = (typeof CHAT_PROVIDERS)[number];

/** Subset of tools users can allowlist for chat (merged with framework kernel tools on the server). */
export const CHAT_TOOL_PRESETS = [
  { id: "web-search", label: "Web Search", icon: "search" },
  { id: "file-read", label: "File Read", icon: "folder_open" },
  { id: "file-write", label: "File Write", icon: "edit_document" },
  { id: "code-execute", label: "Code Execute", icon: "terminal" },
  { id: "recall", label: "Recall", icon: "psychology" },
  { id: "find", label: "Find", icon: "manage_search" },
] as const;

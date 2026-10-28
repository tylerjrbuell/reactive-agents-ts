import { PROVIDER_FALLBACK } from "./providers.js";

/**
 * Shared provider allowlist for Chat / Lab (static fallback; live list via `loadProviders` in `$lib/providers.ts`).
 * Model options are loaded at runtime via `/api/models/:provider`
 * — see `$lib/framework-models.ts`.
 */
export const CHAT_PROVIDERS: readonly string[] = PROVIDER_FALLBACK.map((p) => p.id);
export type ChatProviderId = string;

/** Subset of tools users can allowlist for chat (merged with framework kernel tools on the server). */
export const CHAT_TOOL_PRESETS = [
  { id: "web-search", label: "Web Search", icon: "search" },
  { id: "file-read", label: "File Read", icon: "folder_open" },
  { id: "file-write", label: "File Write", icon: "edit_document" },
  { id: "code-execute", label: "Code Execute", icon: "terminal" },
  { id: "shell-execute", label: "Host Shell", icon: "computer" },
  { id: "recall", label: "Recall", icon: "psychology" },
  { id: "find", label: "Find", icon: "manage_search" },
] as const;

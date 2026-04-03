/**
 * Shared provider / model / tool presets for Lab builder and Chat session form.
 * Keep labels aligned with {@link AgentConfigPanel}.
 */
export const CHAT_PROVIDERS = ["anthropic", "openai", "gemini", "ollama", "litellm", "test"] as const;
export type ChatProviderId = (typeof CHAT_PROVIDERS)[number];

export const STATIC_MODEL_OPTIONS: Record<string, readonly { value: string; label: string }[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o1", label: "o1" },
  ],
  gemini: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.0-pro", label: "Gemini 2.0 Pro" },
  ],
  litellm: [],
  test: [{ value: "test-model", label: "Test model" }],
};

/** Subset of tools users can allowlist for chat (merged with framework kernel tools on the server). */
export const CHAT_TOOL_PRESETS = [
  { id: "web-search", label: "Web Search", icon: "search" },
  { id: "file-read", label: "File Read", icon: "folder_open" },
  { id: "file-write", label: "File Write", icon: "edit_document" },
  { id: "code-execute", label: "Code Execute", icon: "terminal" },
  { id: "recall", label: "Recall", icon: "psychology" },
  { id: "find", label: "Find", icon: "manage_search" },
] as const;

import { defaultConfig, type AgentConfig } from "./types/agent-config.js";
import { cortexRunsPostBody } from "./cortex-runs-post-body.js";
import { effectiveToolsEnabled } from "./tool-selection.js";
import { fetchModelsForProvider } from "./framework-models.js";
import type { CortexSettings } from "./stores/settings.js";

/** Chats start with memory off: history carries context, and recalled cross-run memory can suppress tool use. */
export const chatDefaultConfig = (): AgentConfig => ({
  ...defaultConfig(),
  memory: { working: false, episodic: false, semantic: false },
});

/**
 * Body for a chat session created without the config modal: the user's default
 * provider and model (the provider's default model when none is set), memory off,
 * thinking and tool calls streamed, auto-naming on. Same shape as the modal's payload.
 */
export async function freshChatPayload(s: Pick<CortexSettings, "defaultProvider" | "defaultModel" | "ollamaEndpoint">): Promise<Record<string, unknown>> {
  let model = s.defaultModel.trim();
  if (!model) {
    const listed = await fetchModelsForProvider(s.defaultProvider, s.defaultProvider === "ollama" ? (s.ollamaEndpoint ?? undefined) : undefined).catch(() => undefined);
    model = listed?.default ?? listed?.options[0]?.value ?? "";
  }
  const cfg: AgentConfig = { ...chatDefaultConfig(), provider: s.defaultProvider, model };
  const { prompt: _prompt, ...typed } = cortexRunsPostBody("", cfg);
  return { ...typed, enableTools: effectiveToolsEnabled(cfg, undefined), autoName: true, streamReasoningSteps: false };
}

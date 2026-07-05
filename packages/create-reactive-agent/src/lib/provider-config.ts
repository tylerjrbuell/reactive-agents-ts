import type { Provider } from "../types.js";

export function providerEnvVar(p: Provider): string | null {
  switch (p) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "ollama":
      return null;
  }
}

export function providerDefaultModel(p: Provider): string {
  switch (p) {
    case "anthropic":
      return "claude-sonnet-4-6";
    case "openai":
      return "gpt-4o-mini";
    case "google":
      return "gemini-2.0-flash";
    case "groq":
      return "llama-3.3-70b-versatile";
    case "xai":
      return "grok-4";
    case "ollama":
      return "qwen3:14b";
  }
}

export function providerImport(p: Provider): Provider {
  return p;
}

export function providerDisplayName(p: Provider): string {
  switch (p) {
    case "anthropic":
      return "Anthropic (Claude)";
    case "openai":
      return "OpenAI";
    case "google":
      return "Google (Gemini)";
    case "groq":
      return "Groq (fast LPU inference)";
    case "xai":
      return "xAI (Grok)";
    case "ollama":
      return "Ollama (local)";
  }
}

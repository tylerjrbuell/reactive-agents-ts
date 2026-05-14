import type { Provider } from "../types.js";

export function providerEnvVar(p: Provider): string | null {
  switch (p) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
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
    case "ollama":
      return "qwen3:14b";
  }
}

export function providerImport(p: Provider): "anthropic" | "openai" | "google" | "ollama" {
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
    case "ollama":
      return "Ollama (local)";
  }
}

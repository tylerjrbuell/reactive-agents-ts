import { describe, expect, it } from "bun:test";
import { isSecretEnvName, stripSecretEnv } from "./hermetic-env.js";

describe("hermetic test env", () => {
  it("strips provider credential variables and keeps everything else", () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: "sk-a",
      OPENAI_API_KEY: "sk-o",
      GOOGLE_API_KEY: "g",
      GEMINI_API_KEY: "g",
      ELEVENLABS_API_KEY: "e",
      OLLAMA_HOST: "http://localhost:11434",
      PATH: "/bin",
      CORTEX_PORT: "4321",
    };
    expect(stripSecretEnv(env).sort()).toEqual(["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY"]);
    expect(Object.keys(env).sort()).toEqual(["CORTEX_PORT", "OLLAMA_HOST", "PATH"]);
    expect(isSecretEnvName("HOME")).toBe(false);
  });
});

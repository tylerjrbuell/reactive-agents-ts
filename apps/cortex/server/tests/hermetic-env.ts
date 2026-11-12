/** Names of environment variables that hold a provider or service credential (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...). */
export const isSecretEnvName = (name: string): boolean => /(^|_)(API_KEY|API_TOKEN|AUTH_TOKEN|ACCESS_TOKEN|SECRET_KEY)$/i.test(name) || /^(ANTHROPIC|OPENAI|GEMINI|GOOGLE|OPENROUTER|LITELLM|ELEVENLABS|GROQ|MISTRAL|COHERE|XAI|TOGETHER|DEEPSEEK)_/i.test(name) && /KEY|TOKEN/i.test(name);

/** Delete every credential variable from `env`; returns the names removed. */
export function stripSecretEnv(env: Record<string, string | undefined>): string[] {
  const removed = Object.keys(env).filter(isSecretEnvName);
  for (const k of removed) delete env[k];
  return removed;
}

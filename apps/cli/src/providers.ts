import { LLMProviderType } from "@reactive-agents/llm-provider";

/** A provider name the CLI accepts: every framework provider except `custom`, plus `test`. */
export type Provider = Exclude<(typeof LLMProviderType.literals)[number], "custom"> | "test";

/**
 * Providers the CLI accepts, derived from `LLMProviderType` the same way the
 * runtime's `ProviderNameSchema` is, so a provider added to the framework is
 * accepted by every command without editing a copy here. Hand-written copies
 * drifted: `rax serve` rejected groq and xai.
 */
export const VALID_PROVIDERS: readonly Provider[] = [
  ...LLMProviderType.literals.filter((p): p is Exclude<typeof p, "custom"> => p !== "custom"),
  "test",
];

/** Narrow a user-supplied string to a {@link Provider}. */
export function isValidProvider(value: string): value is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

/** Help-text rendering of the provider list, joined by `separator`. */
export function providerList(separator: string): string {
  return VALID_PROVIDERS.join(separator);
}

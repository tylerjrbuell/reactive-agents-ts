import type { Redactor } from "./redactor.js";

/**
 * Default secret patterns covering common API keys, JWTs, and cloud tokens.
 *
 * Ordering is intentional: longer / more-specific patterns appear first so
 * partial matches by shorter overlapping patterns (e.g. `sk-...` matching the
 * tail of `sk-ant-api...`) don't fire. If you add a new pattern, verify its
 * ordering vs the existing entries.
 *
 * Sources: OWASP secret-detection rule set, GitHub PAT format docs,
 * Anthropic / OpenAI / Google / AWS public token format docs.
 */
export const defaultRedactors: readonly Redactor[] = [
  {
    name: "anthropic-key",
    pattern: /sk-ant-api\d+-[A-Za-z0-9\-_]{80,}/g,
    replacement: "[redacted-anthropic-key]",
  },
  {
    name: "openai-project",
    pattern: /sk-proj-[A-Za-z0-9]{40,}/g,
    replacement: "[redacted-openai-key]",
  },
  {
    name: "openai-legacy",
    pattern: /sk-[A-Za-z0-9]{40,}/g,
    replacement: "[redacted-openai-key]",
  },
  {
    name: "github-pat",
    pattern: /ghp_[A-Za-z0-9]{36,}/g,
    replacement: "[redacted-github-token]",
  },
  {
    name: "github-actions",
    pattern: /ghs_[A-Za-z0-9]{36,}/g,
    replacement: "[redacted-github-token]",
  },
  {
    name: "jwt",
    pattern: /eyJ[A-Za-z0-9+/=_-]+\.eyJ[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+/g,
    replacement: "[redacted-jwt]",
  },
  {
    name: "aws-access",
    pattern: /AKIA[A-Z0-9]{16}/g,
    replacement: "[redacted-aws-access-key]",
  },
  {
    name: "google-api",
    pattern: /AIza[A-Za-z0-9\-_]{35}/g,
    replacement: "[redacted-google-api-key]",
  },
];

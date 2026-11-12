import type { Redactor } from "./redactor.js";

/**
 * Default secret patterns covering common API keys, JWTs, cloud tokens, PEM
 * private keys, Basic auth and `password=` style assignments.
 *
 * Ordering is intentional: longer / more-specific patterns appear first so
 * partial matches by shorter overlapping patterns (e.g. `sk-...` matching the
 * tail of `sk-ant-api...` or `sk-proj-...`) don't fire. Generic assignment and
 * header shapes run last so key-specific labels win. If you add a new pattern,
 * verify its ordering vs the existing entries.
 *
 * ReDoS-safe: every quantifier is a single bounded or linear character-class
 * run; no nested quantifiers, no overlapping alternations, PEM bodies bounded.
 *
 * This is the canonical set: logger, OTel exporter and trace redaction all
 * consume it.
 *
 * Sources: OWASP secret-detection rule set, GitHub PAT format docs,
 * Anthropic / OpenAI / Google / AWS / Slack / Stripe public token format docs.
 */
export const defaultRedactors: readonly Redactor[] = [
  {
    name: "pem-private-key",
    pattern: /-----BEGIN [A-Z ]{0,24}PRIVATE KEY-----[\s\S]{0,16384}?-----END [A-Z ]{0,24}PRIVATE KEY-----/g,
    replacement: "[redacted-private-key]",
  },
  {
    name: "anthropic-key",
    pattern: /sk-ant-api\d+-[A-Za-z0-9\-_]{80,}/g,
    replacement: "[redacted-anthropic-key]",
  },
  {
    // Project keys contain `-` and `_`; match whole, before the legacy rule.
    name: "openai-project",
    pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g,
    replacement: "[redacted-openai-key]",
  },
  {
    name: "openrouter-key",
    pattern: /sk-or-[A-Za-z0-9_-]{20,}/g,
    replacement: "[redacted-openrouter-key]",
  },
  {
    name: "openai-legacy",
    pattern: /sk-[A-Za-z0-9]{40,}/g,
    replacement: "[redacted-openai-key]",
  },
  {
    name: "github-fine-grained-pat",
    pattern: /github_pat_[A-Za-z0-9_]{22,}/g,
    replacement: "[redacted-github-token]",
  },
  {
    // ghp_ (PAT), gho_ (OAuth), ghs_ (Actions/app), ghu_ (user), ghr_ (refresh).
    name: "github-token",
    pattern: /gh[opsur]_[A-Za-z0-9]{30,}/g,
    replacement: "[redacted-github-token]",
  },
  {
    name: "slack-token",
    pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g,
    replacement: "[redacted-slack-token]",
  },
  {
    name: "stripe-key",
    pattern: /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
    replacement: "[redacted-stripe-key]",
  },
  {
    name: "groq-key",
    pattern: /(?<![A-Za-z0-9])gsk_[A-Za-z0-9]{20,}/g,
    replacement: "[redacted-groq-key]",
  },
  {
    name: "xai-key",
    pattern: /(?<![A-Za-z0-9])xai-[A-Za-z0-9]{20,}/g,
    replacement: "[redacted-xai-key]",
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
  {
    // Bearer tokens in Authorization headers / serialized tool args.
    name: "bearer-token",
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]{8,}=*/g,
    replacement: "Bearer [redacted]",
  },
  {
    // `Basic <base64>`. The lookahead demands a digit, `+/=`, or a lower->UPPER
    // transition so ordinary prose ("Basic understanding") is left alone.
    name: "basic-auth",
    pattern: /(?<![A-Za-z0-9])Basic\s{1,8}(?=[A-Za-z0-9+/]{0,512}(?:[0-9+/=]|[a-z][A-Z]))[A-Za-z0-9+/]{8,}={0,2}/g,
    replacement: "Basic [redacted]",
  },
  {
    // `password=...`, `GITHUB_TOKEN=...`, `secret='...'`. Also matches the
    // JSON-escaped `\"value\"` form seen inside serialized strings.
    name: "secret-assignment",
    pattern: /(?<![A-Za-z0-9])(password|passwd|secret|token)=\\?["']?[^\s&"'\\,;]{1,256}/gi,
    replacement: "$1=[redacted]",
  },
];

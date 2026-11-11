/** Display cap for a run's error line (characters). */
const MAX_CHARS = 280;

/** Credential-shaped substrings that must never reach the screen. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s]+/gi,
];

/**
 * One display line for a failed run's error (`AgentCompleted.error`, a chat turn's
 * outcome): the first non-blank line, credential-shaped tokens redacted, capped.
 * `undefined` for anything that is not a non-blank string.
 */
export function runErrorLine(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let line = raw.split("\n").find((l) => l.trim() !== "")?.trim();
  if (!line) return undefined;
  for (const re of SECRET_PATTERNS) {
    // A captured group is the label to keep (`Bearer`, `?key=`); without one the whole match goes.
    line = line.replace(re, (_match, label: unknown) =>
      typeof label !== "string" ? "[redacted]" : label.endsWith("=") ? `${label}[redacted]` : `${label} [redacted]`,
    );
  }
  return line.length > MAX_CHARS ? `${line.slice(0, MAX_CHARS - 1)}…` : line;
}

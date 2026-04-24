import { Effect } from "effect";

/**
 * A single redactor: a named regex pattern + replacement string.
 *
 * Patterns apply in order; later redactors operate on the result of earlier
 * ones, so place longer/more-specific patterns first to avoid partial matches
 * by shorter overlapping ones (e.g. `sk-ant-api*` must run before `sk-*`).
 *
 * @property name        Stable identifier surfaced in telemetry; must be
 *                       kebab-case and unique within a redactor list.
 * @property pattern     Global regex. Non-global patterns will only redact
 *                       the first match and should be avoided.
 * @property replacement Literal string substituted for each match.
 *                       Conventionally `[redacted-<kind>]`.
 */
export interface Redactor {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * Apply a sequence of `Redactor`s to an input string.
 *
 * Returns an Effect resolving to the redacted string. Redactors run in the
 * order provided; order matters (see {@link Redactor.pattern}).
 */
export const applyRedactors = (
  input: string,
  redactors: readonly Redactor[],
): Effect.Effect<string> =>
  Effect.sync(() => {
    let output = input;
    for (const r of redactors) {
      if (r.pattern.test(output)) {
        // Reset regex state for subsequent `.test` / `.replace` calls when
        // the pattern has the global flag.
        r.pattern.lastIndex = 0;
        output = output.replace(r.pattern, r.replacement);
      }
    }
    return output;
  });

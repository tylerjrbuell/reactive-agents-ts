// packages/testing/src/gate/scenarios/cf-11-redactor-strips-secrets.ts
//
// Targeted weakness: S0.3 (secrets leak through StructuredLogger).
// Closing commits: f95c8ac1 (redactor module) + d42a1f78 (logger wiring).
//
// Regression triggered when: the StructuredLogger's redaction path stops
// stripping secrets from log message OR string-valued metadata fields.
// Asserts directly against `makeStructuredLogger({ redactors })` — the
// component-level wiring is what matters; runtime composition is verified
// by the existing structured-logger-redaction.test.ts unit tests.

import { Effect } from "effect";
import { makeStructuredLogger } from "@reactive-agents/observability";
import { defaultRedactors } from "@reactive-agents/observability";
import type { ScenarioModule } from "../types.js";

const SECRET = "ghp_abc123def456ghi789jkl012mno345pqr678stu";

export const scenario: ScenarioModule = {
  id: "cf-11-redactor-strips-secrets",
  targetedWeakness: "S0.3",
  closingCommit: "d42a1f78",
  description:
    "Confirms StructuredLogger applies defaultRedactors before persisting log entries: secret in message → [redacted-github-token]; secret in metadata field → redacted in metadata. Regressing this re-opens the secret-leak path closed by S0.3 part 2.",
  config: {
    name: "cf-11-redactor-strips-secrets",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    // Build a one-off StructuredLogger and exercise both redaction paths
    // synchronously. Any divergence (missing import, wiring drift,
    // pattern weakening) causes a deterministic field flip in the
    // baseline diff.
    const logs = Effect.runSync(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger({ redactors: defaultRedactors });
        yield* logger.info(`token: ${SECRET}`);
        yield* logger.info("with meta", { token: SECRET, requestId: "req-7" });
        return yield* logger.getLogs();
      }),
    );

    const messageEntry = logs[0]!;
    const metaEntry = logs[1]!;
    const meta = (metaEntry.metadata ?? {}) as Record<string, unknown>;

    return {
      // Message-path assertions
      messageLeakedSecret: messageEntry.message.includes(SECRET),
      messageContainsRedactionTag: messageEntry.message.includes("[redacted-github-token]"),

      // Metadata-path assertions
      metaTokenLeakedSecret: meta.token === SECRET,
      metaTokenIsRedacted: meta.token === "[redacted-github-token]",
      metaRequestIdPreserved: meta.requestId === "req-7",
    };
  },
};

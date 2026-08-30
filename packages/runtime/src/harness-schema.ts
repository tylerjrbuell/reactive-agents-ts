/**
 * JSON-serialisable mirror of `HarnessConfig` (packages/reasoning). Kept in
 * runtime for the same reason `reasoning-options-schema.ts` is: the Effect
 * Schema row is the AgentConfig persistence contract, and reasoning must not
 * depend on runtime.
 *
 * Every field optional — absent means "do not decide", which is what lets
 * config beat the environment-variable layer beat the built-in default (see
 * `packages/reasoning/src/harness-config.ts` for the full precedence note).
 */
import { Schema } from "effect";

export const HarnessConfigSchema = Schema.Struct({
  lazyDisclosure: Schema.optional(Schema.Boolean),
  toolDiscovery: Schema.optional(Schema.Boolean),
  toolIndex: Schema.optional(Schema.Boolean),
  toolIndexMaxEntries: Schema.optional(Schema.Number),
  verboseRules: Schema.optional(Schema.Boolean),
  stableToolSurface: Schema.optional(Schema.Boolean),
  recencyBudgetChars: Schema.optional(Schema.Number),
  toolResultBudgetChars: Schema.optional(Schema.Number),
  thoughtContinuity: Schema.optional(Schema.Boolean),
  toolObserveSymmetry: Schema.optional(Schema.Boolean),
  auditRationale: Schema.optional(Schema.Boolean),
  treeOfThoughtExploreBudgetMs: Schema.optional(Schema.Number),
  assemblyDebug: Schema.optional(Schema.Boolean),
  promptDumpPathPrefix: Schema.optional(Schema.String),
});

export type HarnessConfigEncoded = typeof HarnessConfigSchema.Type;

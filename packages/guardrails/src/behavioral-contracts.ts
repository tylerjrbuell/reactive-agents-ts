import { Effect, Context, Layer, Schema } from "effect";

// ─── Behavioral Contract Schema ───

export const BehavioralContractSchema = Schema.Struct({
  /** Tools the agent is NOT allowed to call. */
  deniedTools: Schema.optional(Schema.Array(Schema.String)),
  /** If set, ONLY these tools may be called (allowlist). */
  allowedTools: Schema.optional(Schema.Array(Schema.String)),
  /** Maximum number of tool calls per execution. */
  maxToolCalls: Schema.optional(Schema.Number),
  /** Maximum iterations before forced halt. */
  maxIterations: Schema.optional(Schema.Number),
  /** Maximum output length in characters. */
  maxOutputLength: Schema.optional(Schema.Number),
  /** Topics the agent must not address. */
  deniedTopics: Schema.optional(Schema.Array(Schema.String)),
  /** If true, agent must disclose it is an AI. */
  requireDisclosure: Schema.optional(Schema.Boolean),
});
export type BehavioralContract = typeof BehavioralContractSchema.Type;

// ─── Violation Types ───

export interface ContractViolation {
  readonly rule: string;
  readonly message: string;
  readonly severity: "warning" | "block";
}

// ─── Service ───

export class BehavioralContractService extends Context.Tag("BehavioralContractService")<
  BehavioralContractService,
  {
    /** Check if a tool call is allowed by the contract. */
    readonly checkToolCall: (toolName: string, toolCallCount: number) => Effect.Effect<ContractViolation | null>;
    /** Check if output complies with the contract. */
    readonly checkOutput: (output: string) => Effect.Effect<ContractViolation | null>;
    /** Check iteration count against contract. */
    readonly checkIteration: (iteration: number) => Effect.Effect<ContractViolation | null>;
    /** Get the active contract. */
    readonly getContract: () => Effect.Effect<BehavioralContract>;
  }
>() {}

export const BehavioralContractServiceLive = (contract: BehavioralContract) =>
  Layer.succeed(BehavioralContractService, {
    checkToolCall: (toolName, toolCallCount) =>
      Effect.sync(() => {
        // Check denied tools
        if (contract.deniedTools?.some((d) => d.toLowerCase() === toolName.toLowerCase())) {
          return {
            rule: "denied-tool",
            message: `Tool "${toolName}" is not allowed by behavioral contract`,
            severity: "block" as const,
          };
        }

        // Check allowed tools (allowlist)
        if (contract.allowedTools && !contract.allowedTools.some((a) => a.toLowerCase() === toolName.toLowerCase())) {
          return {
            rule: "tool-not-in-allowlist",
            message: `Tool "${toolName}" is not in the allowed tools list`,
            severity: "block" as const,
          };
        }

        // Check max tool calls
        if (contract.maxToolCalls != null && toolCallCount >= contract.maxToolCalls) {
          return {
            rule: "max-tool-calls",
            message: `Tool call limit reached (${contract.maxToolCalls})`,
            severity: "block" as const,
          };
        }

        return null;
      }),

    checkOutput: (output) =>
      Effect.sync(() => {
        // Check max output length
        if (contract.maxOutputLength != null && output.length > contract.maxOutputLength) {
          return {
            rule: "max-output-length",
            message: `Output exceeds maximum length (${output.length} > ${contract.maxOutputLength})`,
            severity: "block" as const,
          };
        }

        // Check denied topics
        if (contract.deniedTopics) {
          const lower = output.toLowerCase();
          for (const topic of contract.deniedTopics) {
            if (lower.includes(topic.toLowerCase())) {
              return {
                rule: "denied-topic",
                message: `Output references denied topic: "${topic}"`,
                severity: "block" as const,
              };
            }
          }
        }

        return null;
      }),

    checkIteration: (iteration) =>
      Effect.sync(() => {
        if (contract.maxIterations != null && iteration > contract.maxIterations) {
          return {
            rule: "max-iterations",
            message: `Iteration ${iteration} exceeds contract limit of ${contract.maxIterations}`,
            severity: "block" as const,
          };
        }
        return null;
      }),

    getContract: () => Effect.succeed(contract),
  });

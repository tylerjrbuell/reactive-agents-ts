/**
 * Schema-enforced structured output for Anthropic via a forced tool call.
 *
 * The installed `@anthropic-ai/sdk` (0.30.x) has no native structured-output
 * request parameter, so `completeStructured()` enforces the target JSON Schema
 * the way every current Claude model supports: one tool whose `input_schema`
 * IS the target schema, plus `tool_choice: { type: "tool", name }` so the model
 * must call it. The tool input is the structured object.
 *
 * Anthropic rejects a forced `tool_choice` together with extended thinking, so
 * the adapter uses this path only when thinking is off for the call (see
 * `completeStructured` in `./anthropic.ts`).
 */
import { normalizeToolSchema } from "../schema-utils.js";

/** Name of the single forced tool that carries the structured answer. */
export const ANTHROPIC_STRUCTURED_TOOL_NAME = "structured_output";

/** An Anthropic tool definition for the forced structured-output call. */
export type AnthropicStructuredTool = {
  readonly tool: {
    readonly name: string;
    readonly description: string;
    readonly input_schema: Record<string, unknown>;
  };
  /**
   * True when the target schema's root is not an object. Anthropic tool input
   * must be an object, so the target travels as the required `value` property
   * and is unwrapped from the tool input.
   */
  readonly wrapped: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const DEFS_PREFIX = "#/$defs/";

/**
 * Make a JSON Schema (as produced by Effect's `JSONSchema.make`) usable as an
 * Anthropic tool `input_schema`, deterministically:
 * - drop the `$schema` dialect marker;
 * - inline a root `$ref` into its `$defs` entry (Class and suspended schemas
 *   come out as `{ $ref, $defs }`), keeping `$defs` at the root so nested refs
 *   still resolve;
 * - wrap a non-object root as `{ value: <schema> }`, hoisting `$defs` to the new
 *   root for the same reason;
 * - then apply the shared tool-schema normalizer used by every adapter.
 */
export const toAnthropicStructuredTool = (jsonSchema: unknown): AnthropicStructuredTool => {
  const source: Record<string, unknown> = isRecord(jsonSchema) ? { ...jsonSchema } : {};
  delete source.$schema;
  const defs = isRecord(source.$defs) ? source.$defs : undefined;

  let root: Record<string, unknown> = source;
  const ref = source.$ref;
  if (typeof ref === "string" && ref.startsWith(DEFS_PREFIX) && defs !== undefined) {
    const target = defs[ref.slice(DEFS_PREFIX.length)];
    if (isRecord(target)) root = { ...target, $defs: defs };
  }

  const wrapped = root.type !== "object";
  if (wrapped) {
    const { $defs: _hoisted, ...inner } = root;
    root = {
      type: "object",
      properties: { value: inner },
      required: ["value"],
      ...(defs !== undefined ? { $defs: defs } : {}),
    };
  }

  return {
    tool: {
      name: ANTHROPIC_STRUCTURED_TOOL_NAME,
      description:
        "Return your answer by calling this tool. The tool input is the answer and must match this schema exactly.",
      input_schema: normalizeToolSchema(root).schema as Record<string, unknown>,
    },
    wrapped,
  };
};

/** Request body fields that force exactly one call to the structured tool. */
export const anthropicStructuredToolFields = (structured: AnthropicStructuredTool) => ({
  tools: [structured.tool],
  tool_choice: { type: "tool" as const, name: structured.tool.name },
});

/** Final user turn for the forced path; keeps the conversation ending on a user turn. */
export const ANTHROPIC_STRUCTURED_INSTRUCTION = `Call the ${ANTHROPIC_STRUCTURED_TOOL_NAME} tool with your answer.`;

/** Repair turn for a forced-path attempt whose tool input failed the schema. */
export const anthropicStructuredRepair = (lastError: unknown): string =>
  `That ${ANTHROPIC_STRUCTURED_TOOL_NAME} input did not match the schema. Error: ${String(lastError)}. Call ${ANTHROPIC_STRUCTURED_TOOL_NAME} again with corrected input.`;

/**
 * The structured tool's input from a raw Messages response, as a JSON string
 * (unwrapped from `value` when the schema was wrapped), or `undefined` when the
 * response has no call to the structured tool (for example a `max_tokens` stop
 * before the call finished). The caller then parses whatever text it has, so
 * the miss surfaces through the shared parse-retry loop as `LLMParseError`.
 */
export const structuredToolInputJson = (
  content: readonly unknown[],
  wrapped: boolean,
): string | undefined => {
  const call = content.find(
    (block): block is { readonly input: unknown } =>
      isRecord(block) &&
      block.type === "tool_use" &&
      block.name === ANTHROPIC_STRUCTURED_TOOL_NAME &&
      "input" in block,
  );
  if (call === undefined) return undefined;
  if (!wrapped) return JSON.stringify(call.input);
  return isRecord(call.input) && "value" in call.input
    ? JSON.stringify(call.input.value)
    : undefined;
};

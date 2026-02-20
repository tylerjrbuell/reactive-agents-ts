import { Effect } from "effect";
import type { PromptTemplate, PromptVariable } from "../types/template.js";
import { VariableError } from "../errors/errors.js";

export const interpolate = (
  template: PromptTemplate,
  variables: Record<string, unknown>,
): Effect.Effect<string, VariableError> =>
  Effect.gen(function* () {
    // Validate required variables
    for (const v of template.variables) {
      if (v.required && !(v.name in variables) && v.defaultValue === undefined) {
        return yield* Effect.fail(
          new VariableError({
            templateId: template.id,
            variableName: v.name,
            message: "Required variable missing",
          }),
        );
      }
    }

    let content = template.template;

    // Interpolate provided variables
    for (const [key, value] of Object.entries(variables)) {
      content = content.replaceAll(`{{${key}}}`, String(value));
    }

    // Fill defaults for missing optional variables
    for (const v of template.variables) {
      if (!v.required && !(v.name in variables) && v.defaultValue !== undefined) {
        content = content.replaceAll(`{{${v.name}}}`, String(v.defaultValue));
      }
    }

    return content;
  });

export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 4);

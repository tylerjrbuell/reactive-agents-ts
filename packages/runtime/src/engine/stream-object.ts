/**
 * streamObjectFrom — streaming structured output helper (Task 3.2).
 *
 * Consumes an `AsyncIterable<AgentStreamEvent>` (from `agent.runStream()`),
 * accumulates `TextDelta` text into a buffer, and on each delta emits a
 * `DeepPartial<A>` built by `parsePartial(stripThinking(buffer))`.
 *
 * Deduplication: only yields when the parsed object JSON changes to avoid
 * high-frequency noise for identical partials.
 *
 * At stream end (`StreamCompleted` or exhaustion):
 *   - Validates the final buffer via `contract.validate(...)`.
 *   - If valid → yields final `{ object }` with the full validated value.
 *   - If invalid and `onParseFail === "degrade"` → yields the last best-effort partial.
 *   - If invalid and `onParseFail === "throw"` → throws `StructuredOutputError`.
 */
import { parsePartial, stripThinking } from "@reactive-agents/reasoning";
import type { SchemaContract } from "@reactive-agents/reasoning";
import type { AgentStreamEvent } from "../stream-types.js";
import { StructuredOutputError } from "../errors/structured-output-error.js";
import type { DeepPartial } from "../builder/types.js";

export async function* streamObjectFrom<A>(
    stream: AsyncIterable<AgentStreamEvent>,
    contract: SchemaContract<A>,
    onParseFail: "degrade" | "throw",
): AsyncGenerator<{ object: DeepPartial<A> }> {
    let buffer = "";
    let lastEmittedJson = "";
    let lastPartial: DeepPartial<A> = {} as DeepPartial<A>;
    let finalValidated: A | undefined = undefined;
    let sawCompleted = false;

    for await (const event of stream) {
        if (event._tag === "TextDelta") {
            buffer += event.text;
            const stripped = stripThinking(buffer);
            const partial = parsePartial(stripped) as DeepPartial<A>;
            const json = JSON.stringify(partial);
            if (json !== lastEmittedJson) {
                lastEmittedJson = json;
                lastPartial = partial;
                yield { object: partial };
            }
        } else if (event._tag === "StreamCompleted") {
            sawCompleted = true;
            // Attempt final validation on the full accumulated buffer.
            const stripped = stripThinking(buffer);
            const parsed = parsePartial(stripped);
            const result = contract.validate(parsed);
            if (result.ok) {
                finalValidated = result.value;
            }
        } else if (event._tag === "StreamError" || event._tag === "StreamCancelled") {
            // Stream terminated abnormally — surface what we have as a degrade.
            sawCompleted = true;
        }
    }

    if (!sawCompleted) {
        // Generator exhausted without a StreamCompleted (shouldn't happen, but be safe).
        const stripped = stripThinking(buffer);
        const parsed = parsePartial(stripped);
        const result = contract.validate(parsed);
        if (result.ok) {
            finalValidated = result.value;
        }
    }

    if (finalValidated !== undefined) {
        // Yield final validated object (may or may not differ from last partial).
        const finalJson = JSON.stringify(finalValidated);
        if (finalJson !== lastEmittedJson) {
            yield { object: finalValidated as DeepPartial<A> };
        }
        // If we already emitted the same content as the validated result, no extra emit needed.
    } else {
        // Validation failed.
        if (onParseFail === "throw") {
            const stripped = stripThinking(buffer);
            const parsed = parsePartial(stripped);
            const result = contract.validate(parsed);
            const issues = result.ok ? [] : result.issues.map((i) => i.message);
            throw new StructuredOutputError({ rawText: buffer, issues });
        }
        // degrade: the caller already received the last best-effort partial via the loop.
        // If nothing was yielded at all (empty buffer / no deltas), emit the empty partial.
        if (lastEmittedJson === "") {
            yield { object: lastPartial };
        }
    }
}

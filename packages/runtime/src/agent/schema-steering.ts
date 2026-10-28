import type { SchemaContract } from '@reactive-agents/reasoning'

/**
 * Build the "respond ONLY with JSON matching this schema" suffix from the
 * schema contract. Returns `""` when the contract has no JSON schema.
 *
 * Used by both `streamObject` (to steer streaming) and `buildRunTaskEffect`
 * (to steer the run() task so the agent emits JSON that parse-first can read).
 */
export function buildSchemaSteering(contract: SchemaContract<unknown>): string {
    const jsonSchema = contract.toJsonSchema()
    const jsonSchemaString = jsonSchema !== undefined
        ? JSON.stringify(jsonSchema, null, 2)
        : undefined
    const schemaBlock = jsonSchemaString !== undefined
        ? `\n\n${jsonSchemaString}`
        : ""
    // Shape-aware: a top-level array schema must be steered to emit a JSON array,
    // not an object — otherwise the model wraps it (e.g. {items:[...]}) and
    // validation/parse-first fails.
    const isArray = (jsonSchema as { type?: unknown } | undefined)?.type === "array"
    return isArray
        ? (
            `\n\nRespond with ONLY a JSON array that exactly matches this JSON Schema` +
            ` — no prose, no markdown fences, no explanation, no wrapping object:${schemaBlock}`
        )
        : (
            `\n\nRespond with ONLY a single JSON object that exactly matches this JSON Schema` +
            ` — no prose, no markdown fences, no explanation.` +
            ` Use exactly these top-level keys; do not nest or wrap:${schemaBlock}`
        )
}

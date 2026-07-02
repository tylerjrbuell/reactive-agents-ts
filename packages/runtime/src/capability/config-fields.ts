/**
 * Derives a flat descriptor list from AgentConfigSchema using Effect's JSONSchema
 * generator, flattening nested objects into dotted paths. SINGLE SOURCE: whatever
 * the schema declares, the manifest reports — so a new config field surfaces in
 * Cortex automatically. The manifest test asserts key top-level fields appear.
 *
 * AgentConfigSchema's JSONSchema output is fully inline (no $defs), optional
 * fields are encoded by omission from a struct's `required` array, and nested
 * structs appear as inline `{ type: "object", properties, required }` — so the
 * flatten below needs no $ref resolution.
 */
import { JSONSchema } from "effect";
import { AgentConfigSchema } from "../agent-config.js";

export interface ConfigFieldDescriptor {
  /** Dotted path, e.g. "execution.maxIterations". */
  readonly path: string;
  readonly type: "string" | "number" | "boolean" | "enum" | "object" | "array" | "unknown";
  readonly enumValues?: string[];
  readonly optional: boolean;
  readonly description?: string;
}

interface JsonNode {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonNode>;
  required?: string[];
  description?: string;
  items?: JsonNode;
}

function classify(node: JsonNode): ConfigFieldDescriptor["type"] {
  if (node.enum && node.enum.length > 0) return "enum";
  const t = Array.isArray(node.type) ? node.type.find((x) => x !== "null") : node.type;
  if (t === "string" || t === "number" || t === "boolean") return t;
  if (t === "integer") return "number";
  if (t === "object") return "object";
  if (t === "array") return "array";
  return "unknown";
}

function flatten(node: JsonNode, prefix: string, out: ConfigFieldDescriptor[]): void {
  const props = node.properties;
  if (!props) return;
  const required = new Set(node.required ?? []);
  for (const [key, child] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const isObjectWithProps =
      child.properties && Object.keys(child.properties).length > 0 && !child.enum;
    if (isObjectWithProps) {
      flatten(child, path, out);
    } else {
      out.push({
        path,
        type: classify(child),
        ...(child.enum
          ? { enumValues: child.enum.filter((v): v is string => typeof v === "string") }
          : {}),
        optional: !required.has(key),
        ...(child.description ? { description: child.description } : {}),
      });
    }
  }
}

export function deriveConfigFields(): ConfigFieldDescriptor[] {
  const js = JSONSchema.make(AgentConfigSchema) as unknown as JsonNode;
  const out: ConfigFieldDescriptor[] = [];
  flatten(js, "", out);
  return out;
}

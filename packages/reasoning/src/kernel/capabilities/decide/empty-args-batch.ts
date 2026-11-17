/**
 * decide/empty-args-batch.ts — a turn whose every tool call has empty arguments.
 *
 * A model that emits `shell-execute {}` and `todo {}` in one turn, then
 * `shell-execute {}` again, is not choosing wrongly among valid calls: it sent
 * calls that cannot run (trace 01M7MXP263N44MPM6B85D2H4JZ). Executing each one
 * returns a per-call "missing parameter" error and costs a turn per repeat.
 * When EVERY call in the batch has no arguments although its tool's schema
 * requires some, the gate (`gateTurnToolCalls`) refuses the whole batch as a
 * model fault instead: each call is answered in the thread ("not run: no
 * arguments") and ONE corrective guidance names each tool, its required
 * parameters and an example call (`errorRecovery`, the existing channel kind).
 *
 * A batch with even one non-empty call, or a call whose tool has no required
 * parameter (or is unknown to the surface), is not this fault and runs as usual.
 * Pure and deterministic: schemas in, refusals and one text out.
 */
import type { ToolCallSpec } from "@reactive-agents/tools";
import type { ToolParamSchema, ToolSchema } from "../attend/tool-formatting.js";
import type { GateRefusal } from "./tool-gating.js";

/** A required parameter with no default: the arguments cannot be empty without it. */
const mustSupply = (p: ToolParamSchema): boolean => p.required === true && p.default === undefined;

/** A placeholder value for one required parameter, by declared type. */
function exampleValue(p: ToolParamSchema): unknown {
  if (p.enum !== undefined && p.enum.length > 0) return p.enum[0];
  if (p.type === "string") return `<${p.name}>`;
  if (p.type === "number") return 1;
  if (p.type === "boolean") return true;
  if (p.type === "array") return [];
  return {};
}

/** `tool({"p":"<p>"})`, built from the tool's required parameters. */
export function exampleCallOf(schema: ToolSchema): string {
  const args = Object.fromEntries(schema.parameters.filter(mustSupply).map((p) => [p.name, exampleValue(p)]));
  return `${schema.name}(${JSON.stringify(args)})`;
}

/** The required parameter names of a tool, in declared order. */
const requiredNames = (schema: ToolSchema): string => schema.parameters.filter(mustSupply).map((p) => p.name).join(", ");

/**
 * Refusals for every call of the turn when ALL of them are empty-argument calls
 * to tools that require arguments; none otherwise. `schemas` is the run's tool
 * surface (the full catalog and the offered set).
 */
export function emptyArgsRefusals(
  schemas: readonly ToolSchema[],
  calls: readonly ToolCallSpec[],
): readonly GateRefusal<ToolCallSpec>[] {
  if (calls.length === 0) return [];
  const byName = new Map(schemas.map((s) => [s.name, s] as const));
  const refusals: GateRefusal<ToolCallSpec>[] = [];
  for (const call of calls) {
    const schema = byName.get(call.name);
    const empty = call.arguments === undefined || Object.keys(call.arguments).length === 0;
    if (!empty || schema === undefined || !schema.parameters.some(mustSupply)) return [];
    refusals.push({ call, kind: "empty-args", reason: `it had no arguments (required: ${requiredNames(schema)}).` });
  }
  return refusals;
}

/**
 * The one corrective line for a batch refused as empty-argument calls: one
 * clause per distinct tool. `undefined` when no refusal is of that kind.
 */
export function emptyArgsGuidance(
  refused: readonly GateRefusal<ToolCallSpec>[],
  schemas: readonly ToolSchema[],
): string | undefined {
  const names = [...new Set(refused.filter((r) => r.kind === "empty-args").map((r) => r.call.name))];
  if (names.length === 0) return undefined;
  const byName = new Map(schemas.map((s) => [s.name, s] as const));
  const clauses = names.flatMap((n) => {
    const s = byName.get(n);
    return s === undefined ? [] : [`call ${n} with ${requiredNames(s)}, e.g. ${exampleCallOf(s)}`];
  });
  return `Your last calls had no arguments, so none ran: ${clauses.join("; ")}.`;
}

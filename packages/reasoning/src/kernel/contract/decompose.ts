// File: src/kernel/contract/decompose.ts
//
// Optional LLM-assisted requirement decomposition for the RunContract compiler.
//
// The deterministic core (run-contract.ts::compileRunContract) is the FLOOR and
// always stands alone. This module only ADDS requirements — the judge's
// requirement-decomposition pattern, finally given a schema — and is gated
// exactly like the existing capability-gated classifiers: it runs only when the
// caller opts in AND the provider advertises structured-output support. Any
// failure (no capability, gateway error, unparseable output) degrades to an
// empty add, never to a weaker contract.

import type { ProviderCapabilities } from "@reactive-agents/llm-provider";
import { Effect } from "effect";
import { extractJsonBlock } from "../../structured-output/json-repair.js";
import { extractThinkingSafeContent } from "../utils/stream-parser.js";
import { gatewayComplete } from "../llm-gateway.js";
import { outputContains, type PostCondition } from "../capabilities/verify/post-conditions.js";
import type { RequirementKind, TaskRequirement } from "./run-contract.js";

// The LLMService method surface the gateway needs — imported by value at the
// call site (runner) and passed in, so this module has no service dependency of
// its own and the deterministic floor never depends on it.
type GatewayLLM = Parameters<typeof gatewayComplete>[0];

export interface DecomposeOptions {
  /** Opt-in switch — decomposition is OFF unless the caller sets this true. */
  readonly enableLlmDecomposition?: boolean;
  /** Provider capabilities — decomposition needs native structured output. */
  readonly capabilities?: ProviderCapabilities;
}

/**
 * Pure gate predicate — the SAME shape as the requiredTools classifier gate:
 * opt-in AND capability-advertised. Exported so the floor invariant ("LLM path
 * off ⇒ floor only") is testable without a model call.
 */
export function shouldDecompose(opts: DecomposeOptions): boolean {
  return opts.enableLlmDecomposition === true && opts.capabilities?.supportsStructuredOutput === true;
}

const DECOMPOSE_SYSTEM =
  "You are a task-requirement decomposer. Given a task, list the discrete, " +
  "independently-verifiable requirements that must ALL be satisfied for the task " +
  "to count as complete. Respond with ONLY a JSON array; each element is " +
  '{"id": string, "kind": "question-answered"|"artifact-produced"|"constraint-held"|"tool-coverage", ' +
  '"description": string, "weight": number}. No prose, no code fences.';

const VALID_KINDS: ReadonlySet<string> = new Set<RequirementKind>([
  "question-answered",
  "artifact-produced",
  "constraint-held",
  "tool-coverage",
]);

interface RawRequirement {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly description?: unknown;
  readonly weight?: unknown;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Parse + validate the model's JSON into typed TaskRequirements. Lossy-safe. */
function parseRequirements(text: string): readonly TaskRequirement[] {
  const block = extractJsonBlock(text) ?? text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: TaskRequirement[] = [];
  const seen = new Set<string>();
  for (const item of parsed as unknown[]) {
    if (!isRecord(item)) continue;
    const raw = item as RawRequirement;
    const kind = typeof raw.kind === "string" ? raw.kind : "";
    if (!VALID_KINDS.has(kind)) continue;
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    if (description.length === 0) continue;
    const baseId = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : description.slice(0, 40);
    const id = `llm:${baseId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const weight = typeof raw.weight === "number" && Number.isFinite(raw.weight) ? raw.weight : 1;
    // LLM requirements are checker-tier by default (no deterministic ledger
    // condition), except when a substring "must include" is explicit enough to
    // graft onto OutputContains — kept conservative to avoid false-DONE.
    const condition: PostCondition | undefined = undefined;
    out.push({
      id,
      kind: kind as RequirementKind,
      spec: { description, condition, acceptance: "checker" },
      weight,
    });
  }
  return out;
}

// Reference the graftable constructor so a future precise OutputContains graft
// has an import anchor; keeps the deterministic-vs-LLM boundary explicit.
void outputContains;

/**
 * Decompose the task into additional requirements via the LLM. Capability-gated;
 * returns [] when the gate is closed or anything fails. NEVER throws — the
 * contract compiler treats the result as an additive layer over the floor.
 */
export function decomposeRequirements(
  llm: GatewayLLM,
  task: string,
  opts: DecomposeOptions,
): Effect.Effect<readonly TaskRequirement[], never> {
  if (!shouldDecompose(opts)) return Effect.succeed([]);
  return gatewayComplete(llm, { purpose: "classify" }, {
    messages: [{ role: "user", content: task }],
    systemPrompt: DECOMPOSE_SYSTEM,
    temperature: 0.1,
  }).pipe(
    Effect.map((response) => parseRequirements(extractThinkingSafeContent(response).content)),
    Effect.catchAll(() => Effect.succeed([] as readonly TaskRequirement[])),
  );
}

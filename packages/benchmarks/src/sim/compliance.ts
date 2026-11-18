/**
 * Phase Z: guidance and compliance. A harness mechanism changes the REQUEST: a
 * guidance line in the system prompt, a forced `toolChoice`. Whether a model
 * follows it is the one thing a scripted tier cannot know (it needs a live
 * model), so the policy asks {@link obeys}: guided requests are followed with
 * probability `compliance`. Firing the guidance is deterministic; following it is
 * the parameter the sweep varies.
 */
import type { CompletionRequest } from "@reactive-agents/llm-provider";
import type { Rng } from "./policy-model.js";

/** Substrings of system-prompt lines the harness adds to steer the model. */
const GUIDANCE_LINES: readonly { readonly name: string; readonly marker: RegExp }[] = [
  { name: "parallel-tool-hint", marker: /issue all tool calls in the same response/i },
  { name: "guidance-section", marker: /\bGuidance:/ },
];

/** Names of the steering signals present on this request (empty = unguided). */
export function guidanceOf(req: CompletionRequest): readonly string[] {
  const names = GUIDANCE_LINES.filter((g) => g.marker.test(req.systemPrompt ?? "")).map((g) => g.name);
  if (req.toolChoice === "required") names.push("forced-call");
  return names;
}

/**
 * Signals that count as steering when no name is asked for. The parallel-tool
 * hint line is NOT one of them: the mid-tier base prompt already carries that
 * sentence on every turn, so it only means "the hint fired" when a shape runs on
 * the local tier and asks for it by name.
 */
const GENERIC_STEERING: ReadonlySet<string> = new Set(["guidance-section", "forced-call"]);

/** True when the request carries the named steering signal (or any generic one when unnamed). */
export function isGuided(req: CompletionRequest, name?: string): boolean {
  const names = guidanceOf(req);
  return name === undefined ? names.some((n) => GENERIC_STEERING.has(n)) : names.includes(name);
}

/**
 * Does the model follow the guidance on this request? Always draws exactly one
 * number, so two arms with the same seed share their random stream (paired
 * comparison). Unguided requests never obey (the model acts naively).
 */
export function obeys(req: CompletionRequest, rng: Rng, compliance: number, name?: string): boolean {
  const u = rng();
  return isGuided(req, name) && u < compliance;
}

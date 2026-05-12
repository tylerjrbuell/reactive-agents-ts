/**
 * Module-level helper functions used by builder.ts and the runtime
 * agent. Pure functions with no closure dependencies on the builder
 * class.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Effect, type Context } from 'effect'
import type { TerminatedBy } from '@reactive-agents/core'
import type { AgentPersona } from './types.js'

/**
 * Resolve a Context.Tag from the surrounding Effect runtime, returning the
 * service typed as its declared interface (rather than `unknown`).
 *
 * Use at gateway/builder boundary call sites that previously did
 * `yield* SomeService as any` because the dep interface only knows the
 * service as `unknown`. The returned Effect requires the service in its R
 * channel exactly the same way `yield* tag` does, so type erasure is local
 * to the consumer — the surrounding runtime contract is unchanged.
 *
 * @example
 * ```ts
 * const gw = yield* yieldService(GatewayService)
 * yield* gw.processEvent(event) // typed
 * ```
 */
export const yieldService = <I, S>(
    tag: Context.Tag<I, S>
): Effect.Effect<S, never, I> =>
    Effect.gen(function* () {
        return yield* tag
    })

/**
 * Resolve the default tracing config (Sprint 3.6).
 *
 * Tracing is **on by default** so `rax diagnose <runId>` always has a JSONL
 * file to inspect. Users disable explicitly via `.withoutTracing()` on the
 * builder or `REACTIVE_AGENTS_TRACE=off` in the env (the env switch covers
 * CI, container, or one-off scripted runs that shouldn't write to disk).
 *
 * Default location is `~/.reactive-agents/traces` so multiple agents in the
 * same workspace don't pollute the project directory.
 */
export function defaultTracingConfig(): { dir: string } | null {
  const envFlag = (process.env.REACTIVE_AGENTS_TRACE ?? "").toLowerCase()
  if (envFlag === "off" || envFlag === "false" || envFlag === "0") return null
  const customDir = process.env.REACTIVE_AGENTS_TRACE_DIR
  if (customDir && customDir.length > 0) return { dir: customDir }
  return { dir: join(homedir(), ".reactive-agents", "traces") }
}

/**
 * Derive the `goalAchieved` signal from the kernel's `terminatedBy` value.
 *
 * See {@link AgentResult.goalAchieved} for semantics.
 */
export function deriveGoalAchieved(terminatedBy: TerminatedBy | undefined): boolean | null {
    switch (terminatedBy) {
        case "final_answer_tool":
        case "final_answer":
            return true
        case "max_iterations":
        case "llm_error":
            return false
        case "end_turn":
        case undefined:
            return null
    }
}

// ─── Persona Composition Helper ───────────────────────────────────────────────

/**
 * Compose an AgentPersona into a structured system prompt.
 *
 * Builds a multi-section prompt with Role, Background, Instructions, and Tone (if provided).
 * Empty sections are omitted. This is used internally during agent build to merge persona
 * configuration with explicit system prompts.
 *
 * @param persona - The agent persona to compose
 * @param agentName - Name of the agent (for logging/reference, not included in output)
 * @returns A formatted system prompt string with persona sections
 */
export function composePersonaToSystemPrompt(
    persona: AgentPersona,
    agentName: string
): string {
    const sections: string[] = []

    // Role (required-ish for personas, but we'll include if set)
    if (persona.role) {
        sections.push(`Role: ${persona.role}`)
    }

    // Background
    if (persona.background) {
        sections.push(`Background: ${persona.background}`)
    }

    // Instructions
    if (persona.instructions) {
        sections.push(`Instructions: ${persona.instructions}`)
    }

    // Tone
    if (persona.tone) {
        sections.push(`Tone: ${persona.tone}`)
    }

    return sections.join('\n\n')
}

/**
 * Compose a final sub-agent system prompt by merging an optional persona
 * with an optional explicit `systemPrompt`.
 *
 * Wraps the duplicated pattern previously inlined at:
 *   - `builder.ts` (root agent factory)
 *   - `builder/build-effect/local-agent-tools.ts` (local sub-agent registration)
 *   - `builder/build-effect/sub-agent-executor.ts` (dynamic sub-agent executor)
 *
 * Semantics (preserved exactly from the 3 prior call sites):
 *   - No persona → return `systemPrompt` unchanged (may be `undefined`).
 *   - Persona + systemPrompt → `${personaPrompt}\n\n${systemPrompt}`.
 *   - Persona only → return the composed persona prompt alone.
 *
 * @param persona - Optional persona to compose; if absent, the system prompt is returned as-is.
 * @param systemPrompt - Optional explicit system prompt to append after the persona section.
 * @param agentName - Agent name forwarded to `composePersonaToSystemPrompt` (for logging/reference).
 */
export function buildSubAgentSystemPrompt(
    persona: AgentPersona | undefined,
    systemPrompt: string | undefined,
    agentName: string
): string | undefined {
    if (!persona) return systemPrompt
    const personaPrompt = composePersonaToSystemPrompt(persona, agentName)
    return systemPrompt
        ? `${personaPrompt}\n\n${systemPrompt}`
        : personaPrompt
}

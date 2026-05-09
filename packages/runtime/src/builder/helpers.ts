/**
 * Module-level helper functions used by builder.ts and the runtime
 * agent. Pure functions with no closure dependencies on the builder
 * class.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TerminatedBy } from '@reactive-agents/core'
import type { AgentPersona } from './types.js'

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

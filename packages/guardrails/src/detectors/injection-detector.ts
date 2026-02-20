import { Effect } from "effect";
import type { ViolationType, Severity } from "../types.js";

export interface DetectionResult {
  readonly detected: boolean;
  readonly type: ViolationType;
  readonly severity: Severity;
  readonly message: string;
  readonly details?: string;
}

// Common prompt injection patterns
const INJECTION_PATTERNS: Array<{ pattern: RegExp; severity: Severity; description: string }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+(instructions|prompts)/i, severity: "critical", description: "Instruction override attempt" },
  { pattern: /disregard\s+(all\s+)?previous/i, severity: "critical", description: "Instruction disregard attempt" },
  { pattern: /forget\s+(all\s+)?(your\s+)?previous/i, severity: "high", description: "Memory reset attempt" },
  { pattern: /you\s+are\s+now\s+a/i, severity: "high", description: "Role reassignment attempt" },
  { pattern: /act\s+as\s+(if\s+)?(you\s+are|a)\s/i, severity: "medium", description: "Role play injection" },
  { pattern: /system\s*:\s*you\s+are/i, severity: "critical", description: "System prompt injection" },
  { pattern: /\[SYSTEM\]/i, severity: "high", description: "System tag injection" },
  { pattern: /\<\/?system\>/i, severity: "high", description: "System XML tag injection" },
  { pattern: /do\s+not\s+follow\s+(your\s+)?(rules|guidelines)/i, severity: "critical", description: "Rule override attempt" },
  { pattern: /pretend\s+(that\s+)?you\s+(don't|do\s+not)\s+have/i, severity: "high", description: "Capability override attempt" },
  { pattern: /\bDAN\b.*\bmode\b/i, severity: "critical", description: "DAN jailbreak attempt" },
  { pattern: /jailbreak/i, severity: "critical", description: "Explicit jailbreak reference" },
];

export const detectInjection = (text: string): Effect.Effect<DetectionResult, never> =>
  Effect.sync(() => {
    for (const { pattern, severity, description } of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        return {
          detected: true,
          type: "prompt-injection" as ViolationType,
          severity,
          message: `Prompt injection detected: ${description}`,
          details: `Matched pattern: ${pattern.source}`,
        };
      }
    }
    return {
      detected: false,
      type: "prompt-injection" as ViolationType,
      severity: "low" as Severity,
      message: "No injection detected",
    };
  });

import { Effect } from "effect";
import type { ViolationType, Severity } from "../types.js";
import type { DetectionResult } from "./injection-detector.js";

// Toxicity keyword categories (simplified blocklist)
const TOXIC_PATTERNS: Array<{ pattern: RegExp; category: string; severity: Severity }> = [
  { pattern: /\b(kill|murder|assassinate)\s+(yourself|himself|herself|themselves|someone|people)\b/i, severity: "critical", category: "violence" },
  { pattern: /\bhow\s+to\s+(make|build|create)\s+(a\s+)?(bomb|weapon|explosive)/i, severity: "critical", category: "weapons" },
  { pattern: /\b(hack|exploit|breach)\s+(into|a|the)\s/i, severity: "high", category: "hacking" },
  { pattern: /\b(steal|rob|burglarize)\s/i, severity: "high", category: "theft" },
  { pattern: /\b(hate|despise)\s+(all\s+)?(women|men|blacks|whites|jews|muslims|christians)/i, severity: "critical", category: "hate-speech" },
  { pattern: /\b(racial|ethnic)\s+(slur|epithet)/i, severity: "critical", category: "hate-speech" },
  { pattern: /\bself[- ]?harm\b/i, severity: "critical", category: "self-harm" },
  { pattern: /\bsuicide\s+(method|how|way)/i, severity: "critical", category: "self-harm" },
];

export const detectToxicity = (
  text: string,
  customBlocklist: readonly string[] = [],
): Effect.Effect<DetectionResult, never> =>
  Effect.sync(() => {
    // Check built-in patterns
    for (const { pattern, category, severity } of TOXIC_PATTERNS) {
      if (pattern.test(text)) {
        return {
          detected: true,
          type: "toxicity" as ViolationType,
          severity,
          message: `Toxic content detected: ${category}`,
          details: `Category: ${category}`,
        };
      }
    }

    // Check custom blocklist
    const lower = text.toLowerCase();
    for (const word of customBlocklist) {
      if (lower.includes(word.toLowerCase())) {
        return {
          detected: true,
          type: "toxicity" as ViolationType,
          severity: "high" as Severity,
          message: `Blocked term detected: "${word}"`,
          details: `Custom blocklist match`,
        };
      }
    }

    return {
      detected: false,
      type: "toxicity" as ViolationType,
      severity: "low" as Severity,
      message: "No toxic content detected",
    };
  });

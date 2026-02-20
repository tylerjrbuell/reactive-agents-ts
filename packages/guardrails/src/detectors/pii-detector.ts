import { Effect } from "effect";
import type { ViolationType, Severity } from "../types.js";
import type { DetectionResult } from "./injection-detector.js";

// PII patterns
const PII_PATTERNS: Array<{ pattern: RegExp; label: string; severity: Severity }> = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, label: "SSN", severity: "critical" },
  { pattern: /\b\d{9}\b/, label: "SSN (no dashes)", severity: "high" },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, label: "Email", severity: "medium" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, label: "Credit card", severity: "critical" },
  { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, label: "Phone number", severity: "medium" },
  { pattern: /\b\d{1,5}\s\w+\s(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/i, label: "Street address", severity: "high" },
  { pattern: /\b[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}\b/, label: "UK postcode", severity: "medium" },
  { pattern: /\bpassword\s*[:=]\s*\S+/i, label: "Password", severity: "critical" },
  { pattern: /\b(sk-|sk_live_|pk_live_|sk_test_)\S{20,}/i, label: "API key", severity: "critical" },
];

export const detectPii = (text: string): Effect.Effect<DetectionResult, never> =>
  Effect.sync(() => {
    const found: string[] = [];
    let maxSeverity: Severity = "low";
    const severityOrder: Severity[] = ["low", "medium", "high", "critical"];

    for (const { pattern, label, severity } of PII_PATTERNS) {
      if (pattern.test(text)) {
        found.push(label);
        if (severityOrder.indexOf(severity) > severityOrder.indexOf(maxSeverity)) {
          maxSeverity = severity;
        }
      }
    }

    if (found.length > 0) {
      return {
        detected: true,
        type: "pii-detected" as ViolationType,
        severity: maxSeverity,
        message: `PII detected: ${found.join(", ")}`,
        details: `Found ${found.length} PII pattern(s)`,
      };
    }

    return {
      detected: false,
      type: "pii-detected" as ViolationType,
      severity: "low" as Severity,
      message: "No PII detected",
    };
  });

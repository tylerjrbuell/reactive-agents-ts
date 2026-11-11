import { Effect } from "effect";
import { maxSeverity as severityMax, type ViolationType, type Severity } from "../types.js";
import type { DetectionResult } from "./injection-detector.js";

/** Luhn checksum over the digits of `candidate` (separators ignored). */
const passesLuhn = (candidate: string): boolean => {
  const digits = candidate.replace(/\D/g, "");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
};

/**
 * One PII rule. Patterns carry the `g` flag and are run via `matchAll`, so no
 * `lastIndex` state leaks between calls. `validate`, when present, must accept
 * at least one match for the rule to fire.
 */
type PiiPattern = {
  readonly pattern: RegExp;
  readonly label: string;
  readonly severity: Severity;
  readonly validate?: (match: string) => boolean;
};

// PII patterns
const PII_PATTERNS: ReadonlyArray<PiiPattern> = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, label: "SSN", severity: "critical" },
  // A bare 9-digit run is an order id, a count, a routing number as often as an
  // SSN; require SSN wording nearby so ordinary numbers do not trip the rule.
  {
    pattern: /\b(?:ssn|social\s+security(?:\s+(?:number|no\.?|#))?)\b\D{0,20}?\b\d{9}\b/gi,
    label: "SSN (no dashes)",
    severity: "high",
  },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, label: "Email", severity: "medium" },
  // 16-digit cards (4-4-4-4) and Amex (34/37, 4-6-5); a Luhn check rejects
  // arbitrary digit runs of the same shape.
  {
    pattern: /\b(?:\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}|3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5})\b/g,
    label: "Credit card",
    severity: "critical",
    validate: passesLuhn,
  },
  { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, label: "Phone number", severity: "medium" },
  // International (E.164-style) numbers: "+" country code then 7-13 more digits.
  { pattern: /(?<![\w+])\+\d{1,3}(?:[\s.-]?\d){7,13}\b/g, label: "Phone number", severity: "medium" },
  { pattern: /\b\d{1,5}\s\w+\s(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/gi, label: "Street address", severity: "high" },
  // Outward code may end in a letter (SW1A, EC1A, W1A).
  { pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, label: "UK postcode", severity: "medium" },
  { pattern: /\bpassword\s*[:=]\s*\S+/gi, label: "Password", severity: "critical" },
  { pattern: /\b(sk-|sk_live_|pk_live_|sk_test_)\S{20,}/gi, label: "API key", severity: "critical" },
];

const ruleFires = (p: PiiPattern, text: string): boolean => {
  for (const m of text.matchAll(p.pattern)) {
    if (!p.validate || p.validate(m[0])) return true;
  }
  return false;
};

export const detectPii = (text: string): Effect.Effect<DetectionResult, never> =>
  Effect.sync(() => {
    const found: string[] = [];
    let severity: Severity = "low";

    for (const p of PII_PATTERNS) {
      if (ruleFires(p, text) && !found.includes(p.label)) {
        found.push(p.label);
        severity = severityMax(severity, p.severity);
      }
    }

    if (found.length > 0) {
      return {
        detected: true,
        type: "pii-detected" as ViolationType,
        severity,
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

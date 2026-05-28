// Deterministic verifier for Mastra vs RA benchmark. No LLM-as-judge yet — added in v2 if needed.

import type { TaskVerifier } from "./tasks.js";

export interface VerificationResult {
  readonly passed: boolean;
  readonly reason: string;
}

export function verify(output: string, v: TaskVerifier): VerificationResult {
  const text = (output ?? "").toString();
  const lower = text.toLowerCase();

  switch (v.kind) {
    case "contains-any": {
      const matched = v.substrings.find((s) => lower.includes(s.toLowerCase()));
      return matched !== undefined
        ? { passed: true, reason: `matched "${matched}"` }
        : { passed: false, reason: `none of ${JSON.stringify(v.substrings)} found in output` };
    }
    case "contains-all": {
      const missing = v.substrings.filter((s) => !lower.includes(s.toLowerCase()));
      return missing.length === 0
        ? { passed: true, reason: "all substrings present" }
        : { passed: false, reason: `missing: ${JSON.stringify(missing)}` };
    }
    case "regex": {
      const re = new RegExp(v.pattern, v.flags ?? "");
      return re.test(text)
        ? { passed: true, reason: `matched /${v.pattern}/${v.flags ?? ""}` }
        : { passed: false, reason: `regex /${v.pattern}/ did not match` };
    }
    case "long-form": {
      if (text.length < v.minLength) {
        return { passed: false, reason: `output length ${text.length} < ${v.minLength}` };
      }
      const missing = v.mustContain.filter((s) => !lower.includes(s.toLowerCase()));
      return missing.length === 0
        ? { passed: true, reason: `length ${text.length} ok, all keywords present` }
        : { passed: false, reason: `length ok but missing keywords: ${JSON.stringify(missing)}` };
    }
    case "llm-judge":
      // Not implemented in v1 — would call a small judge model with the rubric.
      // Default to "no decision" (failing) so we don't false-positive.
      return { passed: false, reason: "llm-judge verifier not yet implemented" };
  }
}

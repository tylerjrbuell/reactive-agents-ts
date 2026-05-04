// Output Leak Detection Library
//
// Detects patterns that indicate sensitive information leaks:
// - System prompts (instructions, rules, constraints)
// - API keys (OpenAI sk-proj-, Anthropic sk-ant-, AWS AKIA)
// - Credentials (passwords, JWT tokens, GitHub tokens, etc.)
// - Connection strings (database URLs with credentials)
// - Internal instructions
//
// Uses pattern matching with regex and semantic heuristics.

interface LeakPattern {
  type: "system-prompt" | "api-key" | "credential" | "internal-instruction";
  severity: "critical" | "high" | "medium";
  match: string;
  position: number;
  context: string;
}

interface LeakDetectionResult {
  output: string;
  leaksDetected: LeakPattern[];
  hasLeak: boolean;
  detectionLatencyMs: number;
  outputType: "text" | "json" | "markdown";
  metadata: {
    outputLength: number;
    patternsMatched: string[];
  };
}

// ── Pattern definitions ────────────────────────────────────────────────────

interface PatternDef {
  name: string;
  type: LeakPattern["type"];
  severity: LeakPattern["severity"];
  regex: RegExp;
}

const LEAK_PATTERNS: PatternDef[] = [
  // ── API Keys ───────────────────────────────────────────────────────────
  {
    name: "openai-api-key",
    type: "api-key",
    severity: "critical",
    regex: /sk-proj-[a-zA-Z0-9\-_]{20,}/gi,
  },
  {
    name: "anthropic-api-key",
    type: "api-key",
    severity: "critical",
    regex: /sk-ant-[a-zA-Z0-9\-_]{20,}/gi,
  },
  {
    name: "generic-bearer-token",
    type: "api-key",
    severity: "high",
    regex: /Bearer\s+[a-zA-Z0-9\-_.~+/]+=*/gi,
  },

  // ── AWS Credentials ────────────────────────────────────────────────────
  {
    name: "aws-access-key",
    type: "credential",
    severity: "critical",
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: "aws-secret-key",
    type: "credential",
    severity: "critical",
    regex: /aws_secret_access_key\s*[:=]\s*[^\s,}]*/gi,
  },

  // ── JWT Tokens ─────────────────────────────────────────────────────────
  {
    name: "jwt-token",
    type: "credential",
    severity: "high",
    regex: /eyJ[a-zA-Z0-9\-_=]+\.eyJ[a-zA-Z0-9\-_=]+\.?[a-zA-Z0-9\-_.=]*/g,
  },

  // ── GitHub Tokens ─────────────────────────────────────────────────────
  {
    name: "github-personal-token",
    type: "credential",
    severity: "critical",
    regex: /ghp_[a-zA-Z0-9]{36,}/g,
  },
  {
    name: "github-oauth-token",
    type: "credential",
    severity: "critical",
    regex: /gho_[a-zA-Z0-9]{36,}/g,
  },
  {
    name: "github-app-token",
    type: "credential",
    severity: "critical",
    regex: /ghu_[a-zA-Z0-9]{36,}/g,
  },

  // ── Database Connection Strings ────────────────────────────────────────
  {
    name: "database-password",
    type: "credential",
    severity: "high",
    regex: /(postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s,}]*/gi,
  },
  {
    name: "connection-string-password",
    type: "credential",
    severity: "high",
    regex: /password\s*[:=]\s*[^\s,;}]+/gi,
  },

  // ── System Prompts & Instructions ──────────────────────────────────────
  {
    name: "system-prompt-header",
    type: "system-prompt",
    severity: "high",
    regex: /\[?SYSTEM\s+PROMPT\s+LEAKED\]?[\s:]*/gi,
  },
  {
    name: "system-instructions-header",
    type: "internal-instruction",
    severity: "high",
    regex: /\[?SYSTEM\s+INSTRUCTIONS?\s*\]?[\s:]*/gi,
  },
  {
    name: "internal-instruction-header",
    type: "internal-instruction",
    severity: "medium",
    regex: /\[?INTERNAL[\s:]/gi,
  },
  {
    name: "you-are-an-ai",
    type: "system-prompt",
    severity: "high",
    regex: /you\s+are\s+an?\s+(ai|assistant|language\s+model)/gi,
  },

  // ── Password patterns ──────────────────────────────────────────────────
  {
    name: "explicit-password",
    type: "credential",
    severity: "high",
    regex: /password\s*[:=]\s*["\']?([^"\'\s,}]+)["\']?/gi,
  },
  {
    name: "api-key-generic",
    type: "api-key",
    severity: "medium",
    regex: /api[_-]?key\s*[:=]\s*[^\s,}]+/gi,
  },
  {
    name: "secret-key-generic",
    type: "credential",
    severity: "high",
    regex: /secret[_-]?key\s*[:=]\s*[^\s,}]+/gi,
  },
  {
    name: "slack-webhook",
    type: "api-key",
    severity: "high",
    regex: /https?:\/\/hooks\.slack\.com\/services\/[^\s,}]+/g,
  },
];

// ── False positive filters ─────────────────────────────────────────────────
// These patterns should NOT be flagged as leaks

function isFalsePositive(match: string): boolean {
  // Base64 content (common in legitimate outputs)
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(match.trim())) {
    return true; // Likely base64, not a secret
  }

  // Common hash digests (SHA256, MD5, etc.)
  if (/^[a-fA-F0-9]{32,}$/.test(match.trim())) {
    return true; // Likely a hash digest
  }

  // UUID patterns (false positives for JWT detection)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match.trim())) {
    return true; // UUID, not JWT
  }

  return false;
}

// ── Contextual extraction ──────────────────────────────────────────────────

function extractContext(text: string, position: number, contextLength: number = 50): string {
  const start = Math.max(0, position - contextLength);
  const end = Math.min(text.length, position + contextLength);
  return text.substring(start, end).replace(/\n/g, " ").trim();
}

// ── Main leak detector ─────────────────────────────────────────────────────

export async function detectLeaks(
  output: string,
  outputType: "text" | "json" | "markdown",
): Promise<LeakDetectionResult> {
  const startTime = performance.now();
  const leaksDetected: LeakPattern[] = [];
  const patternsMatched: Set<string> = new Set();

  // Detect leaks using pattern matching
  for (const patternDef of LEAK_PATTERNS) {
    const regex = new RegExp(patternDef.regex.source, patternDef.regex.flags);
    let match;

    while ((match = regex.exec(output)) !== null) {
      const matchText = match[0];

      // Skip false positives
      if (isFalsePositive(matchText)) {
        continue;
      }

      patternsMatched.add(patternDef.name);

      leaksDetected.push({
        type: patternDef.type,
        severity: patternDef.severity,
        match: matchText,
        position: match.index,
        context: extractContext(output, match.index),
      });
    }
  }

  // Deduplicate by position (keep highest severity)
  const uniqueLeaks = new Map<number, LeakPattern>();
  for (const leak of leaksDetected) {
    const existing = uniqueLeaks.get(leak.position);
    if (!existing || severityValue(leak.severity) > severityValue(existing.severity)) {
      uniqueLeaks.set(leak.position, leak);
    }
  }

  const finalLeaks = Array.from(uniqueLeaks.values());
  const detectionLatencyMs = performance.now() - startTime;

  return {
    output,
    leaksDetected: finalLeaks,
    hasLeak: finalLeaks.length > 0,
    detectionLatencyMs,
    outputType,
    metadata: {
      outputLength: output.length,
      patternsMatched: Array.from(patternsMatched),
    },
  };
}

// ── Helper function for severity comparison ────────────────────────────────

function severityValue(severity: "critical" | "high" | "medium"): number {
  return { critical: 3, high: 2, medium: 1 }[severity];
}

export type { LeakDetectionResult, LeakPattern };

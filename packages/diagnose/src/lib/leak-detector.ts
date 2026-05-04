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
  {
    name: "secretAccessKey",
    type: "credential",
    severity: "critical",
    // Match both JSON ("secretAccessKey": "value") and config (secretAccessKey=value) formats
    regex: /secretAccessKey["\']?\s*[:=]\s*["\']?([a-zA-Z0-9\/+\-_]{20,})["\']?/gi,
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
    regex: /(postgres|postgresql|mysql|mongodb|redis):\/\/[^:@]+:[^@]+@[^\s,}]*/gi,
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
    regex: /you\s+are\s+an?\s+(ai|assistant|language\s+model|helpful)/gi,
  },
  {
    name: "system-prompt-in-json-key",
    type: "system-prompt",
    severity: "high",
    regex: /"systemPrompt"\s*:\s*"[^"]*assistant[^"]*"/gi,
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
  {
    name: "aws-session-token",
    type: "credential",
    severity: "critical",
    regex: /aws_session_token\s*[:=]\s*[^\s,}]+/gi,
  },
  {
    name: "authorization-header-sensitive",
    type: "credential",
    severity: "high",
    regex: /authorization\s*:\s*(?!Bearer\s+\w{1,10}\s)(?!Basic\s+\w{1,10})[^\s\n,}]+/gi,
  },
];

// ── False positive filters ─────────────────────────────────────────────────
// These patterns should NOT be flagged as leaks
//
// IMPORTANT: Order matters. Check for specific secret patterns BEFORE generic filters
// (e.g., AKIA keys BEFORE base64 filter, since AKIA keys can match base64 regex).

function isFalsePositive(match: string): boolean {
  const trimmed = match.trim();

  // CRITICAL: AWS access keys (AKIA...) are NOT false positives
  // They look like base64 but are always real credentials
  if (/^AKIA[0-9A-Z]{16}$/i.test(trimmed)) {
    return false; // Real AWS key, not base64
  }

  // Base64 content (common in legitimate outputs)
  // Only consider it base64 if it has base64-specific characters (+ / or padding =)
  // or if it's clearly NOT a secret pattern
  if (/[+/=]/.test(trimmed)) {
    if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(trimmed)) {
      return true; // Likely base64, not a secret
    }
  }

  // Common hash digests (SHA256, MD5, etc.)
  // Only hex characters, no uppercase letters except A-F
  if (/^[a-fA-F0-9]{32,}$/.test(trimmed)) {
    return true; // Likely a hash digest
  }

  // UUID patterns (false positives for JWT detection)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
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

/**
 * Act phase — the recovery hint appended to a failed tool_result.
 *
 * A tool error is one of the few channels that reaches the model's context, so
 * the hint must be right or absent. Two rules (census of 501 runs, 2026-11-10):
 * a hint never stacks on an error that already teaches the fix, and the
 * missing-path hint fires only on a missing path, never on any "not found".
 *
 * Moved out of `tool-execution.ts` (which re-exports `getRecoveryHint`) to keep
 * that file under the 1,000-LOC new-giant bar.
 */

/** The recovery tool a failed file path points at, when the agent has it. */
const LIST_DIRECTORY_TOOL = "list-directory";

// NOTE on where the toolbox comes from. `toolService.listTools()` is the
// REGISTRY, not the model's toolbox: built-ins are registered but withheld from
// the LLM schema unless opted in via `withTools({builtins})`. Keying the hint
// off the registry reproduced the very bug it was meant to fix — `list-directory`
// was registered, absent from the schema, named in the hint, and the model
// looped on "Tool call used unavailable name(s)". The exposed schema
// (`ctx.schemas` in tool-observe) is the only honest source, so callers pass it.

/**
 * Phrases a tool error uses when it already names the fix. Such an error gets
 * no generic hint: a second, vaguer instruction stacked on a precise one is
 * noise a small model may obey instead (census of 501 runs, 2026-11-10).
 * Matched against the lower-cased message.
 */
const TEACHING_PHRASES: readonly string[] = [
  "closest valid call",
  // The tools package's missing-parameter error: `Valid call: tool({...})`.
  "valid call:",
  "allowed commands",
  "valid:",
  "did you mean",
  "read the file first",
];

/** "use <tool-name>" — a hyphen/underscore-joined name, the shape of every tool id. */
const USE_TOOL_PATTERN = /\buse [a-z0-9]+(?:[-_][a-z0-9]+)+\b/;

/** True when the error text already tells the model what to do next. */
function errorAlreadyTeaches(msg: string): boolean {
  return TEACHING_PHRASES.some((p) => msg.includes(p)) || USE_TOOL_PATTERN.test(msg);
}

/**
 * A missing PATH, not any "not found". file-edit reports "'oldText' was not
 * found in <file>" when the file exists and the edit text does not match;
 * keying on the bare substring sent that model to list-directory.
 */
function isMissingPathError(msg: string): boolean {
  return msg.includes("enoent") || msg.includes("no such file") || msg.includes("file not found");
}

const FILE_PATH_TOOLS: ReadonlySet<string> = new Set(["file-read", "file-write", "file-edit"]);

/**
 * Map common tool error patterns to actionable recovery hints.
 * Helps the LLM understand what went wrong and how to fix it.
 *
 * Exported for the runtime's inline agent loop (2026-07-11): the inline path
 * executes tools outside the kernel act phase and returned bare errnos —
 * probe p4 showed a model hardcoding an exchange rate after a hint-less
 * ENOENT while list-directory sat exposed and unnamed.
 *
 * @param toolName - The tool whose call failed.
 * @param errorMsg - The tool's error text, as the model will see it.
 * @param exposedTools - Names the model may actually call (the EXPOSED schema, not the registry).
 * @returns A hint prefixed with " → ", or "" when no hint helps.
 */
export function getRecoveryHint(
  toolName: string,
  errorMsg: string,
  /** Names the model may actually call — the EXPOSED schema, not the registry. */
  exposedTools?: ReadonlySet<string>,
): string {
  const msg = errorMsg.toLowerCase();

  // The tool already said how to recover; add nothing.
  if (errorAlreadyTeaches(msg)) return "";

  // File not found. "Verify the file exists" was advice the model could not
  // act on: there was no way to look. Point at the tool that can — but ONLY if
  // the agent actually has it.
  //
  // Naming an absent tool is worse than saying nothing. Measured 2026-07-09:
  // an unconditional hint sent claude-haiku-4-5 chasing `list-directory` when
  // the toolbox held only file-read/file-write. It retried until
  // max_iterations, output "Tool call used unavailable name(s)", and wrote
  // nothing. The old vague hint at least did not send it anywhere.
  if (FILE_PATH_TOOLS.has(toolName)) {
    if (isMissingPathError(msg)) {
      // Absent `exposedTools` ⇒ we cannot prove the tool is callable ⇒ do not
      // name it. Silence beats sending the model after a tool it does not have.
      return exposedTools?.has(LIST_DIRECTORY_TOOL) === true
        ? ` → Call ${LIST_DIRECTORY_TOOL}({"path": "."}) to see what actually exists, then use the real path. Do not guess again.`
        : " → No file exists at that path, relative to the working root named above. Re-read the task for the correct path; the same path will fail again.";
    }
    // A file tool's other "not found" (edit text absent from an existing file)
    // is not a missing path: fall through to the remaining checks.
  } else if (isMissingPathError(msg) || msg.includes("not found")) {
    return " → The requested resource was not found.";
  }

  // Permission errors
  if (msg.includes("eacces") || msg.includes("permission denied") || msg.includes("forbidden") || msg.includes("403")) {
    return " → Permission denied. You may not have access to this resource.";
  }

  // Timeout errors
  if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("timed out") || msg.includes("econnaborted")) {
    if (toolName === "web-search" || toolName === "http-get") {
      return " → Request timed out. Try a more specific query or a different URL.";
    }
    return " → Operation timed out. Try again or simplify the request.";
  }

  // Network errors
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network") || msg.includes("dns")) {
    return " → Network error. The service may be unreachable.";
  }

  // Rate limits
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return " → Rate limited. Wait before retrying or try a different approach.";
  }

  // Invalid arguments / validation
  if (msg.includes("invalid") || msg.includes("validation") || msg.includes("schema") || msg.includes("required")) {
    return " → Check argument format. Review the expected parameters above.";
  }

  // JSON parse errors in the call's ARGUMENTS only. A tool that rejects the
  // JSON a model put inside an argument (file-write refusing invalid .json
  // content) already says how to fix it; "malformed arguments" contradicted it.
  if (msg.includes("json") && msg.includes("argument") && (msg.includes("parse") || msg.includes("syntax") || msg.includes("unexpected"))) {
    return " → Malformed JSON in arguments. Ensure valid JSON syntax.";
  }

  // Code execution errors
  if (toolName === "code-execute") {
    if (msg.includes("syntax")) return " → Fix the syntax error in your code.";
    if (msg.includes("reference") || msg.includes("undefined")) return " → Check variable names and imports.";
    return " → Code execution failed. Review the error and fix the code.";
  }

  return "";
}

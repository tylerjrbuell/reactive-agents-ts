/**
 * Pure detector: does assistant text LOOK like an attempted tool call?
 *
 * Used at the tail of `NativeFCStrategy.extract()` — text that is call-shaped
 * but could not be resolved to a known tool must never become a `final_answer`
 * (it would terminate the run with raw call JSON as the "answer" and poison
 * chat history). Anchored on whole-content shape so prose that merely contains
 * an incidental brace, or a legitimate JSON answer such as `{"result":180}`,
 * is NOT shaped.
 */

/** Result of {@link detectToolCallShape}. */
export interface ToolCallShape {
  /** True when the content looks like a (failed) tool call. */
  readonly shaped: boolean
  /** Tool names the content tried to call, when recoverable (may be empty). */
  readonly names: readonly string[]
}

const NOT_SHAPED: ToolCallShape = { shaped: false, names: [] }

/** Dialect markers that are call-shaped on their own. */
const MARKER_RE =
  /\[TOOL_CALLS\]|<\|python_tag\|>|<function=|<\|?tool_call\|?>|<tool_use>|"tool_calls"\s*:/

const NAME_KEY_RE = /["'](?:name|tool|tool_name)["']\s*:\s*["']([^"']+)["']/g
const ARGS_KEY_RE = /["'](?:arguments|parameters|args)["']?\s*[:{]|\bparameters\s*\{/
const MARKER_NAME_RES: readonly RegExp[] = [
  /<function=([\w.:/-]+)/g,
  /call:\s*([\w.:/-]+)/g,
]
const BARE_CALL_RE = /^\s*([\w.-]+)\((.*)\)\s*;?\s*$/s

function unfence(content: string): string {
  const m = content.trim().match(/^```[\w-]*\s*\n?([\s\S]*?)```$/)
  return m ? m[1]!.trim() : content.trim()
}

function collect(re: RegExp, text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(re)) if (m[1]) out.push(m[1])
  return out
}

/**
 * Detect whether `content` is shaped like a tool call.
 *
 * Shaped when (whole content, a fenced block, or JSON following prose):
 *  - a `name`/`tool`/`tool_name` key paired with an `arguments`/`parameters`/`args`
 *    key, or whose value is a known tool name (so `{"name":"Alice"}` is not shaped);
 *  - a dialect marker (`[TOOL_CALLS]`, `<|python_tag|>`, `<function=`,
 *    `<tool_call>`, `{"tool_calls":`);
 *  - the sole line is a bare `identifier(...)` call (known name; or, unfenced, call-like args).
 *
 * @param content        raw assistant text
 * @param knownToolNames names of tools actually available this turn
 */
export function detectToolCallShape(
  content: string,
  knownToolNames: Iterable<string>,
): ToolCallShape {
  const text = unfence(content)
  if (text.length === 0) return NOT_SHAPED
  const known = new Set(knownToolNames)

  const names: string[] = [
    ...collect(NAME_KEY_RE, content),
    ...MARKER_NAME_RES.flatMap((re) => collect(re, content)),
  ]

  if (MARKER_RE.test(content)) return { shaped: true, names: [...new Set(names)] }

  // JSON-ish: must contain an object/array opener somewhere (JSON after prose).
  if (/[{[]/.test(text)) {
    const jsonNames = collect(NAME_KEY_RE, text)
    if (jsonNames.length > 0 && (ARGS_KEY_RE.test(text) || jsonNames.some((n) => known.has(n)))) {
      return { shaped: true, names: [...new Set(jsonNames)] }
    }
  }

  // Bare `identifier(...)` as the only line.
  if (!text.includes("\n")) {
    const m = text.match(BARE_CALL_RE)
    if (m) {
      const [, name, args] = m
      const fenced = text !== content.trim()
      // A fenced one-liner is far more likely a code answer: require a known name.
      if (known.has(name!) || (!fenced && /[=:"'`]/.test(args!))) {
        return { shaped: true, names: [name!] }
      }
    }
  }

  return NOT_SHAPED
}

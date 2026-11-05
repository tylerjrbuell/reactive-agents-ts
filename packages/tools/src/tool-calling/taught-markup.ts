/**
 * The TAUGHT text tool-call grammar (TextParseDriver.buildPromptInstructions):
 *
 *   <tool_use>
 *   tool: <tool-name>
 *   <param-name>: <value>
 *   </tool_use>
 *
 * One reader for both consumers — TextParseDriver.extractCalls (tier 1) and
 * the assistant-text parser's highest-fidelity tier. Values stay strings
 * (the taught grammar is `key: value` text; schema-aware type coercion is
 * the healer's job).
 */

/** One taught-grammar block. `start`/`end` index the source text. */
export interface TaughtCall {
  readonly name: string
  readonly args: Record<string, unknown>
  /** True for a `<tool_use>`/`<tool_call>`-wrapped block, false for a bare one. */
  readonly wrapped: boolean
  readonly start: number
  readonly end: number
}

/**
 * Wrapped first (highest fidelity): the taught `<tool_use>…</tool_use>` OR
 * the LEGACY `<tool_call>…</tool_call>` (back-compat for recorded fixtures /
 * models that learned the old prompt). If neither yields, the
 * wrapper-tolerant BARE form: the SAME `tool: <name>` + `<param>: <value>`
 * grammar minus the surrounding tags. The wrapper is tolerated; the grammar
 * is not loosened.
 */
export function parseTaughtBlocks(text: string): TaughtCall[] {
  const wrapped = parseWrappedBlocks(text)
  if (wrapped.length > 0) return wrapped
  return parseUnwrappedBlocks(text)
}

function parseWrappedBlocks(text: string): TaughtCall[] {
  // Accepts the new taught `<tool_use>` AND the legacy `<tool_call>` wrapper
  // (additive: teaching changed, parsing widened).
  const blockRe = /<(?:tool_use|tool_call)>([\s\S]*?)<\/(?:tool_use|tool_call)>/g
  const calls: TaughtCall[] = []
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(text)) !== null) {
    const block = match[1]!.trim()
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
    const toolLine = lines.find((l) => l.startsWith("tool:"))
    if (!toolLine) continue
    const name = toolLine.replace(/^tool:\s*/, "").trim()
    const args: Record<string, unknown> = {}
    for (const line of lines) {
      if (line.startsWith("tool:")) continue
      const colonIdx = line.indexOf(":")
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      args[key] = value
    }
    calls.push({ name, args, wrapped: true, start: match.index, end: match.index + match[0].length })
  }
  return calls
}

// ── Wrapper-tolerant tier-1: bare `tool:` param-line blocks ──────────────────
//
// W3c measured motivation (fixtures/post-w3): qwen2.5-coder:14b, routed
// text-parse by a MEASURED dialect-none prior, emits the taught tool/param
// lines but drops BOTH `<tool_call>` wrapper tags at temp 0. The wrapped-only
// tier parsed 0 calls (shadow would-have-executed 0/5; act 0/5 executed). These
// helpers accept the bare block: the SAME grammar the builder teaches, minus
// the wrapper. A block still MUST open with a `tool: <name>` line, so this is
// tolerant of the wrapper, not of the grammar (GH #243: no guessed format).

/** A taught tool line: `tool: <name>` - one name token, nothing else. */
const TOOL_LINE_RE = /^([ \t]*)tool:[ \t]*(\S+)[ \t]*$/
/**
 * A taught param line: `<key>: <value>` (identifier or `<placeholder>`),
 * optionally indented. Indentation is captured so it can be normalized and so a
 * block scalar can tell its continuations from a following param (indent
 * symmetry with the tool line - an indented block must find its params).
 */
const PARAM_LINE_RE = /^([ \t]*)(<[^>\s]+>|[A-Za-z_][\w.-]*)[ \t]*:[ \t]*(.*)$/
/** YAML block-scalar header: literal `|` or folded `>`, optional chomp `-`/`+`. */
const BLOCK_SCALAR_HEADER_RE = /^([|>])([+-]?)$/

/**
 * Scan `text` for BARE `tool: <name>` blocks (the taught grammar without the
 * `<tool_call>` wrapper) and extract one call per block.
 *
 * Tolerance is scoped BETWEEN blocks, not within a param list:
 *  - BETWEEN blocks: prose, `---` rules, code fences and a leading prose line
 *    are skipped; a block ends at a blank line, the next `tool:` opener, or the
 *    first non-param line.
 *  - WITHIN a block: a contiguous run of `<key>: <value>` params (indentation
 *    normalized, symmetric with the tool line) plus YAML block-scalar values
 *    (`|`, `>`, with `-`/`+` chomping).
 *  - A bare block MUST carry at least one param to be a call; a lone
 *    `tool: <name>` line in prose is NOT emitted, so it can never dispatch an
 *    empty-args call to a no-required-param tool.
 *
 * Deliberate truncation (NOT a silent in-list prose skipper): mid-param prose
 * ends the param list, so a later `content:` after an interleaved sentence is
 * dropped. Genuine in-list prose tolerance was rejected: real no-FC emissions
 * embed data-sample lines (`ProductA: 100`, `Product B: 1500`) in the prose
 * BETWEEN blocks (measured: post-w3 runs 01M4TYKSSY/01M4TYM336/01M4V2WYQF), so a
 * skip-until-next-opener would attach those as wrong args - a worse, harder to
 * detect corruption than a documented missing trailing param, which the
 * downstream required-param validation surfaces loudly.
 */
function parseUnwrappedBlocks(text: string): TaughtCall[] {
  const lines = text.split("\n")
  const offsets: number[] = []
  let acc = 0
  for (const line of lines) {
    offsets.push(acc)
    acc += line.length + 1
  }
  const calls: TaughtCall[] = []
  let i = 0
  while (i < lines.length) {
    const toolMatch = TOOL_LINE_RE.exec(lines[i]!)
    if (!toolMatch) {
      i++
      continue
    }
    const startLine = i
    const name = toolMatch[2]!
    i++
    const args: Record<string, unknown> = {}
    let paramCount = 0
    while (i < lines.length) {
      const raw = lines[i]!
      // A blank line, a fresh call, or any non-param line ends the block.
      if (raw.trim() === "") break
      if (TOOL_LINE_RE.test(raw)) break
      const paramMatch = PARAM_LINE_RE.exec(raw)
      if (!paramMatch) break
      const indent = paramMatch[1]!.length
      const key = paramMatch[2]!
      const value = paramMatch[3] ?? ""
      i++
      const header = BLOCK_SCALAR_HEADER_RE.exec(value.trim())
      if (header) {
        const scalar = readBlockScalar(lines, i, indent)
        args[key] = renderBlockScalar(
          scalar.body,
          scalar.trailingBlanks,
          header[1] as "|" | ">",
          (header[2] ?? "") as "" | "-" | "+",
        )
        i = scalar.next
      } else {
        args[key] = value
      }
      paramCount++
    }
    if (paramCount > 0) {
      const lastLine = i - 1
      calls.push({
        name,
        args,
        wrapped: false,
        start: offsets[startLine]!,
        end: offsets[lastLine]! + lines[lastLine]!.length,
      })
    }
  }
  return calls
}

/**
 * Consume the indented (and blank) lines of a YAML block scalar starting at
 * `start`. A non-blank line continues the scalar only while its indentation
 * exceeds `baseIndent` (the header param's own indentation), so a following
 * param at the block indent is NOT swallowed. Returns the raw body lines
 * (indentation intact), the count of trailing blank lines (for `+` chomping),
 * and the index of the next line.
 */
function readBlockScalar(
  lines: readonly string[],
  start: number,
  baseIndent: number,
): { readonly body: readonly string[]; readonly trailingBlanks: number; readonly next: number } {
  const collected: string[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === "") {
      collected.push("")
      i++
      continue
    }
    const indent = line.length - line.trimStart().length
    if (indent > baseIndent) {
      collected.push(line)
      i++
      continue
    }
    break
  }
  let end = collected.length
  while (end > 0 && collected[end - 1]!.trim() === "") end--
  return { body: collected.slice(0, end), trailingBlanks: collected.length - end, next: i }
}

/**
 * Render a block scalar per its style + chomping:
 *  - `|` literal keeps line breaks; `>` folds single breaks to spaces and blank
 *    lines to paragraph breaks.
 *  - chomping: `-` strips the trailing break, `+` keeps every trailing blank
 *    line, the default clips to exactly one trailing break (YAML semantics).
 */
function renderBlockScalar(
  body: readonly string[],
  trailingBlanks: number,
  style: "|" | ">",
  chomp: "" | "-" | "+",
): string {
  if (body.length === 0) return chomp === "+" ? "\n".repeat(trailingBlanks) : ""
  const dedented = dedentLines(body)
  const joined = style === ">" ? foldLines(dedented) : dedented.join("\n")
  if (joined === "") return ""
  const breaks = chomp === "-" ? "" : chomp === "+" ? "\n".repeat(1 + trailingBlanks) : "\n"
  return joined + breaks
}

/** Strip the common leading indentation from a block-scalar body. */
function dedentLines(lines: readonly string[]): string[] {
  let min = Number.POSITIVE_INFINITY
  for (const line of lines) {
    if (line.trim() === "") continue
    const indent = line.length - line.trimStart().length
    if (indent < min) min = indent
  }
  if (!Number.isFinite(min)) min = 0
  return lines.map((line) => (line.trim() === "" ? "" : line.slice(min)))
}

/** Fold a `>` block-scalar body: single breaks to spaces, blank lines kept. */
function foldLines(lines: readonly string[]): string {
  let out = ""
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line === "") {
      out += "\n"
      continue
    }
    if (i > 0 && lines[i - 1] !== "") out += " "
    out += line
  }
  return out
}

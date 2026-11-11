/**
 * THE tool-name resolver (canonical tool-call extraction D1): one module for
 * the assistant-text parser, NativeFCStrategy's native-name healing and the
 * HealingPipeline's ToolNameHealer. Names resolve only against the given
 * callable surface. Separator / case matching itself lives in ONE place,
 * `registry/resolve-tool-name.ts`; this module adds only the explicit-call
 * fallbacks.
 */

import { resolveToolName, tokenizeToolName, toolNameVariants } from '../registry/resolve-tool-name.js'

/**
 * Strict resolution: the requested name IS a surface tool modulo separator
 * and case style (`fileRead`, `file_read`, `FILE-READ` → `file-read`;
 * `umami_get_website_stats` → `umami/get_website_stats`). Delegates to the
 * package's ambiguity-safe {@link resolveToolName}: a name matching two
 * surface tools resolves to none. No semantic guessing, so a code
 * identifier such as `requests.get` never resolves to `http-get`. Used for
 * call / CLI forms.
 *
 * @returns the surface name, or null when the name is not on the surface
 */
export function resolveToolNameStrict(
    requestedName: string,
    toolNames: ReadonlySet<string>
): string | null {
    return resolveToolName(requestedName, toolNames) ?? null
}

/**
 * Resolution for an EXPLICITLY named call (native tool_calls, a JSON
 * `"name"` field, a dialect marker): {@link resolveToolNameStrict} plus the
 * unique-suffix and search/fetch fallbacks for hallucinated variants
 * (`google_search` → `web-search`). A name whose separator variant matches
 * two surface tools is ambiguous and returns null without the fallbacks.
 *
 * @returns the surface name, or null when nothing on the surface matches
 */
export function resolveExplicitToolName(
    requestedName: string,
    toolNames: ReadonlySet<string>
): string | null {
    const strict = resolveToolNameStrict(requestedName, toolNames)
    if (strict) return strict
    if (toolNameVariants(requestedName, toolNames).length > 1) return null

    const requestedTokens = tokenizeToolName(requestedName)
    const requestedLast = requestedTokens[requestedTokens.length - 1]
    if (requestedLast) {
        const suffixMatches = [...toolNames].filter((candidate) => {
            const candidateTokens = tokenizeToolName(candidate)
            return candidateTokens[candidateTokens.length - 1] === requestedLast
        })
        if (suffixMatches.length === 1) {
            return suffixMatches[0]!
        }
    }

    const lowered = requestedName.toLowerCase()
    if (lowered.includes('search')) {
        if (toolNames.has('web-search')) return 'web-search'
        const searchMatches = [...toolNames].filter((candidate) =>
            candidate.includes('search')
        )
        if (searchMatches.length === 1) {
            return searchMatches[0]!
        }
    }
    if (
        lowered.includes('http') ||
        lowered.includes('fetch') ||
        lowered.endsWith('get')
    ) {
        if (toolNames.has('http-get')) return 'http-get'
    }

    return null
}

/** Coerce a resolved call's raw input to a plain args object, with per-tool aliases (`queries`, `urls`). */
export function normalizeArgumentsForResolvedTool(
    toolName: string,
    rawInput: unknown
): Record<string, unknown> {
    // Coerce stringified-JSON args before the object check. Cloud adapters
    // JSON.parse tool-call arguments (OpenAI/LiteLLM) or deliver objects
    // natively (Anthropic/Gemini), but the local/Ollama adapter passes the raw
    // value through — and some models emit `arguments` as a JSON STRING. Without
    // this, a string slips past the `typeof === 'object'` check and the args are
    // silently dropped to `{}`, calling the tool with no input.
    let normalizedInput = rawInput
    if (typeof rawInput === 'string') {
        const trimmed = rawInput.trim()
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                normalizedInput = JSON.parse(trimmed) as unknown
            } catch {
                // leave as-is; falls through to the `{}` default below
            }
        }
    }
    const args =
        typeof normalizedInput === 'object' && normalizedInput !== null && !Array.isArray(normalizedInput)
            ? { ...(normalizedInput as Record<string, unknown>) }
            : {}

    if (toolName === 'web-search') {
        if (typeof args.query !== 'string') {
            const queries = Array.isArray(args.queries)
                ? args.queries.filter(
                      (item): item is string =>
                          typeof item === 'string' && item.trim().length > 0
                  )
                : []
            if (queries.length > 0) {
                args.query = queries.join(' OR ')
            }
        }
        delete args.queries
    }

    if (toolName === 'http-get' && typeof args.url !== 'string') {
        const urls = Array.isArray(args.urls)
            ? args.urls.filter(
                  (item): item is string =>
                      typeof item === 'string' && item.trim().length > 0
              )
            : []
        if (urls.length > 0) {
            args.url = urls[0]!
        }
        delete args.urls
    }

    return args
}

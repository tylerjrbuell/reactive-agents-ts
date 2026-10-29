/** Tool-name resolution + argument normalization shared by the text-dialect parsers. */

function tokenizeToolName(name: string): readonly string[] {
    return name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 0)
}

export function resolveToolName(
    requestedName: string,
    toolNames: ReadonlySet<string>
): string | null {
    const directCandidates = [
        requestedName,
        requestedName.replace(/_/g, '-'),
        requestedName.replace(/:/g, '/'),
        requestedName.replace(/[:/]/g, '-'),
    ]
    for (const candidate of directCandidates) {
        if (toolNames.has(candidate)) return candidate
    }

    const requestedTokens = tokenizeToolName(requestedName)

    // Token-SEQUENCE equality: reasoning's `sanitizeToolName` shows the model
    // `umami_get_website_stats` (provider regexes forbid `/`), the only
    // emit-able form — which directCandidates can't hit (no `_`→`/` arm) and
    // the suffix heuristic below aborts on shared last tokens. Full-sequence
    // token equality (first candidate in set order) resolves that BEFORE the
    // weaker truncated-name fallback.
    if (requestedTokens.length > 0) {
        for (const candidate of toolNames) {
            const candidateTokens = tokenizeToolName(candidate)
            if (
                candidateTokens.length === requestedTokens.length &&
                candidateTokens.every((token, index) => token === requestedTokens[index])
            ) {
                return candidate
            }
        }
    }

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

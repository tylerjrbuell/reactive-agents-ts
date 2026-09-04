import { ReactiveAgents } from 'reactive-agents'
import {
    boundedMap,
    defineToolset,
    fetchJsonTool,
    resolveThenRetrieve,
} from '@reactive-agents/tools'
import {
    validateCitations,
    type ReasoningStep,
} from '@reactive-agents/reasoning'
import type { ChatMessage } from '@reactive-agents/runtime'
import { Schema } from 'effect'
import { createInterface } from 'node:readline/promises'

const HALOPEDIA_API = 'https://www.halopedia.org/api.php'
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10

const halopedia = defineToolset('halopedia', {
    category: 'search',
    riskLevel: 'low',
    timeoutMs: 20_000,
    requiresApproval: false,
})

type SearchRow = {
    title?: unknown
    pageid?: unknown
    snippet?: unknown
    wordcount?: unknown
    timestamp?: unknown
}

type SearchResponse = {
    query?: {
        search?: SearchRow[]
        searchinfo?: { totalhits?: unknown }
    }
    continue?: Record<string, unknown>
}

type PageResponse = {
    query?: {
        pages?: Array<{
            pageid?: unknown
            title?: unknown
            fullurl?: unknown
            extract?: unknown
            touched?: unknown
            missing?: boolean
        }>
    }
}

type LinkResponse = {
    query?: {
        pages?: Array<{
            pageid?: unknown
            title?: unknown
            links?: Array<{ pageid?: unknown; title?: unknown }>
            categories?: Array<{ title?: unknown }>
        }>
    }
    continue?: Record<string, unknown>
}

type RevisionResponse = {
    query?: {
        pages?: Array<{
            revisions?: Array<{
                slots?: { main?: { content?: unknown } }
            }>
        }>
    }
}

type PageResult = {
    page_id: number
    title: string
    url?: string
    reference: ArticleReference
    extract: string
    updated_at?: string
}

type ArticleReference = {
    title: string
    page_id?: number
    url: string
}

const clampLimit = (limit: number | undefined): number =>
    Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)))

const cleanSnippet = (snippet: unknown): string =>
    typeof snippet === 'string'
        ? snippet
              .replace(/<[^>]+>/g, '')
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              .trim()
        : ''

const articleUrl = (title: string): string => {
    const url = new URL('https://www.halopedia.org/')
    url.pathname = title.trim().replace(/\s+/g, '_')
    return url.toString()
}

const encodeCursor = (continuation: Record<string, unknown>): string =>
    encodeURIComponent(JSON.stringify(continuation))

const decodeCursor = (cursor: string | undefined): Record<string, unknown> => {
    if (!cursor) return {}
    try {
        const decoded: unknown = JSON.parse(decodeURIComponent(cursor))
        if (
            typeof decoded !== 'object' ||
            decoded === null ||
            Array.isArray(decoded)
        ) {
            throw new Error('cursor must contain a continuation object')
        }
        return decoded as Record<string, unknown>
    } catch (error) {
        throw new Error(
            `Invalid Halopedia cursor: ${
                error instanceof Error ? error.message : String(error)
            }`
        )
    }
}

const requestJson = fetchJsonTool({
    buildUrl: (args) => String(args.url),
    headers: { accept: 'application/json' },
})

const getJson = async <T>(url: URL): Promise<T> =>
    (await requestJson({ url: url.toString() })) as T

const wikiTextQuery = (pageId: number): URL => {
    const url = new URL(HALOPEDIA_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('prop', 'revisions')
    url.searchParams.set('rvprop', 'content')
    url.searchParams.set('rvslots', 'main')
    url.searchParams.set('pageids', String(pageId))
    url.searchParams.set('origin', '*')
    return url
}

const stripWikiMarkup = (value: string): string =>
    value
        .replace(
            /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
            (_, target, label) => label ?? target
        )
        .replace(/\{\{[^{}]*\}\}/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/'{2,}/g, '')
        .replace(/\s+/g, ' ')
        .trim()

type WikiTable = {
    headers: ReadonlyArray<string>
    rows: ReadonlyArray<ReadonlyArray<string>>
}

const parseTableCells = (
    block: string,
    marker: '!' | '|'
): ReadonlyArray<string> =>
    block
        .split('\n')
        .flatMap((line) => {
            const trimmed = line.trim()
            if (!trimmed.startsWith(marker) || trimmed === '|}') return []
            const separator = marker === '!' ? '!!' : '||'
            return trimmed.slice(1).split(separator)
        })
        .map(stripWikiMarkup)
        .filter(Boolean)

const parseWikiTables = (wikiText: string): ReadonlyArray<WikiTable> =>
    [...wikiText.matchAll(/\{\|[\s\S]*?^\|}/gm)].map((match) => {
        const table = match[0]
        const firstRow = table.search(/^\|-.*$/m)
        const headerSource = firstRow < 0 ? table : table.slice(0, firstRow)
        const rows = (firstRow < 0 ? '' : table.slice(firstRow))
            .split(/^\|-.*$/m)
            .slice(1)
            .map((row) => parseTableCells(row, '|'))
            .filter((row) => row.length > 0)
        return {
            headers: parseTableCells(headerSource, '!'),
            rows,
        }
    })

const fetchWikiTables = async (
    pageId: number
): Promise<ReadonlyArray<WikiTable>> => {
    const content = (await getJson<RevisionResponse>(wikiTextQuery(pageId)))
        .query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content
    if (typeof content !== 'string')
        throw new Error('Halopedia source text not found')
    return parseWikiTables(content)
}

const pageQuery = (input: { pageId?: number; title?: string }): URL => {
    const url = new URL(HALOPEDIA_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('prop', 'extracts|info')
    url.searchParams.set('explaintext', '1')
    url.searchParams.set('inprop', 'url')
    url.searchParams.set('redirects', '1')
    url.searchParams.set('origin', '*')
    url.searchParams.set(
        input.pageId !== undefined ? 'pageids' : 'titles',
        String(input.pageId ?? input.title?.trim())
    )
    return url
}

const fetchPageDirect = async (input: {
    pageId?: number
    title?: string
}): Promise<PageResult> => {
    if (input.pageId === undefined && !input.title?.trim())
        throw new Error('Provide pageId or title')
    const page = (await getJson<PageResponse>(pageQuery(input))).query
        ?.pages?.[0]
    if (
        !page ||
        page.missing ||
        typeof page.pageid !== 'number' ||
        typeof page.title !== 'string'
    ) {
        throw new Error('Halopedia article not found')
    }
    const url =
        typeof page.fullurl === 'string' ? page.fullurl : articleUrl(page.title)
    return {
        page_id: page.pageid,
        title: page.title,
        url,
        reference: { title: page.title, page_id: page.pageid, url },
        extract: typeof page.extract === 'string' ? page.extract : '',
        ...(typeof page.touched === 'string'
            ? { updated_at: page.touched }
            : {}),
    }
}

const fetchPage = async (input: {
    pageId?: number
    title?: string
}): Promise<PageResult> => {
    if (input.pageId !== undefined) return fetchPageDirect(input)
    const title = input.title?.trim()
    if (!title) throw new Error('Provide pageId or title')

    const resolved = await resolveThenRetrieve(title, {
        resolve: async (name) => {
            const url = new URL(HALOPEDIA_API)
            url.searchParams.set('action', 'query')
            url.searchParams.set('format', 'json')
            url.searchParams.set('formatversion', '2')
            url.searchParams.set('list', 'search')
            url.searchParams.set('srsearch', name)
            url.searchParams.set('srlimit', '5')
            url.searchParams.set('origin', '*')
            const results =
                (await getJson<SearchResponse>(url)).query?.search ?? []
            const normalized = name.toLowerCase().replace(/\s+/g, ' ')
            const match =
                results.find(
                    (result) =>
                        typeof result.title === 'string' &&
                        typeof result.pageid === 'number' &&
                        result.title.toLowerCase().replace(/\s+/g, ' ') ===
                            normalized
                ) ??
                results.find(
                    (result) =>
                        typeof result.title === 'string' &&
                        typeof result.pageid === 'number'
                )
            return match && typeof match.pageid === 'number'
                ? { page_id: match.pageid }
                : null
        },
        retrieve: ({ page_id }) => fetchPageDirect({ pageId: page_id }),
    })
    if (!resolved) throw new Error(`Halopedia article not found: ${title}`)
    return resolved
}

const fetchLinks = async (
    title: string,
    limit: number
): Promise<ReadonlyArray<{ title: string; page_id?: number }>> => {
    const url = new URL(HALOPEDIA_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('prop', 'links')
    url.searchParams.set('titles', title)
    url.searchParams.set('pllimit', String(limit))
    url.searchParams.set('plnamespace', '0')
    url.searchParams.set('origin', '*')
    const page = (await getJson<LinkResponse>(url)).query?.pages?.[0]
    return (page?.links ?? []).flatMap((link) =>
        typeof link.title === 'string'
            ? [
                  {
                      title: link.title,
                      ...(typeof link.pageid === 'number'
                          ? { page_id: link.pageid }
                          : {}),
                  },
              ]
            : []
    )
}

const referenceSchema = Schema.Struct({
    title: Schema.String,
    page_id: Schema.optional(Schema.Number),
    url: Schema.String,
})

const pageResultSchema = Schema.Struct({
    page_id: Schema.Number,
    title: Schema.String,
    url: Schema.optional(Schema.String),
    reference: referenceSchema,
    extract: Schema.String,
    updated_at: Schema.optional(Schema.String),
})

const searchResultSchema = Schema.Struct({
    title: Schema.String,
    page_id: Schema.Number,
    snippet: Schema.String,
    reference: referenceSchema,
    word_count: Schema.optional(Schema.Number),
    updated_at: Schema.optional(Schema.String),
})

const tableResultSchema = Schema.Struct({
    title: Schema.String,
    table_index: Schema.Number,
    table_count: Schema.Number,
    headers: Schema.Array(Schema.String),
    rows: Schema.Array(Schema.Array(Schema.String)),
    total_rows: Schema.Number,
    next_cursor: Schema.optional(Schema.String),
    reference: referenceSchema,
})

const evidenceSchema = Schema.Struct({
    aspect: Schema.String,
    evidence: Schema.String,
})

const pageReferenceSchema = Schema.Struct({
    title: Schema.String,
    page_id: Schema.optional(Schema.Number),
    url: Schema.String,
})

const Halopedia = halopedia.tool({
    name: 'halopedia-search',
    description:
        'Search Halopedia for Halo species, characters, factions, locations, events, and lore. Returns ranked article candidates with snippets and stable page IDs. Use the page ID with halopedia-get-page to read an article. Pass the returned next_cursor to continue pagination.',
    input: Schema.Struct({
        query: Schema.String,
        limit: Schema.optional(Schema.Number),
        cursor: Schema.optional(Schema.String),
    }),
    output: Schema.Struct({
        query: Schema.String,
        results: Schema.Array(searchResultSchema),
        total_hits: Schema.Number,
        next_cursor: Schema.optional(Schema.String),
    }),
    handler: async (input) => {
        const query = input.query.trim()
        if (!query) throw new Error('Halopedia search query cannot be empty')

        const url = new URL(HALOPEDIA_API)
        url.searchParams.set('action', 'query')
        url.searchParams.set('format', 'json')
        url.searchParams.set('formatversion', '2')
        url.searchParams.set('list', 'search')
        url.searchParams.set('srsearch', query)
        url.searchParams.set('srlimit', String(clampLimit(input.limit)))
        url.searchParams.set('srprop', 'snippet|wordcount|timestamp')
        url.searchParams.set('origin', '*')
        for (const [key, value] of Object.entries(decodeCursor(input.cursor))) {
            if (typeof value === 'string' || typeof value === 'number')
                url.searchParams.set(key, String(value))
        }

        const data = await getJson<SearchResponse>(url)
        const rows = (data.query?.search ?? []).flatMap((row) => {
            if (typeof row.title !== 'string' || typeof row.pageid !== 'number')
                return []
            return [
                {
                    title: row.title,
                    page_id: row.pageid,
                    snippet: cleanSnippet(row.snippet),
                    reference: {
                        title: row.title,
                        page_id: row.pageid,
                        url: articleUrl(row.title),
                    },
                    ...(typeof row.wordcount === 'number'
                        ? { word_count: row.wordcount }
                        : {}),
                    ...(typeof row.timestamp === 'string'
                        ? { updated_at: row.timestamp }
                        : {}),
                },
            ]
        })

        return {
            query,
            results: rows,
            total_hits:
                typeof data.query?.searchinfo?.totalhits === 'number'
                    ? data.query.searchinfo.totalhits
                    : rows.length,
            ...(data.continue
                ? { next_cursor: encodeCursor(data.continue) }
                : {}),
        }
    },
})

const HalopediaGetPage = halopedia.tool({
    name: 'halopedia-get-page',
    description:
        'Resolve a Halopedia title or page ID, then fetch the plain-text content and canonical URL of the article.',
    input: Schema.Struct({
        pageId: Schema.optional(Schema.Number),
        title: Schema.optional(Schema.String),
    }),
    output: pageResultSchema,
    handler: async (input) => {
        return fetchPage(input)
    },
})

const HalopediaGetSection = halopedia.tool({
    name: 'halopedia-get-section',
    description:
        'Fetch one named section of a Halopedia article without loading the entire article into context.',
    input: Schema.Struct({
        pageId: Schema.optional(Schema.Number),
        title: Schema.optional(Schema.String),
        section: Schema.String,
    }),
    output: Schema.Struct({
        title: Schema.String,
        section: Schema.String,
        extract: Schema.String,
        page_id: Schema.Number,
        reference: referenceSchema,
    }),
    handler: async (input) => {
        const page = await fetchPage(input)
        const heading = new RegExp(
            `^={2,}\s*${input.section.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            )}\s*={2,}\s*$`,
            'im'
        )
        const match = heading.exec(page.extract)
        if (!match || match.index === undefined)
            throw new Error(`Section not found: ${input.section}`)
        const start = match.index + match[0].length
        const nextHeading = /^={2,}\s*.+?\s*={2,}\s*$/m.exec(
            page.extract.slice(start)
        )
        return {
            page_id: page.page_id,
            title: page.title,
            section: input.section,
            reference: {
                title: page.title,
                page_id: page.page_id,
                url: page.url ?? articleUrl(page.title),
            },
            extract: page.extract
                .slice(
                    start,
                    nextHeading ? start + nextHeading.index : undefined
                )
                .trim(),
        }
    },
})

const HalopediaGetTable = halopedia.tool({
    name: 'halopedia-get-table',
    description:
        'Extract a structured wiki table from any Halopedia article. Returns compact headers and rows rather than loading article prose. Use tableIndex to select a table and next_cursor until absent to retrieve every row.',
    input: Schema.Struct({
        pageId: Schema.optional(Schema.Number),
        title: Schema.optional(Schema.String),
        tableIndex: Schema.optional(Schema.Number),
        limit: Schema.optional(Schema.Number),
        cursor: Schema.optional(Schema.String),
    }),
    output: tableResultSchema,
    handler: async (input) => {
        const page = await fetchPage(input)
        const tables = await fetchWikiTables(page.page_id)
        const continuation = decodeCursor(input.cursor)
        const tableIndex =
            typeof continuation.tableIndex === 'number'
                ? Math.floor(continuation.tableIndex)
                : Math.floor(input.tableIndex ?? 0)
        const table = tables[tableIndex]
        if (!table) throw new Error(`Halopedia table not found: ${tableIndex}`)
        const offset =
            typeof continuation.offset === 'number' && continuation.offset >= 0
                ? Math.floor(continuation.offset)
                : 0
        const limit = clampLimit(input.limit)
        const pageRows = table.rows.slice(offset, offset + limit)
        const nextOffset = offset + pageRows.length
        return {
            title: page.title,
            table_index: tableIndex,
            table_count: tables.length,
            headers: table.headers,
            rows: pageRows,
            total_rows: table.rows.length,
            ...(nextOffset < table.rows.length
                ? {
                      next_cursor: encodeCursor({
                          tableIndex,
                          offset: nextOffset,
                      }),
                  }
                : {}),
            reference: page.reference,
        }
    },
})

const HalopediaFindInPage = halopedia.tool({
    name: 'halopedia-find-in-page',
    description:
        'Find targeted evidence in a Halopedia article. Returns short surrounding passages and their section headings.',
    input: Schema.Struct({
        pageId: Schema.optional(Schema.Number),
        title: Schema.optional(Schema.String),
        query: Schema.String,
        limit: Schema.optional(Schema.Number),
    }),
    output: Schema.Struct({
        title: Schema.String,
        matches: Schema.Array(
            Schema.Struct({
                section: Schema.optional(Schema.String),
                text: Schema.String,
            })
        ),
        references: Schema.Array(referenceSchema),
    }),
    handler: async (input) => {
        const page = await fetchPage(input)
        const terms = input.query
            .toLowerCase()
            .split(/\s+OR\s+|\s+/)
            .filter((term) => term.length > 2)
        const maxMatches = clampLimit(input.limit)
        const matches: Array<{ section?: string; text: string }> = []
        for (const term of terms) {
            let offset = 0
            while (matches.length < maxMatches) {
                const index = page.extract.toLowerCase().indexOf(term, offset)
                if (index < 0) break
                const lineStart = page.extract.lastIndexOf('\n', index) + 1
                const sectionHeader = page.extract
                    .slice(0, index)
                    .match(/^={2,}\s*(.+?)\s*={2,}\s*$/gm)
                    ?.at(-1)
                    ?.replace(/=/g, '')
                    .trim()
                matches.push({
                    ...(sectionHeader ? { section: sectionHeader } : {}),
                    text: page.extract
                        .slice(
                            Math.max(lineStart, index - 180),
                            Math.min(
                                page.extract.length,
                                index + term.length + 300
                            )
                        )
                        .replace(/\s+/g, ' ')
                        .trim(),
                })
                offset = index + term.length
            }
        }
        return {
            title: page.title,
            matches,
            references: [page.reference],
        }
    },
})

const HalopediaExplore = halopedia.tool({
    name: 'halopedia-explore',
    description:
        'Explore a Halopedia entity as a small knowledge graph. Resolves the starting page, returns its linked article nodes, and includes source evidence.',
    input: Schema.Struct({
        startingPoint: Schema.String,
        limit: Schema.optional(Schema.Number),
    }),
    timeoutMs: 30_000,
    output: Schema.Struct({
        source: pageReferenceSchema,
        nodes: Schema.Array(pageReferenceSchema),
        relationships: Schema.Array(
            Schema.Struct({
                from: Schema.String,
                to: Schema.String,
                type: Schema.Literal('links_to'),
            })
        ),
        references: Schema.Array(pageReferenceSchema),
    }),
    handler: async (input) => {
        const page = await fetchPage({ title: input.startingPoint })
        const nodes = (
            await fetchLinks(page.title, clampLimit(input.limit))
        ).map((node) => ({ ...node, url: articleUrl(node.title) }))
        return {
            source: {
                title: page.title,
                page_id: page.page_id,
                url: page.url ?? articleUrl(page.title),
            },
            nodes,
            relationships: nodes.map((node) => ({
                from: page.title,
                to: node.title,
                type: 'links_to' as const,
            })),
            references: [
                page.reference,
                ...nodes.map(({ title, page_id, url }) => ({
                    title,
                    ...(page_id !== undefined ? { page_id } : {}),
                    url,
                })),
            ],
        }
    },
})

const HalopediaCompare = halopedia.tool({
    name: 'halopedia-compare',
    description:
        'Compare multiple Halopedia entities using the requested aspects. Returns grounded excerpts from each source page.',
    input: Schema.Struct({
        entities: Schema.Array(Schema.String),
        aspects: Schema.Array(Schema.String),
    }),
    timeoutMs: 30_000,
    output: Schema.Struct({
        entities: Schema.Array(
            Schema.Struct({
                title: Schema.String,
                page_id: Schema.Number,
                aspects: Schema.Array(evidenceSchema),
            })
        ),
        sources: Schema.Array(referenceSchema),
        errors: Schema.Array(
            Schema.Struct({ input: Schema.String, error: Schema.Unknown })
        ),
    }),
    handler: async (input) => {
        if (input.entities.length === 0 || input.entities.length > 5)
            throw new Error('Compare between 1 and 5 entities')
        if (input.aspects.length === 0 || input.aspects.length > 8)
            throw new Error('Provide between 1 and 8 aspects')
        const fetched = await boundedMap(input.entities, 3, (title) =>
            fetchPage({ title })
        )
        const pages = fetched.succeeded
        const entities = pages.map((page) => ({
            title: page.title,
            page_id: page.page_id,
            aspects: input.aspects.map((aspect) => {
                const index = page.extract
                    .toLowerCase()
                    .indexOf(aspect.toLowerCase())
                return {
                    aspect,
                    evidence:
                        index < 0
                            ? 'No matching passage found.'
                            : page.extract
                                  .slice(
                                      Math.max(0, index - 160),
                                      index + aspect.length + 340
                                  )
                                  .replace(/\s+/g, ' ')
                                  .trim(),
                }
            }),
        }))
        return {
            entities,
            sources: pages.map(({ title, page_id, url }) => ({
                title,
                page_id,
                url: url ?? articleUrl(title),
            })),
            errors: fetched.failed.map(({ input: title, error }) => ({
                input: title,
                error,
            })),
        }
    },
})

const agent = await ReactiveAgents.create()
    .withName('Halopedia-Agent')
    // Stable id, not the default `${name}-${Date.now()}` — .withMemory()'s
    // default db path is `~/.reactive-agents/<agentId>/memory.db`, so
    // without this every process run mints a fresh agentId and therefore a
    // fresh, empty memory store. This is the one line that makes memory
    // actually persist across sessions.
    .withAgentId('halopedia-agent')
    .withTracing()
    .withProvider('ollama')
    .withModel('gemma4')
    .withPersona({
        role: 'Halopedia research expert and lifelong Halo lore specialist',
        background:
            'Deep knowledge of Halo canon, expanded universe material, species, factions, characters, ' +
            'locations, technology, vehicles, weapons, events, timelines, and differences between games, ' +
            'novels, comics, and other official sources.',
        instructions:
            'Use the full Halopedia research arsenal to produce the highest-quality lore answer, not merely the ' +
            'first plausible answer. Begin broad with halopedia-search to discover candidate articles and resolve ' +
            'canonical titles. Use halopedia-get-page when the topic requires complete historical or contextual ' +
            'understanding. Use halopedia-get-section and halopedia-find-in-page for precise fact-checking, quotes, ' +
            'and focused evidence instead of repeatedly loading irrelevant article text. Use halopedia-get-table for ' +
            'complete, structured tables such as book lists; follow its next_cursor until all rows are retrieved instead of trying ' +
            'to reconstruct a table from snippets. Use halopedia-explore to ' +
            'follow relationships and uncover connected species, factions, characters, locations, events, or ' +
            'technology. Use halopedia-compare for multi-entity analysis and apparent contradictions. Combine ' +
            'tools when that improves coverage: search, resolve, retrieve, inspect evidence, cross-check, then ' +
            'synthesize. Do not stop after one shallow lookup when the question calls for research. Cite the ' +
            'relevant Halopedia article titles and identify which evidence supports each important claim. Clearly ' +
            'separate established canon, source-specific or conflicting accounts, interpretation, and speculation. ' +
            'Never invent lore, merge similarly named entities, or present an inference as a sourced fact. For ' +
            'broad questions, explore the knowledge graph and provide a concise, chronological, nuanced, and ' +
            'well-supported answer. If the evidence is incomplete or contradictory, say so explicitly and explain why. ' +
            'Every response containing factual lore must include citations: place an inline Markdown link such as ' +
            '[Kig-Yar](https://www.halopedia.org/Kig-Yar) immediately after important claims, then finish with a ' +
            '"References" section listing every Halopedia article used. Only cite URLs returned by the tools or ' +
            'their deterministic article references; never fabricate a citation. Even short answers must include at ' +
            'least one reference when a source was consulted.\n\n' +
            'Read the intent behind each message and match your depth to it. Quick nerdy banter, jokes, headcanon, ' +
            '"what if" hypotheticals, and rapid-fire opinions ("who would win", "coolest ship design") deserve a short, ' +
            'punchy, fun reply in a fellow-fan voice — no forced citations, no References section, no tool-shaped ' +
            'formality, just good conversation. Genuine lore questions — facts, timelines, comparisons, "what really ' +
            'happened", canon disputes — deserve the full research-and-cite treatment above. When a message could be ' +
            'either, lean toward banter unless it names specific canon details that need verifying. Never let one mode ' +
            'bleed into the other: a joke does not need a References section, and a factual claim never skips one.\n\n' +
            "You have persistent memory across sessions, distinct from halopedia-explore (which walks Halopedia's own " +
            'wiki-link structure). Before doing a fresh Halopedia lookup, use find(query, scope:"memory") to check ' +
            'whether this topic came up in an earlier conversation — reuse what you already worked out instead of ' +
            're-fetching and re-deriving it. When you land on a substantive finding (a resolved contradiction, a ' +
            'timeline you pieced together, a comparison verdict), use recall(key, content) to jot a short durable note ' +
            'so future turns and future sessions can find it. Memory entries you write get auto-linked by content ' +
            'similarity; use relate(id, mode:"links") on an id a find() result returned to surface other things you\'ve ' +
            "previously discussed that are connected to it — a second, complementary graph to halopedia-explore's " +
            'wiki links, this one built from your own conversation history. If you notice two remembered findings are ' +
            'connected in a way plain similarity would not catch — one caused another, one contradicts another, one ' +
            'elaborates on another — use relate(id, mode:"link", targetId, type) to assert it explicitly, so the next ' +
            'find/relate pass surfaces that connection too. None of this replaces citing Halopedia sources: memory is ' +
            'for continuity across turns and sessions, not a substitute for grounding factual claims in halopedia-* ' +
            'tool evidence.',
        tone: 'enthusiastic, precise, lore-aware, and clear — a knowledgeable friend who can riff casually or dig into deep canon depending on what the moment calls for',
    })
    .withReasoning({
        defaultStrategy: 'reactive',
        // NOTE: do NOT set enableStrategySwitching:false here — tried it as a
        // defense-in-depth backstop, but it's actively harmful: the entropy/
        // loop-detector dispatcher still REQUESTS a switch whenever it sees
        // flat entropy (unrelated to think.ts's noToolRequired fix below,
        // which only helps once the model's thought already looks like a
        // complete answer). With switching disabled, a request the dispatcher
        // makes for a genuinely-stuck run hits iterate-pass.ts's "switching
        // not enabled" branch and terminates immediately with an EMPTY
        // passthrough deliverable — turning a slow-but-eventually-successful
        // escalation into a hard failure (confirmed via rax-diagnose: verifier
        // rejected `final-answer` success=false, terminatedBy=switching_exhausted).
        // The real fix for the reported banter-loop issue is the
        // `noToolRequired` condition in think.ts (see comment there) — verified
        // standalone, with switching left at its default (enabled), to resolve
        // no-tool-needed turns in 2 iterations with no switch ever requested.
    })
    // Persistent cross-session memory (SQLite, ~/.reactive-agents/<agentId>/).
    // Every substantial reply gets auto-extracted into semantic memory and
    // auto-linked by content similarity — the substrate find(scope:"memory")
    // and relate() below read from. A REPL that runs indefinitely across many
    // conversations is exactly the case where this pays for itself: lore
    // worked out three sessions ago becomes reusable instead of re-derived.
    .withMemory({
        tier: 'enhanced',
    })
    .withMemoryConsolidation()
    // find (keyword search over remembered content, real per-entry ids) and
    // relate (read/write the memory-entry relationship graph) — see the
    // persona instructions above for the intended usage pattern. recall
    // (durable notes) is part of the same family; harnessSkill:false keeps
    // the harness-skill preamble out since the persona already covers usage.
    .withMetaTools({
        recall: true,
        find: true,
        relate: true,
        harnessSkill: false,
    })
    .withTools({
        builtins: false,
        tools: [
            Halopedia,
            HalopediaGetPage,
            HalopediaGetSection,
            HalopediaGetTable,
            HalopediaFindInPage,
            HalopediaExplore,
            HalopediaCompare,
        ],
    })
    .build()

// ─── Banter vs. lore-dive tool gating ──────────────────────────────────────
// Persona instructions above handle *tone*; this heuristic handles whether a
// Halopedia round-trip is worth the latency at all. This is a lore-wiki
// agent, so most messages ARE genuine lore requests — default to using
// tools and only skip them for explicit banter. The framework's generic
// `requiresTools()` is NOT used as a fallback here: its CHAT_OVERRIDE_PATTERNS
// treats "tell me about", "explain", "describe", "how did" as recall of a
// past run (its intended domain) and forces useTools:false — exactly the
// phrasing people use to ask for lore, which silently killed tool calls.
const BANTER_PATTERNS = [
    /\b(what if|headcanon|hot take|unpopular opinion|imo|lol|lmao)\b/i,
    /\b(who('d| would) win|coolest|favorite|worst|best|funny|fun)\b/i,
]

const needsHalopedia = (message: string): boolean =>
    !BANTER_PATTERNS.some((p) => p.test(message))

// ─── Rolling-summary context compaction ────────────────────────────────────
// Long sessions keep only the last RAW_TURN_WINDOW messages verbatim; older
// turns get folded into a running `storySoFar` summary (itself re-capped)
// instead of being dropped, so early-mentioned names/facts survive without
// the full transcript riding along on every turn.
const RAW_TURN_WINDOW = 12 // ~6 exchanges
const SUMMARY_WORD_CAP = 300

let history: ChatMessage[] = []
let storySoFar = ''

const compactHistoryIfNeeded = async (): Promise<void> => {
    if (history.length <= RAW_TURN_WINDOW) return
    const overflowCount = history.length - RAW_TURN_WINDOW
    const overflow = history.slice(0, overflowCount)
    history = history.slice(overflowCount)

    const transcript = overflow
        .map((m) => `${m.role === 'user' ? 'You' : 'Halopedia'}: ${m.content}`)
        .join('\n')
    const summaryPrompt = storySoFar
        ? `Existing summary of an earlier Halo conversation:\n${storySoFar}\n\n` +
          `Merge in this next chunk of conversation, keeping every distinct fact, ` +
          `name, and decision worth remembering. Stay under ${SUMMARY_WORD_CAP} words, ` +
          `plain prose, no citations:\n${transcript}`
        : `Condense this Halo conversation into a compact summary of the facts, ` +
          `names, and decisions worth remembering. Stay under ${SUMMARY_WORD_CAP} words, ` +
          `plain prose, no citations:\n${transcript}`

    try {
        const summary = await agent.chat(summaryPrompt, { useTools: false }, [])
        storySoFar = summary.message.trim()
        console.log('\n[context condensed — earlier turns folded into summary]')
    } catch {
        // Compaction is best-effort — if it fails, the overflow turns are
        // simply dropped rather than blocking the conversation.
    }
}

const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
})

console.log(
    'Halopedia expert ready. Ask about Halo lore, share a hot take, or type "exit" to quit.'
)

try {
    while (true) {
        const message = (await readline.question('\nYou: ')).trim()
        if (!message) continue
        if (
            message.toLowerCase() === 'exit' ||
            message.toLowerCase() === 'quit'
        )
            break

        try {
            const useTools = needsHalopedia(message)
            const enrichedMessage = storySoFar
                ? `[Story so far: ${storySoFar}]\n\n${message}`
                : message
            const reply = await agent.chat(
                enrichedMessage,
                { useTools, maxIterations: 12 },
                history
            )
            history = [
                ...history,
                { role: 'user', content: message, timestamp: Date.now() },
                {
                    role: 'assistant',
                    content: reply.message,
                    timestamp: Date.now(),
                },
            ]

            console.log(`\nHalopedia: ${reply.message}`)
            if (reply.toolsUsed && reply.toolsUsed.length > 0) {
                console.log(
                    `\nSources/tools used: ${reply.toolsUsed.join(', ')}`
                )
            }
            // ChatReply.reasoningSteps is structurally typed (runtime doesn't
            // import the reasoning package's branded ReasoningStep) — cast is
            // safe, validateCitations only reads type/content/metadata. The
            // scratchpad carries the FULL (uncompressed) tool-result store —
            // without it, citations against evidence past the compressed
            // step-content preview's truncation cutoff read as false positives.
            const scratchpad = new Map(Object.entries(reply.scratchpad ?? {}))
            const citations = validateCitations(
                reply.message,
                (reply.reasoningSteps ?? []) as readonly ReasoningStep[],
                scratchpad
            )
            if (!citations.ok) {
                console.warn(
                    `\n[unverified citations] ${citations.uncitedUrls.join(
                        ', '
                    )} not found in tool evidence`
                )
            }

            await compactHistoryIfNeeded()
        } catch (error) {
            console.error(
                `\nRequest failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            )
        }
    }
} finally {
    readline.close()
    await agent.dispose()
}

import { ReactiveAgents, defineTool } from 'reactive-agents'
import { Schema } from 'effect'
import { createInterface } from 'node:readline/promises'

const HALOPEDIA_API = 'https://www.halopedia.org/api.php'
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10

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

const requestJson = async <T>(url: URL): Promise<T> => {
    const response = await fetch(url, {
        headers: { accept: 'application/json' },
    })
    if (!response.ok) {
        throw new Error(
            `Halopedia API failed with HTTP ${response.status} ${response.statusText}`
        )
    }
    return (await response.json()) as T
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

const fetchPage = async (input: {
    pageId?: number
    title?: string
}): Promise<PageResult> => {
    if (input.pageId === undefined && !input.title?.trim())
        throw new Error('Provide pageId or title')
    const page = (await requestJson<PageResponse>(pageQuery(input))).query
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
    const page = (await requestJson<LinkResponse>(url)).query?.pages?.[0]
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

const Halopedia = defineTool({
    name: 'halopedia-search',
    description:
        'Search Halopedia for Halo species, characters, factions, locations, events, and lore. Returns ranked article candidates with snippets and stable page IDs. Use the page ID with halopedia-get-page to read an article. Pass the returned next_cursor to continue pagination.',
    input: Schema.Struct({
        query: Schema.String,
        limit: Schema.optional(Schema.Number),
        cursor: Schema.optional(Schema.String),
    }),
    riskLevel: 'low',
    category: 'search',
    returnType:
        '{ query: string, results: Array<{ title: string, page_id: number, snippet: string, reference: { title: string, page_id: number, url: string }, word_count?: number, updated_at?: string }>, total_hits: number, next_cursor?: string }',
    timeoutMs: 20_000,
    requiresApproval: false,
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

        const data = await requestJson<SearchResponse>(url)
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

const HalopediaGetPage = defineTool({
    name: 'halopedia-get-page',
    description:
        'Fetch the plain-text content and canonical URL of a Halopedia article by page ID or exact title.',
    input: Schema.Struct({
        pageId: Schema.optional(Schema.Number),
        title: Schema.optional(Schema.String),
    }),
    riskLevel: 'low',
    category: 'search',
    returnType:
        '{ page_id: number, title: string, url: string, reference: { title: string, page_id: number, url: string }, extract: string, updated_at?: string }',
    timeoutMs: 20_000,
    requiresApproval: false,
    handler: async (input) => {
        return fetchPage(input)
    },
})

const HalopediaGetSection = defineTool({
    name: 'halopedia-get-section',
    description:
        'Fetch one named section of a Halopedia article without loading the entire article into context.',
    input: Schema.Struct({
        pageId: Schema.optional(Schema.Number),
        title: Schema.optional(Schema.String),
        section: Schema.String,
    }),
    riskLevel: 'low',
    category: 'search',
    timeoutMs: 20_000,
    requiresApproval: false,
    returnType:
        '{ title: string, section: string, extract: string, page_id: number, reference: { title: string, page_id: number, url: string } }',
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

const HalopediaFindInPage = defineTool({
    name: 'halopedia-find-in-page',
    description:
        'Find targeted evidence in a Halopedia article. Returns short surrounding passages and their section headings.',
    input: Schema.Struct({
        pageId: Schema.optional(Schema.Number),
        title: Schema.optional(Schema.String),
        query: Schema.String,
        limit: Schema.optional(Schema.Number),
    }),
    riskLevel: 'low',
    category: 'search',
    timeoutMs: 20_000,
    requiresApproval: false,
    returnType:
        '{ title: string, matches: Array<{ section?: string, text: string }>, references: Array<{ title: string, page_id: number, url: string }> }',
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

const HalopediaExplore = defineTool({
    name: 'halopedia-explore',
    description:
        'Explore a Halopedia entity as a small knowledge graph. Resolves the starting page, returns its linked article nodes, and includes source evidence.',
    input: Schema.Struct({
        startingPoint: Schema.String,
        limit: Schema.optional(Schema.Number),
    }),
    riskLevel: 'low',
    category: 'search',
    timeoutMs: 30_000,
    requiresApproval: false,
    returnType:
        '{ source: { title: string, page_id: number, url: string }, nodes: Array<{ title: string, page_id?: number, url: string }>, relationships: Array<{ from: string, to: string, type: "links_to" }>, references: Array<{ title: string, page_id?: number, url: string }> }',
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

const HalopediaCompare = defineTool({
    name: 'halopedia-compare',
    description:
        'Compare multiple Halopedia entities using the requested aspects. Returns grounded excerpts from each source page.',
    input: Schema.Struct({
        entities: Schema.Array(Schema.String),
        aspects: Schema.Array(Schema.String),
    }),
    riskLevel: 'low',
    category: 'search',
    timeoutMs: 30_000,
    requiresApproval: false,
    returnType:
        '{ entities: Array<{ title: string, page_id: number, aspects: Array<{ aspect: string, evidence: string }> }>, sources: Array<{ title: string, page_id: number, url: string }> }',
    handler: async (input) => {
        if (input.entities.length === 0 || input.entities.length > 5)
            throw new Error('Compare between 1 and 5 entities')
        if (input.aspects.length === 0 || input.aspects.length > 8)
            throw new Error('Provide between 1 and 8 aspects')
        const pages = await Promise.all(
            input.entities.map((title) => fetchPage({ title }))
        )
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
        }
    },
})

const agent = await ReactiveAgents.create()
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
            'understanding. Use halopedia-find-in-page and halopedia-get-section for precise fact-checking, quotes, ' +
            'and focused evidence instead of repeatedly loading irrelevant article text. Use halopedia-explore to ' +
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
            'least one reference when a source was consulted.',
        tone: 'enthusiastic, precise, lore-aware, and clear',
    })
    .withReasoning({ defaultStrategy: 'reactive' })
    .withTools({
        builtins: false,
        tools: [
            Halopedia,
            HalopediaGetPage,
            HalopediaGetSection,
            HalopediaFindInPage,
            HalopediaExplore,
            HalopediaCompare,
        ],
    })
    .build()

const session = agent.session()
const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
})

console.log(
    'Halopedia expert ready. Ask about Halo lore, or type "exit" to quit.'
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
            const reply = await session.chat(message, {
                useTools: true,
                maxIterations: 12,
            })
            console.log(`\nHalopedia: ${reply.message}`)
            if (reply.toolsUsed && reply.toolsUsed.length > 0) {
                console.log(
                    `\nSources/tools used: ${reply.toolsUsed.join(', ')}`
                )
            }
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
    await session.end()
    await agent.dispose()
}

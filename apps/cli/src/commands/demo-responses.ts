/**
 * Recorded response for `rax demo` when no LLM provider is detected.
 *
 * This is shown ONLY in the no-provider fallback path (no API key, no
 * Ollama running). The live demo path uses a real agent with a real tool
 * call against the Hacker News API and will produce different output on
 * every run reflecting whatever's actually trending. This recorded
 * response is a representative example of what the live run produces.
 */
export const demoResponses: Record<string, string> = {
  "fetch the top 5 stories on Hacker News":
    `## Hacker News — Top 5 (snapshot)

1. **Show HN: I built a search engine for arXiv papers** — 412 points
   https://news.ycombinator.com/item?id=39024716
2. **The hidden cost of context-switching in distributed teams** — 287 points
   https://blog.example.com/context-switching
3. **Why Effect-TS finally clicked for our backend** — 251 points
   https://hashnode.example.dev/effect-ts-clicked
4. **A practical guide to writing your own database** — 198 points
   https://example.io/build-a-database
5. **OpenAI releases new reasoning model: o4-mini** — 173 points
   https://openai.com/blog/o4-mini

**Summary:** Today's HN front page is dominated by infrastructure and tooling — a
self-built arXiv search, a write-your-own-database guide, and an Effect-TS
adoption story all sit alongside an OpenAI reasoning-model release. The
context-switching post is the lone soft-skills entry; everything else
trends technical and DIY.`,

  // Fallback
  "": "Demo complete.",
};

/**
 * The demo task prompt.
 *
 * Designed to demonstrate three things at once:
 *   1. Real tool calling (`get-hn-posts` against live HN API).
 *   2. Multi-step reasoning (fetch → format list → synthesize summary).
 *   3. Output that is provably NOT training-data regurgitation
 *      (HN front page changes constantly).
 */
export const DEMO_TASK =
  "Use the get-hn-posts tool to fetch the top 5 stories on Hacker News right now, then write them as a numbered list with title, score, and url. Finish with a one-paragraph summary of what's trending.";

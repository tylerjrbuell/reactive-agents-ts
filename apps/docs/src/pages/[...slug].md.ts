/**
 * Markdown twin of every docs page: `/guides/quickstart/` is also served as
 * `/guides/quickstart.md`, and the home page as `/index.md`. Prerendered at
 * build time from the docs content collection (see src/agent-docs/page-markdown.ts).
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { AGENT_PROMPT } from "../agent-docs/agent-prompt";
import { renderPageMarkdown, slugForId } from "../agent-docs/page-markdown";
import { CURRENT_VERSION } from "../content/indicators";
import metrics from "../data/metrics.json";

export const prerender = true;

/** Pages with no reader value as markdown. */
const EXCLUDED = new Set(["404"]);

export const getStaticPaths = (async () => {
  const entries = (await getCollection("docs")).filter((e) => !EXCLUDED.has(slugForId(e.id)));
  const knownSlugs = new Set(entries.map((e) => slugForId(e.id)));
  return entries.map((entry) => {
    const slug = slugForId(entry.id);
    return {
      params: { slug: slug === "" ? "index" : slug },
      props: { entry, knownSlugs },
    };
  });
}) satisfies GetStaticPaths;

interface Props {
  readonly entry: CollectionEntry<"docs">;
  readonly knownSlugs: ReadonlySet<string>;
}

export const GET: APIRoute<Props> = ({ props }) => {
  const { entry, knownSlugs } = props;
  const markdown = renderPageMarkdown({
    id: entry.id,
    title: entry.data.title,
    description: entry.data.description,
    body: entry.body ?? "",
    mdx: (entry.filePath ?? "").endsWith(".mdx"),
    version: CURRENT_VERSION,
    knownSlugs,
    agentPrompt: AGENT_PROMPT,
    metrics,
  });
  return new Response(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};

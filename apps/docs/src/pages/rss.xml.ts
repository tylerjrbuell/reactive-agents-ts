/**
 * RSS feed for the docs site, focused on releases / what's new.
 *
 * Built from the H2-anchored release sections inside whats-new.md so the feed
 * stays a single-source-of-truth with the page itself. Each `## v0.x — Title`
 * heading becomes a feed item; the body up to the next H2 becomes the
 * description (plain-text excerpt, capped at ~600 chars).
 */

import rss from "@astrojs/rss";
import { getCollection, getEntry, render } from "astro:content";

export const GET = async (context: { site?: URL }) => {
  const site = context.site?.toString() ?? "https://docs.reactiveagents.dev";

  // Pull whats-new.md raw body
  const entry = await getEntry("docs", "guides/whats-new");
  const body: string = entry?.body ?? "";

  // Split on H2 release headings ("## v0.10.x — ..." or "## Current ...")
  const sections = body
    .split(/\n(?=##\s+(?:v\d|Current))/g)
    .filter((s) => /^##\s+/.test(s))
    .slice(0, 25);

  const items = sections.map((section) => {
    const titleLine = section.match(/^##\s+(.+)$/m)?.[1] ?? "Release notes";
    // Crude version extraction: "v0.10.x — ..." → "v0.10.x"
    const versionMatch = titleLine.match(/^(v\d[^\s—]*)/);
    const version = versionMatch?.[1] ?? "current";

    // Strip markdown to get a clean description excerpt
    const body = section
      .replace(/^##\s+.+\n/, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) → text
      .replace(/`([^`]+)`/g, "$1") // `code` → code
      .replace(/[*_~]+/g, "")
      .replace(/^\|.*\|$/gm, "") // strip table rows
      .replace(/^-+\|/gm, "")
      .replace(/\n{2,}/g, " · ")
      .trim()
      .slice(0, 600);

    return {
      title: titleLine,
      pubDate: new Date(), // best we can do without per-section dates
      description: body,
      link: `/guides/whats-new/#${slugify(titleLine)}`,
      categories: [version],
    };
  });

  return rss({
    title: "Reactive Agents — Release Notes",
    description:
      "TypeScript AI agent framework — release highlights, features, and breaking changes.",
    site,
    items,
    customData: `<language>en-us</language><docs>https://docs.reactiveagents.dev/guides/whats-new/</docs>`,
  });
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

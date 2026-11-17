import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsSchema } from "@astrojs/starlight/schema";
import { docsLoaderWithMeta } from "./content/docs-loader-with-meta";
import { starlightSafeSkillsLoader } from "./content/skills-loader";
import { STABILITY_TIERS } from "./content/indicators";

/** Controlled `topic` values for the Related block (Docs-IA-Proposal section c). */
const DOC_TOPICS = [
  "getting-started", "reasoning", "tools", "mcp", "memory", "providers", "local-models",
  "streaming", "context", "agents", "channels", "gateway", "web-ui", "durable-runs",
  "safety", "cost", "observability", "quality", "cortex", "cli", "config-reference",
  "concepts", "compare", "releases", "help",
] as const;

const versionString = z.string().regex(/^\d+\.\d+$/, 'use a minor version like "0.18"').optional();

const skillFileSchema = z.object({
  content: z.string(),
  encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
  contentType: z.string(),
});

const skillsSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(1024),
  files: z.record(z.string(), skillFileSchema),
});

export const collections = {
  docs: defineCollection({
    loader: docsLoaderWithMeta(),
    schema: docsSchema({
      extend: z.object({
        // Authored, release-based indicators (wiki/Reference/Docs-Indicators.md).
        // `since`: release that introduced the page; `updated`: release that
        // materially changed it. Version strings like "0.18". Markers expire when
        // the release in the VERSION file moves on (indicators.ts); the loader
        // fails the build on a malformed or future version.
        since: versionString,
        updated: versionString,
        stability: z.enum(STABILITY_TIERS).optional(),
        // Computed at build time by docs-loader-with-meta.ts (last-commit.ts),
        // display only ("Last updated"). Never authored.
        lastCommit: z.object({ hash: z.string(), date: z.string() }).optional(),
        // Docs IA: one topic per page (controlled list, wiki/Reference/Docs-IA-Proposal.md
        // section c) and up to 4 hand-picked related slugs (e.g. "guides/memory").
        // RelatedPages.astro renders them; with no `related` it falls back to other
        // pages that share the topic.
        topic: z.enum(DOC_TOPICS).optional(),
        related: z.array(z.string()).max(4).optional(),
        // Curated Q&A -> Schema.org FAQPage JSON-LD
        faq: z
          .array(z.object({ q: z.string(), a: z.string() }))
          .optional(),
      }),
    }),
  }),
  skills: defineCollection({
    loader: starlightSafeSkillsLoader({ base: "./skills" }),
    schema: skillsSchema,
  }),
};

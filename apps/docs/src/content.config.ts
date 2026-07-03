import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsSchema } from "@astrojs/starlight/schema";
import { docsLoaderWithMeta } from "./content/docs-loader-with-meta";
import { starlightSafeSkillsLoader } from "./content/skills-loader";

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
        // Legacy new-page fields — kept for backward compat, replaced by badge system
        isNew: z.boolean().optional(),
        newUntil: z.string().optional(),
        // Manually-authored: drives computeGitPageMetadata()'s badge priority
        stability: z.enum(["stable", "unstable", "experimental", "deprecated"]).optional(),
        // Everything below is computed at build time by docs-loader-with-meta.ts
        // (git-page-metadata.ts) — never authored by hand, never persisted to
        // source frontmatter.
        badge: z
          .object({ text: z.string(), variant: z.string(), __auto: z.string().optional() })
          .optional(),
        lastCommit: z
          .object({
            subject: z.string(),
            hash: z.string(),
            date: z.string(),
          })
          .optional(),
        changedSections: z.array(z.string()).optional(),
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

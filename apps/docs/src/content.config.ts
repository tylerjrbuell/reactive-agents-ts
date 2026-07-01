import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
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
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // Legacy new-page fields — kept for backward compat, replaced by badge system
        isNew: z.boolean().optional(),
        newUntil: z.string().optional(),
        // Badge system fields (written by scripts/sync-page-metadata.ts)
        stability: z.enum(["stable", "unstable", "experimental", "deprecated"]).optional(),
        since: z.string().optional(),
        lastCommit: z
          .object({
            subject: z.string(),
            hash: z.string(),
            date: z.string(),
          })
          .optional(),
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

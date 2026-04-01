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
    schema: docsSchema(),
  }),
  skills: defineCollection({
    loader: starlightSafeSkillsLoader({ base: "./skills" }),
    schema: skillsSchema,
  }),
};

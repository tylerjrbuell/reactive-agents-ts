import { defineCollection, z } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { starlightSafeSkillsLoader } from "./skills-loader";

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
  docs: defineCollection({ schema: docsSchema() }),
  skills: defineCollection({
    schema: skillsSchema,
    loader: starlightSafeSkillsLoader({ base: "./skills" }),
  }),
};

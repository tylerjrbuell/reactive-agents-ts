import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import skills from "astro-skills";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";

export default defineConfig({
  // Docs now deploy to a custom domain at the root path.
  site: "https://docs.reactiveagents.dev",
  base: "/",
  integrations: [
    skills(),
    starlight({
      title: "Reactive Agents",
      description:
        "Build autonomous AI agents with Effect-TS. Type-safe, composable, observable.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/tylerjrbuell/reactive-agents-ts",
        },
        {
          icon: "discord",
          label: "Discord",
          href: "https://discord.gg/498xEG5A",
        },
        {
          icon: "npm",
          label: "npm",
          href: "https://www.npmjs.com/package/reactive-agents",
        },
      ],
      favicon: "/favicon.svg",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      lastUpdated: true,
      // "Edit this page on GitHub" link — community PR funnel
      editLink: {
        baseUrl:
          "https://github.com/tylerjrbuell/reactive-agents-ts/edit/main/apps/docs/",
      },
      // Pagination is on by default in Starlight; explicit for clarity
      pagination: true,
      // Plugins — each chosen for engagement, integrity, or LLM-friendliness
      plugins: [
        // Build-time check for broken internal links. Fails the build if any
        // doc references a path that no longer exists. Free retention safety net.
        starlightLinksValidator({
          errorOnRelativeLinks: false, // Starlight uses many relative paths; only block hard breaks
          errorOnInvalidHashes: false, // anchors get added/renamed often; warn but don't block
        }),
        // Generates /llms.txt + /llms-full.txt — a flat plain-text view of
        // the entire docs site, optimized for LLM ingestion. On-brand for an
        // AI agent framework: the docs are themselves consumable by agents.
        starlightLlmsTxt({
          projectName: "Reactive Agents",
          description:
            "TypeScript AI agent framework — Effect-TS type-safe, 12-phase observable execution engine, 30 packages, runs on local Ollama through frontier APIs.",
          optionalLinks: [
            {
              label: "GitHub repo",
              url: "https://github.com/tylerjrbuell/reactive-agents-ts",
              description: "Source code, issues, releases",
            },
            {
              label: "Discord",
              url: "https://discord.gg/498xEG5A",
              description: "Community support and discussion",
            },
          ],
        }),
      ],
      customCss: ["./src/styles/custom.css"],
      head: [
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "https://analytics.reactiveagents.dev/script.js",
            "data-website-id": "4d58acb5-d15f-428c-8e0d-9f992fc5ba91",
            "data-domains": "docs.reactiveagents.dev",
          },
        },
        // Deep tracking — custom events for code copies, outbound clicks,
        // CTAs, tab switches, search queries, scroll depth, and the
        // "Was this helpful?" feedback widget. See public/umami-deep.js.
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "/umami-deep.js",
          },
        },
      ],
      sidebar: [
        {
          label: "Rax CLI",
          items: [
            { label: "Meet Rax CLI", link: "guides/cli-artisan/" },
            { label: "Command Reference", link: "reference/cli/" },
          ],
        },
        {
          label: "Getting Started",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Features",
          autogenerate: { directory: "features" },
        },
        {
          label: "Concepts",
          autogenerate: { directory: "concepts" },
        },
        {
          label: "Cookbook",
          autogenerate: { directory: "cookbook" },
        },
        {
          label: "API Reference",
          autogenerate: { directory: "reference" },
        },
      ],
    }),
  ],
});

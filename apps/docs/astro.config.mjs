import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import skills from "astro-skills";

export default defineConfig({
  // Docs now deploy to a custom domain at the root path.
  site: "https://docs.reactiveagents.dev",
  base: "/",
  legacy: { collections: true },
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
      ],
      favicon: "/favicon.svg",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      lastUpdated: true,
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

import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import skills from "astro-skills";

// Use a subpath base only when deploying to GitHub Pages.
// Set GITHUB_PAGES=true in CI to enable it.
const isGitHubPages = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  site: "https://tylerjrbuell.github.io",
  base: isGitHubPages ? "/reactive-agents-ts" : "/",
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
      editLink: {
        baseUrl:
          "https://github.com/tylerjrbuell/reactive-agents-ts/edit/main/apps/docs/",
      },
      lastUpdated: true,
      customCss: ["./src/styles/custom.css"],
      head: [
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "http://10.204.221.118:3000/script.js",
            "data-website-id": "4d58acb5-d15f-428c-8e0d-9f992fc5ba91",
          },
        },
      ],
      sidebar: [
        {
          label: "Rax CLI",
          items: [
            { label: "Rax as Artisan", link: "guides/cli-artisan/" },
            { label: "Quickstart", link: "guides/quickstart/" },
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

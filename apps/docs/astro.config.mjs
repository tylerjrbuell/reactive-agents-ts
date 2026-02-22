import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Use a subpath base only when deploying to GitHub Pages.
// Set GITHUB_PAGES=true in CI to enable it.
const isGitHubPages = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  site: "https://tylerjrbuell.github.io",
  base: isGitHubPages ? "/reactive-agents-ts" : "/",
  legacy: { collections: true },
  integrations: [
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
      customCss: ["./src/styles/custom.css"],
      sidebar: [
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

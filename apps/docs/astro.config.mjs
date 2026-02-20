import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
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
          href: "https://github.com/reactive-agents/reactive-agents-ts",
        },
      ],
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
          label: "Concepts",
          autogenerate: { directory: "concepts" },
        },
        {
          label: "API Reference",
          autogenerate: { directory: "reference" },
        },
      ],
    }),
  ],
});

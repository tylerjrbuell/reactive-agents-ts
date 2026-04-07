/**
 * Tailwind config — design tokens aligned with docs.reactiveagents.dev
 *
 * Brand: Geist Variable · violet #8b5cf6 · cyan #06b6d4
 * Background: #17181c (matches --sl-color-black in docs)
 */
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{html,js,svelte,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Surfaces (aligned with docs gray scale) ──────────────
        background:                "#17181c",  // --sl-color-black
        surface:                   "#17181c",
        "surface-dim":             "#17181c",
        "surface-container-lowest":"#0f1115",  // deepest
        "surface-container-low":   "#1a1d24",  // panel bg
        "surface-container":       "#24272f",  // --sl-color-gray-6
        "surface-container-high":  "#353841",  // --sl-color-gray-5
        "surface-container-highest":"#545861", // --sl-color-gray-4
        "surface-bright":          "#545861",
        "on-surface":              "#eceef2",  // --sl-color-gray-1
        "on-surface-variant":      "#c0c2c7",  // --sl-color-gray-2
        outline:                   "#888b96",  // --sl-color-gray-3
        "outline-variant":         "#353841",

        // ── Primary violet — RA brand (#8b5cf6) ────────────────
        // Replaces MD3 pastel #d0bcff with RA brand violet
        primary:                  "#8b5cf6",   // --ra-violet
        "primary-container":      "#7c3aed",   // --ra-violet-deep
        "primary-fixed":          "#c4b5fd",   // light variant for contrast
        "primary-fixed-dim":      "#a78bfa",
        "on-primary":             "#ffffff",
        "on-primary-container":   "#f5f3ff",
        "inverse-primary":        "#7c3aed",

        // ── Secondary cyan — RA brand (#06b6d4) ────────────────
        secondary:                "#06b6d4",   // --ra-cyan
        "secondary-container":    "#0891b2",
        "secondary-fixed":        "#a5f3fc",
        "secondary-fixed-dim":    "#67e8f9",
        "on-secondary":           "#ffffff",
        "on-secondary-container": "#f0fdff",

        // ── Tertiary amber — signal/warning color ──────────────
        tertiary:                 "#eab308",
        "tertiary-container":     "#ca8a04",
        "tertiary-fixed":         "#fef08a",
        "tertiary-fixed-dim":     "#fde047",
        "on-tertiary":            "#ffffff",
        "on-tertiary-container":  "#fefce8",

        // ── Error red ──────────────────────────────────────────
        error:                    "#ef4444",
        "error-container":        "#dc2626",
        "on-error":               "#ffffff",
        "on-error-container":     "#fef2f2",

        // ── Keep compatibility aliases ─────────────────────────
        "inverse-surface":        "#eceef2",
        "inverse-on-surface":     "#24272f",
      },

      fontFamily: {
        // Geist Variable — matches docs site (UI body)
        sans:     ["Geist Variable", "Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        headline: ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
        body:     ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
        label:    ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
        geist:    ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
        // Outfit — wordmark / section titles (local desk, not generic UI sans)
        display:  ["Outfit", "Geist Variable", "Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        // JetBrains Mono — data, metrics, code, trace
        mono:     ["JetBrains Mono", "ui-monospace", "Cascadia Code", "monospace"],
      },

      borderRadius: {
        DEFAULT: "0.25rem",
        sm:      "0.125rem",
        md:      "0.375rem",
        lg:      "0.5rem",
        xl:      "0.75rem",
        "2xl":   "1rem",
        full:    "9999px",
      },

      animation: {
        "sonar-pulse":  "ra-sonar-pulse 3s cubic-bezier(0, 0.2, 0.8, 1) infinite",
        "fade-up":      "ra-fade-up 0.25s ease-out",
        "slide-right":  "ra-slide-right 0.3s ease-out",
        "border-breathe": "ra-border-breathe 8s ease-in-out infinite",
      },

      boxShadow: {
        neural:        "0 0 24px rgba(139,92,246,0.06)",
        "neural-strong":"0 0 50px rgba(139,92,246,0.18)",
        "glow-violet": "0 0 20px rgba(139,92,246,0.35)",
        "glow-cyan":   "0 0 20px rgba(6,182,212,0.3)",
        "glow-amber":  "0 0 15px rgba(234,179,8,0.25)",
        "glow-error":  "0 0 15px rgba(239,68,68,0.25)",
      },

      backgroundImage: {
        "ra-gradient": "linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)",
        "ra-gradient-subtle": "linear-gradient(135deg, rgba(139,92,246,0.6) 0%, rgba(6,182,212,0.3) 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;

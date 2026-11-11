/**
 * Tailwind config — Cortex "Bench" tokens (spec:
 * wiki/Architecture/Design-Specs/2026-11-10-cortex-ui-modernization.md, section 6).
 *
 * Every colour reads a semantic `--cortex-*-rgb` channel token from
 * `src/app.css`, so both themes come from `:root` (light) vs `html.dark` and
 * opacity modifiers (`bg-primary/10`) keep working. The MD3 names below are
 * aliases onto the semantic tokens, kept for one release while the pages are
 * restyled (removed in step 8).
 */
import type { Config } from "tailwindcss";

type ColorFn = (opts: { opacityValue?: string }) => string;

/** A colour from a channel token, with Tailwind's opacity modifier. */
const tok = (name: string): string => `rgb(var(--cortex-${name}-rgb) / <alpha-value>)`;

/**
 * A text colour with an opacity floor. The muted-text opacity ladder
 * (`text-outline/40`, `text-on-surface/60`) failed WCAG AA in both themes
 * (spec audit A6). A numeric opacity below `floor` is raised to it, so the
 * faintest neutral text never drops under `--cortex-text-3` (the contrast
 * floor). Floors: on-surface (text) 0.67, on-surface-variant (text-2) 0.84,
 * outline (text-3) 1 — at each floor the mix is at least as strong as
 * text-3 itself (light, on canvas: 5.85 and 5.53 vs 5.46:1; dark is higher;
 * worst case on surface-3 is 5.02:1). Backgrounds and borders keep the
 * plain modifier.
 */
const textTok =
  (name: string, floor: number): ColorFn =>
  ({ opacityValue }) => {
    const channels = `var(--cortex-${name}-rgb)`;
    if (opacityValue === undefined) return `rgb(${channels})`;
    const n = Number(opacityValue);
    if (Number.isFinite(n)) return `rgb(${channels} / ${Math.max(n, floor)})`;
    return `rgb(${channels} / ${opacityValue})`;
  };

const WHITE = "rgb(255 255 255 / <alpha-value>)";

export default {
  content: ["./src/**/*.{html,js,svelte,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Surfaces (MD3 aliases → Bench surfaces) ─────────────
        background:                  tok("canvas"),
        surface:                     tok("canvas"),
        "surface-dim":               tok("canvas"),
        "surface-container-lowest":  tok("canvas"),
        "surface-container-low":     tok("surface-1"),
        "surface-container":         tok("surface-2"),
        "surface-container-high":    tok("surface-3"),
        "surface-container-highest": tok("line-strong"),
        "surface-bright":            tok("line-strong"),
        "on-surface":                tok("text"),
        "on-surface-variant":        tok("text-2"),
        outline:                     tok("text-3"),
        "outline-variant":           tok("line-strong"),

        // ── Primary = the agent (violet). Fills use accent-fill; text uses accent (textColor below).
        primary:                tok("accent-fill"),
        "primary-container":    tok("accent-fill"),
        "primary-fixed":        tok("accent"),
        "primary-fixed-dim":    tok("accent"),
        "on-primary":           WHITE,
        "on-primary-container": WHITE,
        "inverse-primary":      tok("accent-fill"),

        // ── Secondary = tools and data (cyan) ───────────────────
        secondary:                tok("io"),
        "secondary-container":    tok("io"),
        "secondary-fixed":        tok("io"),
        "secondary-fixed-dim":    tok("io"),
        "on-secondary":           tok("canvas"),
        "on-secondary-container": tok("canvas"),

        // ── Tertiary = needs attention (amber) ──────────────────
        tertiary:                tok("warn"),
        "tertiary-container":    tok("warn"),
        "tertiary-fixed":        tok("warn"),
        "tertiary-fixed-dim":    tok("warn"),
        "on-tertiary":           tok("canvas"),
        "on-tertiary-container": tok("canvas"),

        // ── Error = failed (red) ────────────────────────────────
        error:                tok("bad"),
        "error-container":    tok("bad"),
        "on-error":           tok("canvas"),
        "on-error-container": tok("canvas"),

        "inverse-surface":    tok("text"),
        "inverse-on-surface": tok("surface-2"),
      },

      textColor: {
        "on-surface":         textTok("text", 0.67),
        "on-surface-variant": textTok("text-2", 0.84),
        outline:              textTok("text-3", 1),
        // Violet text is the accent (6.5:1 dark, 6.6:1 light), not the button fill.
        primary:              tok("accent"),
      },

      fontFamily: {
        // Geist Variable — matches docs site (UI body)
        sans:     ["Geist Variable", "Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        headline: ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
        body:     ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
        label:    ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
        geist:    ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
        // Wordmark and titles: Geist 600 (owner decision 2; Outfit retired).
        display:  ["Geist Variable", "Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        // JetBrains Mono — data, metrics, code, trace
        mono:     ["JetBrains Mono", "ui-monospace", "Cascadia Code", "monospace"],
      },

      // One layer scale (spec section 6): z-sticky … z-tooltip.
      zIndex: {
        sticky:  "var(--cortex-z-sticky)",
        nav:     "var(--cortex-z-nav)",
        drawer:  "var(--cortex-z-drawer)",
        modal:   "var(--cortex-z-modal)",
        toast:   "var(--cortex-z-toast)",
        tooltip: "var(--cortex-z-tooltip)",
      },

      borderRadius: {
        DEFAULT: "0.25rem",
        sm:      "0.125rem",
        md:      "0.375rem",
        lg:      "0.5rem",
        xl:      "0.75rem",
        "2xl":   "1rem",
        full:    "9999px",
        // Bench radius by hierarchy.
        chip:    "var(--cortex-r-chip)",
        ctl:     "var(--cortex-r-ctl)",
        panel:   "var(--cortex-r-panel)",
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

/**
 * Tailwind config — Cortex "Bench" tokens (spec:
 * wiki/Architecture/Design-Specs/2026-11-10-cortex-ui-modernization.md, section 6).
 *
 * Every colour reads a semantic `--cortex-*-rgb` channel token from
 * `src/app.css`, so both themes come from `:root` (light) vs `html.dark` and
 * opacity modifiers (`bg-accent/10`) keep working. The MD3 aliases
 * (`surface-container-low`, `on-surface`, `primary`, …) were removed in step 8.
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
 * floor). Floors: text 0.67, text-2 0.84, text-3 1 — at each floor the mix is at least as strong as
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

export default {
  content: ["./src/**/*.{html,js,svelte,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      // The semantic tokens by their own names (spec section 6): `bg-surface-1`,
      // `border-line`, `text-text-2`, `text-accent`, `bg-accent-fill`, `text-io`,
      // `text-ok` / `text-warn` / `text-bad`.
      colors: {
        canvas:        tok("canvas"),
        "surface-1":   tok("surface-1"),
        "surface-2":   tok("surface-2"),
        "surface-3":   tok("surface-3"),
        line:          tok("line"),
        "line-strong": tok("line-strong"),
        text:          tok("text"),
        "text-2":      tok("text-2"),
        "text-3":      tok("text-3"),
        accent:        tok("accent"),
        "accent-fill": tok("accent-fill"),
        io:            tok("io"),
        ok:            tok("ok"),
        warn:          tok("warn"),
        bad:           tok("bad"),
      },

      textColor: {
        text:     textTok("text", 0.67),
        "text-2": textTok("text-2", 0.84),
        "text-3": textTok("text-3", 1),
      },

      fontFamily: {
        // Geist Variable — matches docs site (UI body)
        sans:     ["Geist Variable", "Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        // Titles: Geist 600 (owner decision 2; Outfit retired).
        headline: ["Geist Variable", "Geist", "ui-sans-serif", "sans-serif"],
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
        "fade-up":      "ra-fade-up 0.25s ease-out",
        "slide-right":  "ra-slide-right 0.3s ease-out",
      },

      boxShadow: {
        neural:        "0 0 24px rgba(139,92,246,0.06)",
        "neural-strong":"0 0 50px rgba(139,92,246,0.18)",
      },
    },
  },
  plugins: [],
} satisfies Config;

---
"@reactive-agents/cortex": minor
---

Cortex UI foundation for the "Bench" design (steps 1 and 2 of the modernization plan).

- One semantic token layer drives both themes. Light mode no longer depends on a block of `!important` overrides, so panels, inputs and the chat composer read correctly in light mode, and muted text keeps WCAG AA contrast in both themes.
- New Settings · Motion option: follow the system's reduced-motion setting or reduce motion in Cortex regardless.
- Text fonts are bundled (no Google Fonts request for Geist or JetBrains Mono). The wordmark is now "Cortex" in Geist, and the neural mark is one shared component (logo, Beacon empty state and favicon).
- Costs use one format everywhere (`<$0.0001` instead of `$0.0000` for tiny amounts), and Lab "last used" times read like the rest of Cortex ("5 minutes ago").
- The ambient orbs now appear only on Beacon and the empty Runs page.
- A component kit (buttons, chips, badges, status, panels, page header, tabs, form fields, empty states, overlays, meter, entropy line) for the page-by-page restyle that follows.

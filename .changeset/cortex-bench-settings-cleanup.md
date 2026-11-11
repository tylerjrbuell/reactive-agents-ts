---
"@reactive-agents/cortex": minor
---

Cortex Settings and model page in the "Bench" design (steps 7 and 8 of the modernization plan), and the old visual layer removed.

- **Settings** has a section nav (Defaults, Providers, Notifications, Appearance, Storage, Developer, About) and one row per setting. API keys show as badges ("OpenAI", "Anthropic missing"), the copy says keys come from the server's environment and that Cortex needs a restart after editing `.env`, and a provider without its key reads "(key missing)" in the Defaults picker. The model hint no longer tells you to add a key "in Settings".
- **Appearance · Theme** can follow the system setting (and tracks it live), or pin dark or light. Theme and Motion apply at once; **Save settings** no longer writes them, so saving the form can't undo the top-bar theme switch.
- **About** shows the neural mark and the Cortex version. `GET /api/health` now reports the Cortex package version instead of a fixed `0.1.0`.
- The **model page** uses the same rows: a capability grid (context window, max output, tool calls, thinking), the remaining values, a note when the values are fallback defaults that also says how many recorded runs used the model and the largest run's tokens, and recent runs by name with their status.
- **Fill run variables** (Lab Run with `{{name}}` variables) uses the kit dialog and fields: sentence-case labels, "(optional)" instead of an asterisk, and no crash when the dialog opens.
- Material Symbols is gone: no icon font loads from Google Fonts, and every icon is inline SVG. The MD3 colour aliases, the legacy `--cortex-*` names, `gradient-border`, the gel progress bars, `hover-lift`, the old sonar rings, the grid behind every page, the neon `kbd` chips and the old gradient text class are removed, along with eight unused components.
- Runs fits narrow windows (Strategy, Steps and Time hide under 960px instead of clipping the table), and an empty chat no longer clips the top of its hero on short windows.

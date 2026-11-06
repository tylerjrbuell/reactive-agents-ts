---
"@reactive-agents/runtime": minor
---

`.withTools()` gains explicit tool control. No default changes.

- **`disclosure: "all" | "index" | "discover"`** sets how the permitted tools are shown to the model. It never changes which tools are permitted. `"all"` sends every permitted schema on every turn. `"index"` and `"discover"` use today's pruned modes. Precedence, highest first: `.withTools({ disclosure })`, then the deprecated `.withHarness({ lazyDisclosure, toolDiscovery, toolIndex })` switches, then the `RA_LAZY_TOOLS` / `RA_TOOL_DISCOVERY` / `RA_TOOL_INDEX` env flags, then `contextProfile.toolDisclosureMode`, then the tier default. Every run records the resolved mode and the layer that set it on `run-started.config.disclosure` (`{ mode, source }`). With `disclosure` unset, a run behaves exactly as before.
- **`builtins: "<name>"`** is now accepted as shorthand for `builtins: ["<name>"]`, and both forms give the same permitted set. A name is a toolset from `BUILTIN_TOOLSET_ALIASES` in `@reactive-agents/tools` (for example `"research"` or `"web"`), `"all"`, or a built-in tool name. A single name that matches none of these throws `ToolsOptionError`. Array entries behave as before. To keep file tools inside one directory, set `workspace:` (for example `{ builtins: "read", workspace: "./project" }`).
- **Build notice.** `build()` now logs one warning when a tools-enabled agent ends up with zero capability tools. The warning names the toolsets that would fix it.
- **Docs fix.** The JSDoc no longer says that built-ins you have not opted in stay "callable by name" or discoverable. They are not listed, not discoverable and not callable. The JSDoc for `adaptive` now states that the relevance classifier permits the built-ins it marks relevant.

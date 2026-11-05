---
type: audit
status: complete
created: 2026-11-04
tags: [harness, meta-tools, determinism, overhead]
---

# Meta-tool inventory: state the harness already holds (2026-11-04)

Question (user, 2026-11-04): which meta-tools make the model call for state the harness already tracks, so reliability rests on the model remembering to act rather than on determinism? Zero-token audit of `kernel/state/kernel-constants.ts` `META_TOOLS`, the build defaults (`runtime/src/builder/build-effect/runtime-construction.ts:320-345`, `builder/withers/tools.ts:205-240`) and registration (`kernel/capabilities/act/tool-capabilities.ts`).

| Tool | Default | What it returns | Harness already holds it? | Verdict |
|---|---|---|---|---|
| `final-answer` / `task-complete` | on | the terminal claim | n/a (the model's own claim) | keep; the exit gate judges it deterministically |
| `recall` | on | stored overflow data by key | the store, but only the model knows which key it needs | keep (load-bearing: overflow previews instruct `recall(<key>)`) |
| `find` | on only with documents | retrieval over docs / memory / web | no (search) | keep |
| `brief` | off (opt-in) | tools, docs, skills, memory stats, context pressure, entropy grade | yes | already off for this reason (comment at runtime-construction.ts:320) |
| `pulse` | off (opt-in) | entropy grade, trajectory, loop score, tool success rate | yes | already off for this reason |
| `todo` | off (opt-in) | advisory checklist | partly: requirement rows come from the run contract; plan-execute plan rows now come from plan state (D9 P7, `99ead178d`) | keep opt-in; no harness nudge to call it |
| `checkpoint` | off (opt-in) | save/retrieve named findings across compaction | no (model-chosen content) | keep opt-in |
| `context-status` | never registered | iteration, tokens, tools called, pending required tools | yes | the framework never registers it (no kernel wiring); it is a public export of `@reactive-agents/tools` (`contextStatusTool`, `makeContextStatusHandler`), so consumers may register it themselves. Not dead by repo rule; leave as is (removal would be a public-API change) |
| `discover-tools` | on when `toolDiscovery` resolves true (default `true` unless a harness profile or `RA_TOOL_DISCOVERY`/`RA_LAZY_TOOLS` says otherwise) | hidden tool schemas on demand | the catalog, yes; which tool the model wants, no | open: the 2026-08-11 vetting called it pure cost; it is still default-on. Needs a measured ablation (lift rule) before any default change |

Findings:

1. The principle already governs the defaults: the two pure-introspection tools (`brief`, `pulse`) are off by default with exactly this rationale, and the information they carry is pushed through the per-turn `Guidance:` section and the exit gate's outstanding list instead.
2. The one remaining overhead candidate is `discover-tools` (measure). It is not a model-must-remember reliability risk; it is a schema-token cost. `context-status` costs nothing by default (never registered).
3. With D9 P7, the strongest reason to call `todo` (making a plan visible) is now covered by harness state for plan-execute. For the reactive loop the requirement rows already show what the task asked for.

Next (not started): `discover-tools` ablation on H3 (ablation-warden, lift rule) before changing its default. No code change is warranted from this inventory alone.

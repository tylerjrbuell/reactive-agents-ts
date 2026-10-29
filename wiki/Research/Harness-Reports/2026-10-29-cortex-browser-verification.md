---
type: harness-report
status: complete
created: 2026-10-29
tags: [cortex, browser, playwright, verification, checklist, sub-agents, beacon]
---

# Cortex browser verification (2026-10-29)

Closes the "NOT VERIFIED" browser steps in `wiki/Research/Audit-Reports-2026-10-29/plans-vs-shipped.md`. Method: Playwright MCP driving a local Cortex against local Ollama models. Screenshots are in `.playwright-mcp/` (a scratch directory, not committed; filenames below are exact). This report is the record of what was and was not checked. Console logs: `.playwright-mcp/console-2026-10-28T*.log`.

## Verified

| Area | What was observed | Screenshots |
|---|---|---|
| Plan card, plain run | "Goal checks" showed 1/1 on a plain (no sub-agent) run; survives reload | `plain-live0/1/2.png`, `plain-final.png`, `plain2-live0.png`, `plain2-final.png`, `plancard-light.png`, `plancard-reload.png`, `v2-plain-view.png`, `v2-plain2-live.png`, `v2-plain2-reload.png` |
| Sub-agent blocks | Delegated agents render as blocks; parent shows 1/1 goal check with children listed; expand works; survives reload | `sub-live0..4.png`, `sub-final.png`, `v2-sub-live.png`, `v2-sub-expanded.png`, `v2-sub-reload.png`, `v3-collapsed-now.png`, `v3-expanded-inprogress.png`, `v3-final.png`, `v2-v3-live.png`, `v2-v3-reload.png` |
| Trace drawer | Overview, Steps and Run trace tabs; `/export`; overlay mode below 1100px; docked at 1440px; dark and light | `drawer-0-reload.png`, `drawer-1000-{dark,light}-{Overview,Steps,Runtrace}.png`, `drawer-1440-{dark,light}-{Overview,Steps,Runtrace}.png`, `drawer-export.png` |
| Beacon | Sub-agent nesting present after reload; layout deterministic across reloads; dragged position persisted | `beacon-0.png`, `beacon-1-auto.png`, `beacon-2-mid.png`, `beacon-3-done.png`, `beacon-load0.png`, `beacon-reload1.png`, `beacon-reload2.png`, `beacon-after-drag-reload.png`, `v2-beacon-1.png`, `v2-beacon-2-reload.png` |
| Cost display | Shows `$0.0000` for local models | `cost-live0.png` |
| Model pickers | Live where a provider is reachable (ollama, openai); groq showed the built-in-list fallback note | `v2-picker-ollama.png`, `v2-picker-openai.png`, `v2-picker-groq.png` |
| Settings | Save works with documents present; chat settings toggle | `settings-0-open.png`, `settings-1-toggled.png`, `settings-2-saved.png`, `settings-checklist-toggle.png`, `settings.png`, `v2-settings.png`, `v4-modal.png`, `v4-modal-metatools.png`, `v6-setting.png` |
| `/docs` with a URL | A URL document was added and found by the agent | `docs-live0.png`, `docs-final.png`, `docs2-0-typed.png`, `docs2-1-added.png`, `docs2t-live0.png`, `docs2t-live1.png`, `docs2t-final.png` |
| Context ring | Persists between runs and across reload | `v7-ctx-idle.png`, `v7-ctx-reload.png` |
| `/models` page | Provider/model link opens the model page; focus state; dark and light | `v7-model-focus.png`, `v7-model-dark.png`, `v7-model-light.png` |
| Conversation to-do dock | Dock shows the list, accepts edits, persists across reload, carries into turn 2, light theme | `v8-dock-open.png`, `v8-dock-live.png`, `v8-dock-edited.png`, `v8-dock-reload.png`, `v8-dock-turn2.png`, `v8-dock-light.png`; plan-card to-do: `todo-live0/1/2.png`, `todo-live-0/1.png`, `todo-final.png`, `todo-reload.png`, `todo-reload-dark.png`, `plancard-light-todo.png` |

## NOT verified

- Dock at a 420px viewport. `v8-dock-mobile.png` exists, but the viewport width used was not confirmed to be 420px, so it is not claimed.
- Cost display for a non-zero price or an unknown price ("—", "≥ $x"). No paid-provider credit was available; only the local `$0.0000` path was seen.
- Hosted-provider pickers with a key beyond openai (anthropic, gemini, xai live listings); groq was seen only in fallback.
- Strategy switching reactive to adaptive to plan-execute to reflexion in the browser (Plan 1 Task 2 Step 3).
- Pre-migration empty state of the Run trace tab; all three `/export` formats individually; Copy and Download of the trace.
- TUI checklist under a real TTY (separate from this report; still open).
- Failed-child "≥ $x" rendering in the browser.

## Findings worth keeping

- To-do statuses did not move on `cogito:14b` (n=1) with "Keep to-do list current" guidance on. One run on one model: no conclusion about guidance effect, which stays opt-in and unmeasured (V5 verdict pending).
- The groq picker fell back to the built-in list with the note, as designed when no key is configured.
- Evidence is single-run, local-model, one machine. It shows the UI paths work, not that they work under load or on other models.

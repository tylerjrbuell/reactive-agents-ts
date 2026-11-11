---
type: design-spec
status: approved
created: 2026-11-10
updated: 2026-11-10
tags: [cortex, ui, design-system, ui-core, a11y, chat]
---

# Cortex UI modernization: audit and "Bench" design proposal (revision 2, for sign-off)

Phase 1 of 3 (proposal, then owner approval, then page-by-page rebuild with chat first, then live QA). No product code changed in this phase. Mockups are static HTML files built on the proposed tokens; their paths are listed in [Evidence](#evidence).

**Revision 2 (2026-11-10).** The owner approved Bench with changes: "Try to incorporate some of the old style and image elements somehow so it still feels like cortex but overhauled and modernized." Revision 1 removed the orbs, the grid, the glow and the gradient wordmark. Revision 2 brings each of them back in a quieter form with a fixed place and a fixed strength ([section 5](#5-identity-layer)). It also records the owner's structural decisions: split the frozen giants before restyling ([section 9](#9-migration-order), step 0), Board as Beacon's default view with the current canvas kept as Field, and the run-view Chat tab replaced by "Continue in chat". The amended warden invariant 7 is in [section 14](#14-warden-invariant-7-amendment).

## 1. Summary

Cortex works, but it looks like five products. Each page has its own header style, its own text sizes and its own way to show status. Light mode exists only because of a 110-line block of `!important` overrides. Agent answers in chat are set in 12px monospace. About 240 labels are uppercase mono at 9 to 10px, and most of them fail WCAG AA contrast.

The proposal keeps the Cortex brand: Geist and JetBrains Mono, violet and cyan, the neural logo and the docs-aligned dark base. It changes how the brand is applied:

1. **One semantic token layer** (`--cortex-canvas`, `--cortex-surface-1..3`, `--cortex-text..text-3`, plus meaning colors). Both themes come from these tokens, so the light-mode hack can be deleted.
2. **Color means something.** Violet marks the agent (thinking, primary action). Cyan marks tools and data. Green, amber and red are outcomes. Nothing else is colored.
3. **The signal rail means live.** A thin violet-to-cyan gradient moves only on things that are running now: a chat turn, a run row, a Beacon card or a progress meter. Live cards add the old gradient edge and glow; nothing at rest glows.
4. **Cortex keeps its own look, quieter (revision 2).** The neural mark, the ambient orbs, the engineering grid, the sonar ring and the entropy line stay, each at a fixed low strength and in a fixed place: orbs on Beacon and page-level empty states, the grid behind page headers and in Beacon Field, the mark on the bar and on empty and first-run states. The faintest text token over any of them keeps WCAG AA (worst case 4.8:1 dark and 4.65:1 light, on a Field grid dot), and each has a reduced-motion fallback.
5. **Words in Geist, machine values in Mono.** Chat prose is 15px Geist with a 68ch measure. Mono is kept for ids, token counts, costs, tool names and code. Labels use sentence case.
6. **One status vocabulary** for runs, turns, sub-agents and Beacon: running, waiting on you, finished, failed, stopped, idle.

Chat is the reference page. Its components become the kit that the other pages use.

## 2. Method

- A private stack ran on :4417 (server, cwd and SQLite in the session scratchpad) and :5217 (UI). The owner's :4321/:5173 stack was not touched. Both stacks were stopped at the end of the session.
- Every route was visited, with text snapshots (Playwright accessibility tree and `innerText` dumps) and screenshots in dark and light at 1280x800, plus dark at 1920x1080.
- Chat states covered: empty, finished, finished with sub-agents and a tool group (seeded session), sub-agent drawer, pre-flight failure (missing model), mid-run, user stop, and a client disconnect mid-run.
- A successful live tool run could not finish in this session. Ollama was serving other models (`cogito:8b`, `qwen2.5-coder:7b`, `llama3.2:3b`) and `qwen3:4b` sat in its queue for over 1m39s. The seeded session covers the tool-group and sub-agent rendering.
- A static scan of all 98 `.svelte` files under `apps/cortex/ui/src` counted ad-hoc values. Contrast was computed with the WCAG relative-luminance formula.
- `svelte-check` reported 0 errors and 9 warnings.

## 3. Audit

### 3.1 Cross-cutting findings (with numbers)

| # | Finding | Evidence |
|---|---|---|
| A1 | **Light mode is a patch layer.** Tailwind colors are static hex values (`tailwind.config.ts:14-65`), so `app.css:380-489` overrides about 40 class patterns with `!important`, including substring selectors like `[class*="text-on-surface"]` and inline-style selectors like `[style*="background-color: #17181c"]`. Any new class falls through. Visible seams: the white input box inside the Beacon prompt pill and the chat composer in light mode (screens `beacon-light-1280`, `chat-finished-light-1280`). | app.css:380-489 |
| A2 | **Three theming systems at once:** `--cortex-*` vars (824 uses), Tailwind MD3 names (`text-on-surface/80` and similar, 298 uses), and `slate-*` + `dark:` pairs (688 `dark:` variants, 174 `text-slate-*`). | scan |
| A3 | **17 phantom CSS variables** are referenced but never defined, so their hard-coded fallbacks always win and do not change with the theme. Examples: `--color-secondary` (fallback `#7ee3c3`, a mint outside the palette) in `ChatTodoDock.svelte:151-182`; `--color-error/-warning/-primary` in `ChatGoalBar.svelte:172-202` and `ChatPlanCard.svelte:106`; `--surface-1/-2`, `--text-1/-2`, `--border`, `--danger`, `--success`, `--primary` in `ApprovalPanel.svelte:123-140` and `InteractPanel.svelte:192-215` (dark `#2a2a33` surfaces also render in light mode); `--cortex-primary` in `HighlightedField.svelte:144-145`; `--cortex-warning` in `ChatDocumentFailures.svelte:16`; `--ra-red`, `--ra-amber-strong`, `--cortex-surface-high` in `AgentConfigPanel.svelte:1005,1096,2048`; `--ra-primary` in `ChatTokenUsage.svelte:50` and `TokenCounter.svelte:16`. | grep of `var(--…)` against definitions |
| A4 | **Type scale drift:** 18 distinct arbitrary sizes (`text-[6px]` … `text-[28px]`, 1,033 uses) plus 8 Tailwind sizes. 327 uses are at 9px or smaller (`text-[9px]` 244, `[8px]` 49, `[7px]` 20, `[6px]` 4, `[6.5px]` 1). Worst files: `AgentConfigPanel.svelte` (164), `routes/lab/+page.svelte` (86), `ToolWorkshop.svelte` (79). | scan |
| A5 | **All-caps mono labels everywhere:** 244 `uppercase` and 181 `tracking-*` (for example the CONVERSATION / USER / ASSISTANT labels at `ChatPanel.svelte:834,920`, `STATUS: SETTLED` at `BeaconNode.svelte:97`, and the uppercase wordmark at `+layout.svelte:321`). | scan |
| A6 | **Contrast failures:** the muted-text opacity ladder fails AA on the dark canvas: `text-outline/30` 1.57:1, `/40` 1.88, `/50` 2.27, `/60` 2.70, `/70` 3.23 (about 240 uses, mostly at 9 to 10px). In light mode, `[class*="text-outline/"]` measures 3.14:1, cyan `#06b6d4` text measures 2.32:1 (the ASSISTANT label, links, "Connected"), and the user label measures about 2.05:1 on its bubble. | computed |
| A7 | **Chat prose is monospace:** the transcript wrapper sets `font-mono text-[12px]` (`ChatPanel.svelte:861`), so every answer reads as code at about 95 characters per line. | ChatPanel.svelte:861 |
| A8 | **Icons depend on the network.** Material Symbols and a second copy of JetBrains Mono and Outfit load from Google Fonts (`app.html:8-18`), while `app.css:9-13` already imports them from fontsource. Offline, every icon renders as its ligature word. Even online, the ligature text leaks into accessible names and copied text: buttons announce as "add", "tune", "edit", "delete", "cloud ollama", "memory qwen3:4b", "keyboard_arrow_down", and the page text reads `radar Beacon chat Chat …` (244 icon uses). | app.html:8-18, snapshots |
| A9 | **Nested interactive elements:** each chat session row is `role="button"` and contains the tune, rename and delete buttons (`ChatSessionList.svelte:313` containing 333-343). `AgentCard.svelte:210` puts `role=button` on a `<p>` (svelte-check warning). | |
| A10 | **Six overlay layers with ad-hoc z-index:** Tooltip `z-[99999]` (`Tooltip.svelte:186`), ConfirmModal / ParamFill / WorkspacePicker / session modal `z-[200]`, AgentExportModal and ToastContainer `z-[100]`, CommandPalette `z-[80]`, Toast `z-[60]`. Six modal implementations, each with its own scrim. | scan |
| A11 | **Five cost formatters on one data type.** The canonical one is `lib/format-cost.ts:7-8` (`<$0.0001`), but `VitalsStrip.svelte:117` uses `<$0.001`, `RunOverview.svelte:220` inlines its own, `routes/runs/+page.svelte:469,699` print `$0.0000`, and `lib/goal-view.ts:141` defines a second `formatUsd`. The run view shows `<$0.001` and `<$0.0001` for the same run. | |
| A12 | **Decoration as default:** ambient orbs (`CortexDeskShell.svelte:18-25`), a 32px grid background (`app.css:113-131`), `gradient-border` panels (15 uses), glow shadows, a gradient send button, the gradient wordmark, gradient scrollbar thumbs (`app.css:725-730`) and `hover-lift` cards. On a page where everything glows, the running agent does not stand out. | |
| A13 | **D3 colors are hard-coded per theme** (`SignalMonitor.svelte:42-43,66-67`), and light mode is fixed up through `rect[fill="#0c0e12"]` attribute selectors (`app.css:462-463`). | |
| A14 | **Radius drift:** 10 radius variants (`rounded` 183, `-lg` 124, `-md` 91, `-full` 56, `-xl` 29, plus `[14px]`/`[18px]`), none tied to hierarchy. | scan |
| A15 | **Focus:** `focus-visible:` appears in only 6 files. 45 `outline-none` / `focus:outline-none` remain, 11 of them in `routes/lab/+page.svelte`, and several inputs have no replacement ring. | scan |
| A16 | **svelte-check warnings (9):** `state_referenced_locally` in `VitalsStrip.svelte:33`, `PromptLibrary.svelte:26`, `WorkspaceField.svelte:24`, `ChatTraceDrawer.svelte:47`; `a11y_autofocus` in `VitalsStrip.svelte:239`; `a11y_no_noninteractive_element_to_interactive_role` in `AgentCard.svelte:210`; 3 unused `.acp-chip` selectors in `AgentConfigPanel.svelte:1819`. | svelte-check log |

### 3.2 Information architecture

- **Naming drift for one concept.** The nav says "Trace", the page title says "Execution Trace" (`routes/runs/+page.svelte:404`, with one accented word), the palette says "Execution Trace", and the route is `/runs`. The run view breadcrumb reads "Beacon / 01M740X6…" even when you arrive from Runs.
- **Dead end:** `/run` is a placeholder page with a single link to `/runs` (`run-hub` screens).
- **Lab** opens with four stat cards that report UI state: "Active tab: BUILDER", "Builder mode: ad-hoc", "Skill roots: 0". Its "Agents" tab is `#gateway` in the URL and "GATEWAY" in the stat card (`routes/lab/+page.svelte:763-767`).
- **Two chat UIs:** the run view's Chat tab (`RunChatTab.svelte`, 431 LOC) is a second composer. It has its own placeholder, an "Enable tools (ReAct)" checkbox and none of the quick-bar, slash-menu or queue behavior.
- **Beacon identifies agents by ULID** (`01M740Q1WYW1YWP4AKDYYXYMQ1`). Two different runs show the same name, and the free-drag canvas carries little information per pixel.

### 3.3 Per-page findings

**Beacon (`/`)**
- Node labels show the raw agent id, `STATUS: SETTLED` in 9px caps, and a token count. There is no goal, no current step and no last answer.
- The prompt bar shows the provider ("anthropic") with no model, and the input text is monospace.
- "DRAG TO REARRANGE" sits under the prompt bar. "Active agents 0/2" duplicates the status filter.
- Light mode: the input renders as a white rectangle inside the pill (A1).

**Chat (`/chat`)**: the reference page; full list in 3.4.

**Runs (`/runs`)**
- Two empty panels ("Pending approvals 0", "Pending interactions 0") always take about 170px above the list.
- The stats strip and the status filter count the same things twice. Cost shows `$0.0000` for runs that cost something (A11).
- The subtitle "LIVE LIST · BULK DELETE · PINS STAY ON TOP" describes features instead of the content.
- **Stopped and disconnected chat runs stay "● LIVE" forever** (B3).

**Run view (`/run/[runId]`)**
- At 1280 the vitals strip overflows: the "Tools: index · profile" chip is cut off.
- The page splits into three vertical bands (vitals, main, bottom panel), and the bottom panel takes about 40% of the height while showing one sentence.
- The bottom tabs are plain buttons (`RunDetail.svelte:631-639`), while the trace tabs are a real tablist (`TracePanel.svelte:154-158`).
- The Summary says "no entropy data" while the vitals show η 0.25 and the Signal tab shows 1 entropy sample (B7).
- "Replay (1 events)" (`RunDetail.svelte:487`).
- The Events tab has two filter chips both labelled "Emitted 4" (B8). Most event previews are raw JSON.

**Lab (`/lab`)**
- Builder: section chips wrap into two rows, with Agent Name, Provider and Model below the fold.
- The Save & Run button is a gradient. The page text sizes are mostly 8 to 10px (A4).
- Tools tab empty-state text runs together: "Select a tool to inspect and test.Need a new one?" (`ToolWorkshop.svelte:1007`).
- Prompts and Agents empty states are fine in content but inconsistent in form.

**Settings (`/settings`)**
- The model field hint says "add ANTHROPIC_API_KEY in Settings" while the user is on Settings, and keys can only come from the environment.
- Section titles are uppercase gradient-violet; focus styles are removed (`settings/+page.svelte:225,294,320,336`).

**Model page (`/models/[provider]/[...model]`)**
- This is the cleanest page today (sans text, plain rows). It should be the template for the layout.
- Data conflict: `mimo-v2.6` shows a context window of 4,096 here, while chat shows `context 516 / 32.8k` for the same model (G5).
- Recent runs list raw agent ids and are not links.

### 3.4 Chat: findings and observed behavior bugs

Rendering:
- Monospace prose (A7). Both user and assistant turns sit in bordered cards with uppercase role labels.
- The model and token meta sits on the assistant label line, and a per-call token bar renders as a small unlabeled gradient square.
- Opening a session lands mid-thread with "Jump to latest" showing instead of at the latest turn (`chat-finished-*` screens; first load of the seeded session).
- **Sub-agent card names collapse to "s" and "do…"** when the card carries a failed or abstained status icon and the "· 1 failed" suffix at 1280 (`chat-subagents-dark-1280`). The fix is a minimum name width.
- The sub-agent drawer covers the top nav with no scrim. In the seeded data the failed child shows a "failed" summary but no ending note. The seed may lack `runFailed`; check this with a live sub-agent failure in Phase 3.
- A finished seeded turn still reads `~864 ~370 (estimated while streaming)`. This is likely seed data, but the UI should never show the streaming estimate after completion.

Behavior (these are bugs, not styling; each needs a pin before the rebuild):
- **B1, pre-flight failure loses the message.** On a session whose model does not exist, sending "What is 2+2?" removes the user turn: the transcript goes back to the empty state, the composer is empty, and a banner shows `LLMError: Model "no-such-model:1b" not found locally…`, class prefix included (logged at `ui/src/lib/stores/chat-stream.ts:287`). The message should stay in the thread with a failed ending and a fix action ("Pull model" or "Pick another model").
- **B2, a client disconnect leaves a blank turn.** Navigating away mid-turn persists an assistant row with `content: ""` and no `trace.outcome`. On reload it renders as an icon-only "Did not finish" with no cause and no Retry, while a user Stop renders "stopped" with Retry. It needs an `interrupted` ending with a cause and Retry (server: chat stream path; see G3).
- **B3, stopped and disconnected runs never close.** `/api/runs` keeps `01M746B10HRN…` and `01M7466TPJYK…` as `live` with 0 iterations long after Stop. Runs and the nav live count would show phantom live runs.
- **B11, no "waiting on model" state.** A `qwen3:4b` turn showed "Thinking" with `↑0 ↓0` for 1m39s while Ollama was busy with other models. The UI cannot tell queued or loading from thinking (G3).

### 3.5 Responsive (1280 and 1920)

- At 1920 most pages stretch edge to edge. Runs rows run 1,860px wide, run-view panels spread, and chat assistant cards hit about 95ch while user bubbles hug the right edge far from the answer.
- At 1280 the run-view vitals strip clips, Beacon stat cards crowd the filter bar, and Lab sections wrap into two chip rows.
- There is no max content width anywhere except Settings (976px).

## 4. Design principles ("Bench")

Cortex is an instrument bench for agents: a place where you set an agent up, watch it work, and inspect what it did. The principles follow from that.

1. **Live moves; the brand breathes.** Fast or directional motion (the flowing rail, running dots, the sonar ring, flowing Field links, the live glow) means "running now" and appears nowhere else. The identity layer may move only slowly and in place: orb drift (48 to 64s) and the hero mark's twinkle (7s). Content at rest is still. Reduced motion stops all of it (section 5).
2. **Color carries meaning.** Violet is the agent, cyan is tools and data, green/amber/red are outcomes. Decorative color is limited to the identity layer at the fixed strengths in section 5: orbs, grid, the mark, and gradient text at 22px or more. Gradient edges and glows mean live.
3. **Read like prose, inspect like data.** Answers and narration are 15px Geist at a 68ch measure. Numbers, ids and tool names are 11px JetBrains Mono, tabular.
4. **Every number has one format.** Cost, tokens, durations and times each go through one formatter shared from ui-core.
5. **Every state says what to do next.** Empty, failed, stopped, interrupted and waiting states name the cause and offer the fix (Set workspace, Pull model, Retry, Answer).
6. **Density with hierarchy, not with size.** Rows stay compact, but no text goes under 11px. Hierarchy comes from weight and the three text tokens, not from 7px labels.
7. **Accessible by construction.** Icon buttons need a label; icons are `aria-hidden` SVG; tabs use `role=tablist`; there is one focus ring; text-3 is the contrast floor.

What changed between revisions. Revision 1 cut the ambient orbs and the gradient wordmark as template moves that compete with the live rail. The owner's review showed the cost: without them Cortex reads as a generic dashboard. Revision 2 keeps them, but the conflict with the rail is solved by placement and strength rather than removal. Orbs never sit behind dense content, nothing at rest glows, and the gradient wordmark appears only at hero size. Both revisions drop the "eyebrow label" pattern over each section, because it was the uppercase-caption habit again.

## 5. Identity layer

Revision 2. These are the elements that make Cortex look like Cortex today. They were inventoried from `apps/cortex/ui/static/favicon.svg`, `src/app.css`, `CortexDeskShell.svelte`, `routes/+layout.svelte`, `routes/+page.svelte`, `BeaconCanvas.svelte`, `BeaconNode.svelte`, `AgentCard.svelte` and `SignalMonitor.svelte`. `src/assets` does not exist, and `static/` holds only `favicon.svg`; there are no raster illustrations. The "imagery" is the neural mark, drawn three times as inline SVG (favicon, header logo, Beacon empty state).

The side-by-side sheet is `mockups/identity.html` (old element on the left, reproduced from the shipped CSS on its dark base; Bench form on the right; rules beside each).

### 5.1 Which elements carry identity

| Element (today) | Source | Carries identity? | Bench form |
|---|---|---|---|
| Neural mark: octagon of 8 nodes, 8 spokes, glowing core, violet-to-cyan edges | `static/favicon.svg`, `+layout.svelte:280`, `+page.svelte:128` | **Yes, the strongest.** It is the logo and the only illustration. | Kept, same geometry. Blur filters replaced by a flat halo; theme-aware node colors. One `NeuralMark` component replaces the three copies. |
| Wordmark "CORTEX", Outfit, uppercase, gradient text | `+layout.svelte:321` (`.ra-gradient-text`) | Yes (the gradient, not the caps) | Bar: "Cortex", Geist 600, solid. Gradient text only at 22px or more (first run, Settings · About). |
| Ambient orbs, violet and cyan, blur 85-100px | `CortexDeskShell.svelte:18-25`, `BeaconCanvas.svelte:250` | Yes (depth, the "desk" feel) | Radial-gradient fields, slow drift, Beacon and page empty states only. |
| Engineering grid (32px lines) and radial wash | `app.css:113-131` (`.cortex-shell-bg`) | Yes (the "instrument" feel) | Line grid behind page headers only, fading out (`.band`). |
| Beacon dot grid (20px violet dots) | `BeaconCanvas.svelte:370` | Yes, on Beacon | 24px dot grid in Field view only. |
| Gradient-border panels, breathing glow, node glow, hover-lift | `app.css:525-580`, `:716`; `AgentCard`, `BeaconNode` | Partly: the violet-cyan edge does; the lift does not | Gradient edge and glow on live cards only (`.glow-live`). Hover-lift dropped. |
| Sonar rings (3 per running node, also on the empty state) | `app.css:583-595`, `AgentCard.svelte:138`, `+page.svelte:123` | Yes, on Beacon | One ring, running Field nodes only. |
| Entropy line with violet-to-cyan stroke, η label | `SignalMonitor.svelte:27,142-169` | Yes (the agent's own signal; unique to Reactive Agents) | Kept as the one chart with the signal gradient; also a small line on Beacon live cards and in run vitals. |
| Dashed Field links | `BeaconCanvas.svelte:254-275` | Weakly | Kept in Field; they flow only while parent and child both run. |
| Gel progress bars (inset groove, gloss, shimmer) | `app.css:173-350` | No (skeuomorphic) | Flat 4px meter, signal fill while live. |
| Violet inline code (docs treatment), violet selection | `app.css:733-746` | Yes (shared with the docs site) | Kept, tokenized. |
| Gradient scrollbar thumb | `app.css:724-730` | Weakly | Neutral at rest, signal gradient on hover or drag. |
| Neon `kbd` chips, gradient send button, 9px uppercase labels | `app.css:146-171`, `ChatPanel`, 244 uses | No | Dropped (reasons in 5.3). |

### 5.2 Placement, strength, contrast and motion

Contrast values use the WCAG relative-luminance formula against the Bench tokens (section 6), worst case: the text sits on the brightest point of the layer (orb centre, grid line or dot pixel).

| Element | Where it may appear | Strength (dark / light) | Contrast (worst case) | Motion and reduced-motion fallback |
|---|---|---|---|---|
| Neural mark | Top bar (22px), favicon, page-level empty and first-run states (64-132px), Settings · About | Nodes `#8b5cf6 #22d3ee #a78bfa #c4b5fd` / `#7c3aed #0891b2 #8b5cf6 #a78bfa`; edges at 75% to 25% opacity | Decorative and always next to a text label, so `aria-hidden`. Light theme uses the deeper node set so the mark holds on white. | Hero sizes: nodes twinkle 0.6 to 1 opacity, 7s, staggered. Reduced: still. The 22px mark never moves. |
| Gradient wordmark | 22px and up only | `#a78bfa → #22d3ee` / `#6d28d9 → #0b6479` | On canvas: 6.5 and 9.8:1 dark, 6.6 and 6.3:1 light. Over the orb peak: 6.0:1 dark violet end, 5.9:1 light cyan end. Passes AA for normal text at both ends. | None. |
| Ambient orbs | Beacon (Board and Field); page-level empty states (Chat empty session, Runs with no runs, first run). Never behind a transcript, table, form, trace or inspector. | Violet 8%, cyan 6% at centre / 6%, 4.5% | text-3 over the violet peak 5.8:1 dark, 5.1:1 light; over the cyan peak 5.7 / 5.3:1 (canvas alone 6.2 / 5.5). | Drift 48s and 64s, a few percent of translate and scale. Reduced: still. |
| Header band (line grid) | Behind page headers: Runs, Run view, Lab, Settings; masked to fade out over the band | White 3.5% / slate 4%, plus one small violet field | text-3 on a grid line over the orb field: 5.2:1 dark, 4.7:1 light. | None. |
| Dot grid | Beacon Field only | Violet 16% / 10% | text-3 on a dot pixel: 4.8:1 dark, 4.65:1 light. Field labels sit on a surface chip regardless. | None. |
| Live glow and gradient edge | Beacon live cards, running Field nodes | Edge violet 75% → cyan 45%; halo violet 34% / 20% | Text is on the card's opaque `surface-1`; the halo is outside it. Not the only cue: status text and dot say Running (WCAG 1.4.1). | Halo breathes on 6s. Reduced: static halo and edge. |
| Top-bar live hairline | Under the top bar while one or more agents run | Violet → cyan at 70% | Decorative; the "N agents running" pill states it in text. | None (appears and disappears). |
| Sonar ring | Running nodes in Beacon Field | One 1.5px violet ring | Decorative. | 2.8s, scale 0.92 → 1.45. Reduced: hidden. |
| Entropy line | Run view Signal tab, run vitals (64px), Beacon live cards (96px) | Signal gradient stroke over the accent tint | Graphical object (needs 3:1): `#8b5cf6` on `surface-1` 3.9:1 dark, `#6d28d9` 7.1:1 light. The value is printed beside it (`η 0.30`) and the SVG has an `aria-label`. | None; it redraws as data arrives. |
| Field links | Beacon Field, parent → sub-agent | Violet 70%, dashed while active; `line-strong` at rest | Decorative; the relation is also in the run tree and sub-agent cards. | Dash flow 1.6s while active. Reduced: static. |
| Inline code | Prose (chat, answers, empty-state copy) | Accent on accent tint | 5.6:1 dark, 5.7:1 light. | None. |
| Selection | Everywhere | Violet 30% | Selected text 10.6:1 dark. | None. |
| Scrollbar | Everywhere | `line-strong` thumb; signal gradient on hover or drag | Non-text, not the only cue. | None. |

**Reduced motion has two triggers:** the OS `prefers-reduced-motion: reduce`, and a new Settings · Appearance · Motion control ("Follow the system setting" / "Reduce motion") that sets `html[data-motion="reduce"]`. Both apply the same rules. Under reduced motion the rail is a static gradient, the live glow is static, and the sonar and twinkle are off, so running work still shows through status text, the static rail and the glow.

### 5.3 Dropped, with the reason

- **Gradient buttons** (send, Save & Run): white text on `#8b5cf6` is 4.2:1 and fails AA at 13px. The solid `accent-fill` is 5.7:1.
- **Neon `kbd` chips and hover-lift:** glow and motion on controls that are not live, which breaks principle 1.
- **Uppercase letter-spaced 9px labels:** 1.6 to 3.2:1 (audit A5, A6).
- **Gel progress bars:** a skeuomorphic gloss that does not read in light mode; the flat meter keeps the signal fill.

### 5.4 Components the identity layer adds

- `NeuralMark.svelte` (`size`, `hero?: boolean`): the one mark. It replaces the inline SVG in `+layout.svelte`, `routes/+page.svelte` and (as the source of truth) `static/favicon.svg`. Gradient ids are generated per instance.
- `CortexDeskShell.svelte` gains `ambient?: boolean` (default `false`): Beacon passes `true`; Chat and Runs pass `ambient={isEmpty}`. It renders one fixed, `aria-hidden` layer with the two radial fields.
- `PageHeader` renders the header band (`.band`) by default; `band={false}` turns it off.
- `EntropyLine.svelte` (`values`, `width`, `height`, `label`): the small entropy line; the run view's `SignalMonitor` keeps its D3 chart and takes its colors from the same tokens (fixes A13).
- `EmptyState` gets a `hero` variant (mark, headline, copy, actions) for page-level empty states. Panel-level empty states stay plain.
- CSS utilities in `app.css`: `.glow-live`, `.sonar`, `.dotgrid`, `.band`, `.brand-grad`, with the motion rules above.

## 6. Tokens

Real names keep the `--cortex-` prefix, so the warden invariant ("`--cortex-*` / `--ra-*` tokens") still holds. The mockups use short names (`--surface-1` stands for `--cortex-surface-1`). The source of truth is `mockups/tokens.css`.

**Color: semantic, two themes.** Contrast is measured against every surface it may sit on.

| Token | Dark | Light | Role, minimum contrast |
|---|---|---|---|
| canvas | `#17181c` | `#f6f7f9` | page (dark keeps the docs `--sl-color-black`) |
| surface-1 | `#1c1e24` | `#ffffff` | panels |
| surface-2 | `#23262e` | `#f0f1f4` | raised: composer, user bubble, hover |
| surface-3 | `#2c2f38` | `#e6e8ed` | selected, pressed |
| line / line-strong | `#2b2e37` / `#3b3f4a` | `#e4e6eb` / `#cfd3dc` | hairlines / control edges |
| text | `#eceef2` | `#14161b` | ≥11.5:1 |
| text-2 | `#b6b9c2` | `#434853` | ≥6.8:1 |
| text-3 | `#9599a5` | `#5f6571` | ≥4.7:1 on all surfaces (the floor) |
| accent | `#a78bfa` | `#6d28d9` | agent, primary text, ≥4.9:1 |
| accent-fill | `#7c3aed` | `#6d28d9` | primary button (white text 5.7 / 7.1:1) |
| io | `#22d3ee` | `#0b6479` | tools, data links, ≥5.5:1 |
| ok / warn / bad | `#34d399` / `#fbbf24` / `#f87171` | `#036148` / `#92400e` / `#b91c1c` | outcomes, ≥4.8:1 |
| *-tint | 12-14% alpha of each | 7-9% alpha | badge and banner fills |
| signal | `#8b5cf6 → #22d3ee` | same | live only |
| focus | `#67e8f9` | `#0891b2` | one focus ring |
| orb-violet / orb-cyan | 8% / 6% alpha | 6% / 4.5% alpha | identity: ambient orbs (section 5) |
| grid-line / grid-dot | white 3.5% / violet 16% | slate 4% / violet 10% | identity: header band, Field dots |
| glow-live | violet 34% | violet 20% | identity: live-card halo |
| brand-a → brand-b | `#a78bfa → #22d3ee` | `#6d28d9 → #0b6479` | gradient text, 22px and up |
| mk-violet, mk-cyan, mk-lilac, mk-pale | `#8b5cf6 #22d3ee #a78bfa #c4b5fd` | `#7c3aed #0891b2 #8b5cf6 #a78bfa` | neural mark nodes |

**Implementation:** Tailwind colors become `rgb(var(--cortex-x-rgb) / <alpha-value>)`, so opacity modifiers keep working and both themes come from `html.dark` vs `:root`. That lets `app.css:380-489` be deleted outright. The MD3 names (`surface-container-low`, `on-surface-variant`, …) map onto the new tokens for one release, so giants keep rendering while they are restyled.

**Type:** Geist (UI and prose), JetBrains Mono (data). Outfit is kept only if the owner wants the wordmark in it (decision 2, still open); the mockups use Geist 600. The scale is 11 / 12 / 13 / 15 / 17 / 22 / 30. Line heights are 1.25 (titles), 1.45 (UI) and 1.65 (reading), with a 68ch measure. There are no uppercase labels and no letter-spaced captions.

**Space:** 4pt (4, 8, 12, 16, 20, 24, 32, 40, 48).

**Radius by hierarchy:** chip 6, control 8, panel 12.

**Layers:** sticky 10, nav 20, drawer 30, modal 40, toast 50, tooltip 60.

**Motion:** 120/220ms, ease-out `cubic-bezier(.22,1,.36,1)`. Live motion: rail 2.4s, sonar 2.8s, Field links 1.6s, glow 6s. Identity motion: twinkle 7s, orbs 48/64s. `prefers-reduced-motion` or `html[data-motion="reduce"]` stops all of it (section 5.2).

**Fonts and icons are self-hosted** (fontsource is already a dependency). Icons move to an `Icon.svelte` component rendering inline SVG from a fixed set, always `aria-hidden`. This replaces the Material Symbols ligature font loaded from the Google CDN.

## 7. Components

Kit components go in `ui/src/lib/components/kit/`. Each one owns a single concern. Giants only swap their markup for kit components.

| Component | Status | Replaces / reuses |
|---|---|---|
| `Icon` | new | Material Symbols ligature spans (244) |
| `Button`, `IconButton` (label required) | new | ad-hoc button classes, the gradient send button |
| `Chip` (setting / value) | new | quick-bar chips, tool chips, model chips |
| `Badge` (tone) and `StatusDot` / `Status` | new | BeaconNode status map, sub-agent `--tone`, run status pills, `endingBadge` styling |
| `Panel` (header/body) | new | `gradient-border`, `gradient-border-glow`, bespoke cards |
| `PageHeader` (title, description, actions) | new | the Runs / Lab / Settings / Run bespoke headers |
| `Tabs` (`role=tablist`, counts) | new | RunDetail bottom tabs, Lab tabs, TracePanel tabs |
| `Field`, `Input`, `Select`, `Textarea`, `Switch` | new | `.acp-field` / `.config-input` globals and light `!important` input styling |
| `EmptyState` (plain and `hero`) | new | about 12 hand-built empty states; `hero` (mark + headline) for page-level ones |
| `Overlay` (Modal, Drawer, Popover) | new | 6 modal implementations and their z-indexes |
| `Meter` (static / live) | new | `cortex-progress-*` gel bars, context gauge |
| `SignalRail` (CSS utility) plus `.glow-live`, `.sonar` | new | `.sonar-ring` (3 rings → 1), `gradient-border-glow` (any panel → live cards only) |
| `NeuralMark` | new | the three inline copies of the mark (section 5.4) |
| `EntropyLine` | new | small entropy line for live cards and vitals; same colors as `SignalMonitor` |
| `Toast`, `ToastContainer` | reuse, restyle | — |
| `Tooltip` | reuse, fix z-index | — |
| `MarkdownRich`, `GuardedMarkdown` | reuse, restyle to `--cortex-md-*` mapped onto the new tokens | — |
| `ChatTranscript`, `ChatTurnTimeline`, `ChatSubAgentCards`, `ChatRunEndingNote`, `ChatTurnActions` | reuse logic, restyle; these render ui-core models and stay that way | — |
| `CortexDeskShell` | keep on every full-height route; ambient layer modernized and opt-in (`ambient` prop, section 5.4) | — |
| `RunChatTab` | delete; replaced by "Continue in chat" (section 8, Run view) | second chat UI |

## 8. Per-page layout

Mockups: `beacon.html` (Board, `?view=field`, `?state=empty`), `chat.html` (`?state=empty`), `runs.html` (`?state=empty`), `run.html`, `lab.html`, `settings.html` (which includes the model-detail block, Appearance and About), `components.html` and `identity.html`. A "Toggle empty state" button appears on pages that have one.

- **App frame.** A 52px top bar holds the neural mark and "Cortex" (sentence case), and nav Beacon · Chat · Runs · Lab with a live count on Runs. On the right: a running-agents pill, a search/command button with `Ctrl K`, the theme switch and Settings. The nav marks the current page with an accent underline, not a filled pill. While any agent runs, a 1px violet-to-cyan hairline sits under the bar.
- **Chat (reference).** A 264px sessions rail holds search, Today/Earlier groups, a status dot per session, and actions in a "more" menu (no nested buttons). The conversation column is centered at 760px.
  - User turns are quiet right-aligned bubbles.
  - Assistant turns are prose on the canvas with the signal rail on the left (live / neutral / red), plus a header with model chip, strategy chip and token usage in mono.
  - The tool group is one quiet row; sub-agent cards use a min-220px grid with a guaranteed name width; the goals pill and summary line form the footer.
  - The action row appears on hover or focus and is always visible on the last turn.
  - The composer is one panel: quick-bar chips on top, a 15px Geist textarea, and a hint row with `/ commands`. The queued message shows as a strip above the composer.
  - The sub-agent and trace drawer is a third column at ≥1360px and an overlay drawer below that.
  - States: empty with suggestions (hero mark, ambient orbs; the only chat state with orbs, because the thread is empty); live (rail, "Calling http-get …", "Thinking · step 3 of 6 · waiting on the model"); failed and interrupted (ending note with cause and fix action); stopped.
  - Inline code in prose keeps the docs treatment (accent on accent tint).
- **Runs.** PageHeader "Runs" on the header band. Empty: the hero with the mark ("No runs yet") and ambient orbs. A "Waiting on you" strip appears only when approvals or questions exist, with Approve/Deny inline. A toolbar holds search, a status segment with counts, sort, and totals. A real table (sticky header, pinned group, live rows with the accent edge, right-aligned mono numbers, run names instead of ids) is capped at 1280px wide.
- **Run view.** A breadcrumb "Runs › id · from chat X", then the run name as the title with its status, on the header band. Actions: Continue in chat, Edit and rerun, Export, more. The vitals line wraps and has no clipping chips; entropy shows as `η 0.25` with a 64px entropy line.
  - At ≥1360px the body has two columns: Answer panel and Trace (Loops / Timeline tabs) on the left, a 420px inspector tablist on the right (Summary, Decisions, Signal, Context, Memory, Messages, Events). Below 1360px the inspector stacks under the trace in one scroll.
  - The bottom resizable panel goes away.
  - **No Chat tab (owner decision).** `RunChatTab.svelte` (431 LOC) is deleted and RunDetail's tab list loses "Chat". "Continue in chat" creates a chat session from the run and opens it: `POST /api/chat/sessions` with the run's recorded config (from the `AgentStarted` config snapshot) and `seedTurns` holding the run's task and final answer, then `goto('/chat?session=<id>')`. The mapping is a pure helper, `ui/src/lib/run-to-chat-session.ts`, with a test. A run with no config snapshot opens with the chat defaults and a toast says the run's settings were not recorded. A run started from a chat session links back to that session instead of forking a new one. `seedTurns` already exists and takes `{ role, content }` pairs (`server/api/chat.ts:26`, `chat-session-service.ts:383`), so the seeded answer carries no trace; the new session's header links to the run view for it. The tab's "Enable tools (ReAct)" checkbox maps to the quick bar's tools chip. Removal touches `RunDetail.svelte:18,804` and the comment at `lib/stores/chat-store.ts:20`.
- **Beacon.** Two views, **Board by default** (owner decision) and **Field**. A Board / Field segment sits in the page header; the choice is kept in the URL (`?view=field`) and in `localStorage` (`cortex.beacon.view`), and the URL wins. Ambient orbs sit behind both views.
  - **Board.** "Running now" shows large live cards (goal, the current step, a 96px entropy line with `η`, live meter, tokens and cost) with the live glow and gradient edge. An Agents grid follows, with name, status, source, last line and model, plus filters All / Needs you / Failed / Idle.
  - **Field.** The current free canvas (`BeaconCanvas.svelte`), restyled: the dot grid, nodes labelled by agent name and sentence-case status (not the ULID or `STATUS: SETTLED`), one sonar ring and the live glow on running nodes, and parent-to-sub-agent links that flow only while both run. Drag and auto-arrange stay. The stats HUD goes (Board carries the counts).
  - The prompt bar is at the bottom with model chip and Run, in both views.
  - **Empty / first run.** The hero: the 132px neural mark with its twinkle, "Welcome to Cortex" with the gradient wordmark, one line on what appears here, and Open a chat / Build an agent / Connect an app (`.withCortex()`).
- **Lab.** PageHeader with Import / Export / Load example (stat cards removed). Tabs: Builder, Saved agents (URL `#agents`, keep a `#gateway` alias), Skills, Tools, Prompts.
  - The Builder has three columns: a section nav with a "Find a setting" filter, one section form at a time, and a "Run this agent" panel (On demand / Gateway process, name, task, config summary, Save and run).
- **Settings.** A section nav (Defaults, Providers, Notifications, Appearance, Storage, About), then rows of label, help text and control. Key status shows as badges, and the copy says where keys come from (environment) and what to do (restart after editing `.env`). Appearance holds Theme and the new Motion control (section 5.2). About shows the 64px mark and the gradient wordmark with the versions.
- **Model page.** It uses the same rows and stat grid. The capability note stays and also says what runs actually used.
- **`/run`** redirects to `/runs`.

## 9. Migration order

Each step lands green (server suite, UI `src/lib` suite, typecheck, `check`, `build`) and passes a live check in both themes.

0. **Split the frozen giants first (owner decision).** Before any restyle, each giant is broken into single-concern components with **no visual or behavior change**. One giant per change. Rules for every split:
   - Markup moves verbatim. Every `id`, `data-testid`, `aria-*` and `data-slash-menu-keep` stays, and the `acp-section-*` / `acp-head-*` / `acp-panel-*` id scheme is kept.
   - Logic that is not wiring moves to a `ui/src/lib/*.ts` pure helper with a sibling test (governance rule 2); the giant keeps state ownership and wires children with props and `bind:`.
   - Proof of no change: the server suite and UI `src/lib` suite at baseline plus the new helper tests; `config-parity`, `build-path-parity` and `chat-runs-config-drift` green; svelte-check with no new warnings; before/after screenshots of the affected routes from `audit/shoot.ts`, both themes, compared and identical.
   - Target sizes below are guides, not gates; a split that needs a behavior change stops and is raised as its own item.

   | Frozen file (LOC) | Target modules (under `ui/src/lib/components/` unless noted) | Stays in the file | Target |
   |---|---|---|---|
   | `ChatPanel.svelte` (1,112; script 825) | `chat/ChatHeader.svelte` (title, model chip, context meter, cost, export, trace toggle; today :831-852) · `chat/ChatThread.svelte` (scroll, Jump to latest, turn list) with `chat/ChatUserTurn.svelte` and `chat/ChatAssistantTurn.svelte` (turn header, token usage, `ChatTranscript`, `ChatTurnActions`) · `chat/ChatEmptyState.svelte` (hero, suggestions) · `chat/ChatComposer.svelte` (quick bar, slash menu, textarea, queued row, send/stop; today about :1010-1050) · `lib/chat-scroll.ts` + test (land at the latest turn on open, Jump-to-latest state; fixes the mid-thread landing in 3.4) | session and store wiring, send / queue / retry / stop handlers, live-config PATCH wiring, effects keyed on `activeSession` (pitfall 7) | ≤ 450 |
   | `routes/lab/+page.svelte` (1,760; script 799) | `lab/BuilderTab.svelte` (today :875-1110) with `lab/LaunchPanel.svelte` (Run this agent) · `lab/SavedAgentsTab.svelte` (today the `gateway` branch, :1111-1377) + `lib/stores/gateway-agents-store.ts` + test (list, create, start, stop) · `lab/SkillsTab.svelte` (:1378-1680) + `lib/stores/lab-skills-store.ts` + test (scan, read, SQLite skills) · `lib/lab-tabs.ts` + test (tab ids, hash read/write, `#gateway` → `#agents` alias). Prompts and Tools are already components (`PromptLibrary`, `ToolWorkshop`). | page header, tab routing, the shared `config` state the Builder and launch panel use | ≤ 250 |
   | `ToolWorkshop.svelte` (1,207; script 588) | `tools/ToolCatalogList.svelte` (search, list; today :969-1000) · `tools/ToolInspector.svelte` (details, parameters; :1004-1170) · `tools/ToolTestRunner.svelte` (argument form, invoke, response JSON and time) · `tools/CreateCustomToolForm.svelte` (:671-745) · `tools/McpServerForm.svelte` (manual and import modes; :750-965) · `lib/tool-workshop.ts` + test (catalog filter, argument defaults, MCP import parsing) | selection state, catalog fetch, create/delete calls | ≤ 300 |
   | `AgentConfigPanel.svelte` (2,151; script 580, markup 580-1818, styles 1819-2151) | `agent-config/AgentConfigHeader.svelte` (summary, IO, section filter; :593-667) · `agent-config/ConfigSection.svelte` (the collapsible head + region shell) · one component per section in `agent-config/sections/`: `InferenceSection`, `PersonaSection`, `StrategySection` (with durable runs), `VariablesSection`, `ToolsSection`, `SubAgentsSection`, `SkillsSection`, `MemorySection`, `GuardrailsSection` (wraps `GuardrailsFields`), `ExecutionSection`, `MetaToolsSection`, `ReliabilitySection`, `ObservabilitySection` · `lib/agent-config-sections.ts` + test (section registry: id, title, icon, search keywords; drives the Lab section nav and "Find a setting") · `agent-config/agent-config.css` (the `:global .acp-*` rules, deleted once the Field kit lands) | the `config` state, hydrate / normalize, change events | ≤ 500 |

   `chat-session-service.ts` is a server giant and is not part of this UI work. The Lab mockup's section nav groups the 13 sections into 12 entries (Inference → Model, Strategy → Reasoning, Variables under Persona, Meta tools under Tools, plus "Shell and workspace" and "All framework options"); the registry makes that grouping data, not markup.
1. **Foundation (no layout change).** Semantic tokens in `app.css` plus the Tailwind var mapping, with MD3 aliases; the identity tokens and utilities (section 5); the Motion setting (`html[data-motion]`); self-hosted fonts; `Icon.svelte`; `NeuralMark.svelte`; z-index scale. Delete `app.css:380-489` and the phantom vars (A3). Fix the 9 svelte-check warnings. This is the biggest visual shift for the least code, and it unblocks light mode.
2. **Kit.** Button, IconButton, Chip, Badge/Status, Panel, PageHeader (with band), Tabs, Field family, EmptyState (plain and hero), Overlay, Meter, EntropyLine. `CortexDeskShell` gets the `ambient` prop. Shared formatters come from ui-core (G1).
3. **Chat (reference).** Transcript typography, turn layout, sub-agent grid, composer, session rail, drawer, the states in 3.4. B1 and B2 are fixed with pins in the same step. Restyle happens in the step-0 chat components; ChatPanel only wires.
4. **Runs and Run view.** Table, waiting-on-you strip, inspector layout, B3, B7, B8, `/run` redirect. Delete `RunChatTab` and add Continue in chat (`run-to-chat-session.ts` + test).
5. **Beacon.** Board view as default with the Board / Field switch, live cards with glow and entropy line, agent names; Field restyle (dot grid, one sonar, flowing links); first-run hero.
6. **Lab.** Section nav from the registry, launch panel, tabs and hash names, restyling the step-0 pieces.
7. **Settings and Model page.** Including Appearance · Motion and About.
8. **Cleanup.** Remove MD3 aliases, `gradient-border*`, `cortex-progress-*`, `hover-lift`, `.sonar-ring`, `.cortex-shell-bg`, `.cortex-kbd`, `.ra-gradient-text` and the old blur orbs in `CortexDeskShell` / `BeaconCanvas`. Update AGENTS.md "UI theme" (the ambient shell row now says opt-in, Beacon and empty states) and `features/cortex.mdx`, and add a changeset.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Deleting the light override block exposes every class it was hiding. | Step 1 maps MD3 and `slate`/`dark:` utilities through the token layer first. Screenshot every route in both themes before and after, using the same capture script, and diff the screens. |
| Frozen giants (AgentConfigPanel 2.2k, `lab/+page` 1.8k, ToolWorkshop 1.2k, ChatPanel 1.1k) need class-level edits, which the PLACEMENT rule treats as more than wiring. | **Decided: split first** (step 0). Each split is a no-change refactor proven by parity tests and identical before/after screenshots; restyle then touches only the new components. |
| A split silently changes behavior (a lost `bind:`, an effect that now re-runs). | One giant per change; the giant keeps state ownership; ChatPanel effects keep reading the `$derived` `activeSession` (pitfall 7); config parity tests and screenshot diff gate each split. |
| The identity layer creeps back into decoration (orbs behind text, glow at rest). | Utilities are opt-in (`ambient`, `.glow-live`), placements are listed in 5.2, and the Phase 3 QA checks each page against that list in both themes and with reduced motion. |
| Tests that key on classes or testids. | Keep every `data-testid`; most UI tests are pure `lib/*.test.ts` and unaffected. |
| The warden invariant 7 text ("CortexDeskShell on every full-height route", orbs) changes meaning. | Amended wording in section 14, applied by the parent after sign-off. |
| Icon swap misses an icon name, or a ligature string is still used as a label. | `Icon` takes a typed name union, so a missing name is a type error; `IconButton` requires `label`. |
| Prose typography change breaks markdown details (tables, KaTeX, code). | Restyle `MarkdownRich` against a fixture page holding every markdown feature, in both themes. |
| Ollama contention during QA makes live runs slow. | Use the deterministic `test` provider for scripted scenarios. Use `seedTurns` (POST `/api/chat/sessions`) for transcript states. Run live models only for the final pass. |

## 11. QA plan

**Live scenarios (Phase 3, private stack on separate ports, both themes, 1280 and 1920, plus 768 for chat).**
1. Chat: empty → send → stream with tool calls → finish. Check the rail, tool row expand, copy / retry / trace / fork, and the action row.
2. Chat with sub-agents: cards, minimum name width, drawer open and close, and the failed child's ending note.
3. Chat failures: missing model (B1, the message must stay), provider error, `success: false` run, abstained, partial, files only.
4. Chat interrupts: user Stop (Retry present); navigate away mid-turn (B2, cause and Retry); the run closes in Runs (B3).
5. Durable approval and `request_user_input` pause, resolved from chat and from the Runs waiting strip.
6. Queue and draft: Enter during a run parks one message; it auto-sends on normal end and is kept after error or stop; Restore swaps.
7. Live config during a run: every quick-bar chip and every config slash command PATCHes immediately and the toast says it applies next turn.
8. Compaction: `/compact`, summary sections, context meter carry.
9. Runs: filters, sort, pin, bulk delete, live row updates, approve and deny inline.
10. Run view: every inspector tab with data and empty, replay, export, Edit and rerun; Continue in chat from a desk run (new seeded session with the run's config) and from a chat run (opens the source session); no Chat tab.
11. Beacon: Board is the default; `?view=field` and the stored choice open Field; live card updates over WS; agent names, not ids; Field drag and arrange still work; first-run hero with no agents.
12. Lab: build → save → run on demand; gateway agent create; skills rescan; tool test; prompt create and insert.
13. Settings: change defaults → new chat uses them; key badges; Ollama endpoint; Motion control.
14. Identity: every placement in 5.2 checked per page in both themes (orbs only on Beacon and page empty states, nothing at rest glows, gradient text only at 22px or more); OS reduced motion and Settings · Motion each stop the drift, twinkle, sonar, link flow and rail flow.

**Chat regression checklist** (from AGENTS.md pitfalls 6-11 and the transcript contract):
- Slash menu anchors above the quick bar, closes on an outside press, and keeps `data-slash-menu-keep`.
- Multi-select rows queue PATCHes; composer state survives store updates.
- Transcript order from ui-core `buildTurnTranscript`. Prose is never thinking. The in-flight text is muted and unrendered until final.
- Tool group badges: `×N`, red unfixed failure never hidden behind `+N`, fixed check, `N failed`, duration, `Running` while live.
- Sub-agent rollup header, per-agent status / goal / meta / one activity line, no raw JSON.
- Goals pill hides the implicit `answer` requirement unless blocked, and opens while a plan runs or a goal is unmet.
- Turn actions: status tick; relative time with absolute time on hover; `Ran 2m 05s · finished …`; live `Running 12s`; strategy chip from `metadata.strategyUsed`.
- Endings: failed red, abstained quiet with reason and missing inputs, partial draft plus unfinished list, files "Produced", header badge text.
- Durable approval and interaction cards; 409 for new turns while one is pending.
- Queue, draft swap, compaction contract (pitfall 10).
- Model pinned per turn (`turnModelOf`); reloaded turns identical to live ones (`hydrateTurn`).
- Export menu, Jump to latest (and landing at latest on open), context meter, token usage.

**Accessibility:**
- Keyboard walk on every page: tab order, visible focus, Esc closes overlays, focus returns to the trigger, arrow keys within tablists.
- Accessible-name audit from the Playwright snapshot: no icon ligature words, no unlabeled buttons, no nested interactive elements.
- Contrast check of every token pair, using the same luminance script as this audit.
- `prefers-reduced-motion` and `html[data-motion="reduce"]` stop all motion listed in 5.2.
- Contrast of text-3 over each identity layer at its brightest point, same script (targets in 5.2).
- svelte-check at 0 warnings.

**Gates per step:** server suite and UI `src/lib` at baseline plus new tests with 0 fail; `bun run --cwd apps/cortex typecheck`; UI `check`; UI `build`; before/after screenshots of all routes in both themes.

## 12. Framework gaps (ui-core, owner: cortex-warden; G5 belongs to provider-warden)

| Id | Gap | Where |
|---|---|---|
| G1 | No shared formatters. ui-core has `formatTurnDuration` only, so Cortex grew five cost formatters (A11), and token / relative-time formatting is repeated per component. Add `formatCost`, `formatTokens`, `formatRelativeTime` and `formatClockTime`, with tests, and re-export them from the bindings. | `packages/ui-core/src/state/turn-duration.ts:formatTurnDuration` (sole formatter) |
| G2 | No single status vocabulary. `TurnEnding` (7 values, `state/turn-outcome.ts:25`), `SubAgentCardState` (4 values, `state/sub-agent-card.ts:15`), the run summary status (`live`/`completed`/`failed`) and BeaconNode's 6 states each paint status their own way. Add `StatusTone` plus `statusOfTurn` / `statusOfRun` / `statusOfSubAgent`, so every surface maps to running / attention / done / failed / stopped / idle. | `packages/ui-core/src/state/turn-outcome.ts:TurnEnding`, `state/sub-agent-card.ts:SubAgentCardState` |
| G3 | No "waiting on model" and no "interrupted" signal. `reduceRunState` does not derive an `awaitingModel` phase from `LLMRequestStarted` before the first token (B11). `turnOutcomeOf` has no input for a turn with no completion, so a disconnected turn has nothing to classify (B2; the server must also persist a `cancelled`/interrupted outcome). | `packages/ui-core/src/state/run-machine.ts:reduceRunState`, `state/turn-outcome.ts:turnOutcomeOf` |
| G4 | No shared run-vitals fold. The run view's Summary, VitalsStrip and Signal derive entropy, cost and loops separately and disagree (B7). A `foldRunVitals(events)` in ui-core would serve the run view, Beacon live cards and Runs rows alike. | candidate: `packages/ui-core/src/state/` (new) |
| G5 | Capability display mismatch: the model page shows the fallback capability context (4,096) while runs use 32.8k. This is framework capability data, not UI. | `packages/llm-provider` capability resolution (provider-warden); Cortex should show both "declared" and "used" |

## 13. Owner decisions

Recorded 2026-11-10:

- **Decision 1, Bench direction: approved with changes.** Keep Cortex's own style and imagery, modernized. Done in revision 2 (section 5, `identity.html`).
- **Decision 3, frozen giants: split first,** then restyle the pieces (section 9, step 0).
- **Decision 4, Beacon: Board by default, Field kept as an option** (section 8).
- **Decision 5, run-view Chat tab: removed** in favor of "Continue in chat" (section 8).

- **Sign-off on revision 2 (2026-11-10):** the owner dispatched the plan ("dispatch the cortex UI modernization plan"). Identity placements and strengths in 5.2 and the invariant 7 wording in section 14 are approved; invariant 7 is applied to the cortex-warden primer.
- **Decision 2, wordmark font: Geist 600** (parent's call on the designer's recommendation, since the owner dispatched without picking): sentence case, solid in the bar and gradient at hero size (as mocked). Outfit stays a one-variable swap if the owner prefers it.

## 14. Warden invariant 7 amendment

The cortex-warden primer (`.claude/agents/cortex-warden.md`, "Load-bearing invariants") currently reads:

> 7. **Visual language is fixed**: `--cortex-*` / `--ra-*` tokens in `ui/src/app.css`, Geist + JetBrains Mono, `CortexDeskShell` on every full-height route. Load `frontend-design:frontend-design` for UI work and stay inside this language.

Proposed wording, to apply after sign-off (the file is outside this mission's authority; the parent applies it):

> 7. **Visual language is fixed (Bench, `wiki/Architecture/Design-Specs/2026-11-10-cortex-ui-modernization.md`)**: semantic `--cortex-*` tokens with the `--ra-*` brand constants in `ui/src/app.css`; Geist for words, JetBrains Mono for machine values, nothing under 11px, no uppercase labels. `CortexDeskShell` wraps every full-height route and keeps a modernized ambient layer (two radial orbs at the spec's fixed strengths, slow drift, still under reduced motion) that is on only for Beacon and page-level empty states, never behind dense content. The neural mark (`NeuralMark`) is the only logo and the only illustration. The signal gradient's motion, the live glow and gradient edge, and the sonar ring mean "running now" and appear nowhere else. Every motion has a reduced-motion fallback, and text keeps WCAG AA over every layer. Load `frontend-design:frontend-design` for UI work and stay inside this language.

The same change updates the "Ambient desk shell" row in `apps/cortex/AGENTS.md` "UI theme" (step 8).

## Evidence

Mockups and audit scripts are committed beside this spec in `wiki/Architecture/Design-Specs/2026-11-10-cortex-ui-modernization-mockups/`. Serve that folder over HTTP (`file:` URLs are blocked in the test browser), e.g. `python3 -m http.server <port>` from inside it.

- Mockups (the button at the bottom right switches theme, or add `?theme=light`): `chat.html` (reference page), `identity.html` (revision 2: old element → modernized form, with placement, contrast and motion per element), `components.html`, `runs.html`, `run.html`, `beacon.html`, `lab.html`, `settings.html`; `tokens.css` is the token source of truth.
- Query switches: `beacon.html?view=field`, `beacon.html?state=empty`, `chat.html?state=empty`, `runs.html?state=empty`, any page `?theme=light`.
- Render check (2026-11-10, parent): all 8 pages load with no script errors at 1440×900; Beacon, Chat and Identity screenshots reviewed.
- Scripts: `audit/scan.ts` (token drift), `audit/shoot.ts` (CDP screenshots, reused for step-0 before/after diffs and Phase 3 QA).
- Revision 1 screenshots, current-UI screenshots, per-route text and scan output lived in the session scratchpad and were not kept; regenerate with the scripts above.

# Cortex — Stitch Design Prompts

One prompt per screen. Each is self-contained — paste directly into Stitch.

---

## Shared Design Language (reference only — embedded in each prompt below)

- **Background:** `#0f1115` page, `#12131a` panels
- **Violet:** `#8b5cf6` — reasoning, primary accent
- **Cyan:** `#06b6d4` — observations, returns, success data
- **Amber:** `#eab308` — tool calls, action, external reach
- **Green:** `#22c55e` — success, completion, health
- **Red:** `#ef4444` — error, high entropy, failure
- **Text:** `#e2e8f0` primary, `#64748b` muted
- **Borders:** `#2a3040` subtle, gradient violet→cyan for panels
- **UI font:** Geist (clean sans-serif)
- **Data font:** JetBrains Mono (all numbers, trace, code)

---

## Screen 1 — Runs: Live Execution

```
Design a single screen of "Cortex" — a dark-mode developer control center for an AI agent
framework. This is the RUNS section showing a live agent execution in progress.

DESIGN LANGUAGE
Dark, clinical, mission control aesthetic. Every visual element encodes real data.
- Page background: #0f1115
- Panel background: #12131a with a 1px gradient border (violet #8b5cf6 → cyan #06b6d4)
  and soft outer glow that breathes between violet and cyan on an 8-second cycle
- Violet #8b5cf6: reasoning, primary accent
- Cyan #06b6d4: observations, returns
- Amber #eab308: tool calls, active execution
- Green #22c55e: success, live indicator
- Red #ef4444: errors, high entropy
- UI labels: Geist sans-serif, medium weight
- All data/numbers/trace: JetBrains Mono, uppercase for labels
- Cards lift 2px on hover with violet glow. Scrollbar: violet-to-cyan gradient thumb.

LAYOUT
Full-width top nav bar (dark, subtle bottom border):
- Left: ◈ CORTEX in violet-to-cyan gradient text
- Center: RUNS · AGENTS · PLAYGROUND · TOOLS · SKILLS tabs. RUNS is active (violet underline).
- Right: settings gear icon

Below nav: main content area, no detail panel open yet.

MAIN CONTENT: THE LIVE RUN CARD
A full-width panel with the gradient border treatment and a left border that pulses green.

Top row of the card:
- Left: ● LIVE badge (green animated dot + "LIVE" in small monospace caps, green pill)
- Center: run name "research-task-42" in JetBrains Mono, medium weight
- Right: iteration counter "ITER 04 / 10" in small monospace, muted

VITALS STRIP (dark inner row, subtle separator below header):
Five items in a row with thin violet separator lines between them:
- η 0.71  label: ENTROPY
- [EXPLORING]  amber pill badge
- 4,820  label: TOKENS  (JetBrains Mono)
- $0.006  label: COST  (JetBrains Mono)
- 18.4s  label: DURATION  (JetBrains Mono)

Below the vitals strip: a narrow EKG heartbeat line spanning the full card width.
A continuous waveform with gentle oscillations in amber (#eab308), suggesting active
exploration. The line has a very subtle amber glow beneath it.

THE SIGNAL MONITOR (the visual centrepiece, takes up ~55% of the card height):
A multi-track oscilloscope-style visualization. Dark background (#0d0f14).
Subtle horizontal grid lines in #1a1d24. Newest data at the right edge.
Each track has a small label on the far left in muted small caps.

Track 1 — ENTROPY:
A continuous line chart. The line transitions color based on value:
starts violet (#8b5cf6) on the left (low entropy, calm),
rises to amber (#eab308) in the middle (exploring),
slight downward curve at the right edge (converging back).
Semi-transparent fill below the line matches the line color at 15% opacity.

Track 2 — TOKENS:
Vertical bars, one per iteration. Violet (#8b5cf6) at 80% opacity.
Heights vary — iteration 3 has a noticeably taller bar (heavy reasoning step).
The rightmost bar (current iteration) pulses with a subtle opacity animation.

Track 3 — TOOLS:
Sparse horizontal spans showing tool execution periods.
Two completed spans: "web-search" (wider, amber→cyan after completion) and
"file-read" (narrow, cyan). One active span on the right edge: "web-search" in
solid amber (#eab308) with a subtle right-edge pulse showing it's in progress.
Each span has a tiny tool name label inside if wide enough.

Track 4 — LATENCY:
Area chart showing LLM round-trip milliseconds per iteration.
Cyan (#06b6d4) at 20% fill opacity, line at 70%. Gentle variation, one spike visible.

BELOW THE SIGNAL MONITOR:
Right-aligned control row:
[Pause]  ghost button, violet border, violet text
[Stop]   ghost button, red border, red text

BELOW THE LIVE CARD: TWO COMPLETED RUN CARDS (compact)
Each completed run card is a shorter panel with the gradient border but dimmer glow:
Row: ✓ (green icon) · "data-pipeline-run-39" (monospace) · "5h ago" (muted) ·
     "7 iter · $0.011 · 42.1s" (small monospace) ·
     mini entropy sparkline (~100px, flat violet line) ·
     [Inspect ›] link in violet

The overall impression: a live monitoring dashboard, data-dense but readable,
the signal monitor feeling like a hardware instrument showing a mind in motion.
```

---

## Screen 2 — Runs: Past Run Inspection (Detail Panel Open)

```
Design a single screen of "Cortex" — a dark-mode developer control center for an AI agent
framework. This is the RUNS section with a past run selected and the detail panel open.

DESIGN LANGUAGE
- Page background: #0f1115, Panel background: #12131a
- Panel borders: 1px gradient (violet #8b5cf6 → cyan #06b6d4) with soft breathing glow
- Violet #8b5cf6: primary accent, reasoning  |  Cyan #06b6d4: observations
- Amber #eab308: tool calls  |  Green #22c55e: success  |  Red #ef4444: error
- UI labels: Geist sans-serif  |  All data/trace/numbers: JetBrains Mono

LAYOUT
Standard top nav bar with RUNS tab active.
Main area split: 68% left (signal monitor + replay), 32% right (detail panel, slide-in).

LEFT PANEL: PAST RUN IN REPLAY MODE
Panel header:
- "research-task-38" in monospace  ·  "✓ COMPLETED" green badge  ·  "3h ago" muted
- Vitals: η 0.58 CONVERGING (violet badge) · TOKENS 8,240 · COST $0.011 · DURATION 42.1s

THE SIGNAL MONITOR (replay state, identical 4-track layout to Screen 1 but fully rendered):
All four tracks show complete data across all 7 iterations.
The entropy track shows a classic converging arc: starts amber (exploring),
peaks slightly, then descends to violet (converged) by iteration 6–7.
The tokens track shows 7 bars of varying heights.
The tools track shows 4 completed cyan spans across the timeline.
The latency track shows a complete area chart.

One iteration (iteration 5) is highlighted across ALL tracks simultaneously:
- A thin vertical line in white at 20% opacity spans all 4 tracks at that iteration's position
- The tokens bar for that iteration is brighter/fully opaque
- The tool span for that iteration has a white outline

REPLAY CONTROLS BAR (below the signal monitor, centered):
[⏮ Start]  [⏪ Back]  [⏸ Pause]  [⏩ Forward]  [⏭ End]
Speed selector: [1× ▾]
Progress indicator: "Step 5 of 7"
A thin scrubber bar below the controls showing position at ~70%

RIGHT DETAIL PANEL (slide in from right, same dark bg, violet left border 2px solid):
Top row: "ITERATION 05" in JetBrains Mono small caps + [×] close icon top-right

Metrics row (4 inline pills):
[η 0.84] [1,240 tok] [8.2s] [tool: web-search]
Each pill has a dark fill, violet border, monospace text

Section: THOUGHT
Small caps label "THOUGHT" with a violet left accent bar.
2–3 lines of agent reasoning text in JetBrains Mono, small size, #c0c2c7 color.
"The user wants recent TypeScript agent framework comparisons. I should search for
current benchmarks and community sentiment before synthesizing an answer."
[Show more ›] in violet, small

Section: ACTION
Small caps label "ACTION"
Tool badge: [◈ web-search] amber pill
Code block (dark #0d0f14 background, cyan syntax):
{
  "query": "TypeScript AI agent framework benchmark 2026",
  "maxResults": 10
}

Section: OBSERVATION
Small caps label "OBSERVATION"
Code block with cyan tint, showing truncated JSON result.
First 3 lines visible, then "···" and [Expand ▾] link

Section: RAW EXCHANGE
[▶ Show raw LLM exchange] — collapsed disclosure row, muted, with chevron

Overall feel: a precise debugging instrument. The detail panel feels like reading the
agent's mind for that exact moment in time.
```

---

## Screen 3 — Agents: Persistent Gateway Agents

```
Design a single screen of "Cortex" — a dark-mode developer control center for an AI agent
framework. This is the AGENTS section showing persistent agents managed by a Gateway service.

DESIGN LANGUAGE
- Page background: #0f1115, Panel background: #12131a
- Panel borders: 1px gradient (violet #8b5cf6 → cyan #06b6d4) with soft breathing glow
- Violet #8b5cf6: primary accent  |  Cyan #06b6d4: secondary accent
- Amber #eab308: paused/warning  |  Green #22c55e: active/healthy  |  Red #ef4444: error
- UI labels: Geist sans-serif  |  All data/metrics: JetBrains Mono

LAYOUT
Standard top nav, AGENTS tab active.
Main content: full-width list of agent cards with [+ New Agent] button in top-right of content area.

AGENT CARD 1 — ACTIVE (healthy)
Full-width panel with gradient border treatment, soft green tint to the glow:

Top row:
- Left: ◈ icon (violet) + "GitHub Issue Monitor" in Geist medium weight
- Right: ● ACTIVE badge — green dot (animated pulse) + "ACTIVE" in green pill with dark fill

Second row (muted, Geist small):
"Daily at 09:00  ·  14 successful runs  ·  $0.18 total  ·  Last run: 2h ago  ·  avg 3 iter"

SPARKLINE ROW — the visual health indicator:
A compact chart (~70% card width, ~40px height) showing the entropy score across all 14 runs.
Runs 1–10: a flat, stable line in violet (#8b5cf6) — reliable execution.
Run 11: a sharp spike upward into amber (#eab308) — one problematic run.
Runs 12–14: back to flat violet — recovered and stable.
The chart has no axes, just the line on a transparent background.
Small label on left: "ENTROPY / 14 RUNS" in tiny muted monospace.

Bottom row, right-aligned ghost buttons:
[Pause]  [Runs ›]  [Edit ›]
Each button: dark fill, violet border at 40% opacity, Geist small, slight hover lift

AGENT CARD 2 — PAUSED
Same structure but with amber glow on the gradient border:
- ⏸ PAUSED badge (amber pill)
- Name: "Daily Standup Digest"
- "Paused manually  ·  23 runs  ·  $0.31 total  ·  Last run: 1d ago"
- Sparkline: flat violet line, ends abruptly (paused state, no recent data, line fades to muted)
- Bottom buttons: [Resume]  [Runs ›]  [Edit ›]

AGENT CARD 3 — ERROR
Same structure but with red glow on the gradient border:
- ✗ ERROR badge (red pill)
- Name: "PR Review Bot"
- "Failed 3 consecutive runs  ·  Last error: tool timeout after 30s  ·  2d ago"
- Error message bar: a muted red background strip with the error text in small JetBrains Mono
  "LLMError: Request timeout after 30000ms on iteration 4 — web-search tool"
- Sparkline: last 3 points spike dramatically into red, previous runs flat violet
- Bottom buttons: [Retry]  [Runs ›]  [Edit ›]

NEW AGENT BUTTON
Top-right of the content area: [+ New Agent] primary button with violet-to-deep-violet
gradient, white text, slight glow. Clicking this would open a creation flow.

Overall feel: a reliable fleet management view. At a glance, you know which agents are
healthy, which need attention, and which have failed — without opening a single run.
```

---

## Screen 4 — Playground: Quick Run

```
Design a single screen of "Cortex" — a dark-mode developer control center for an AI agent
framework. This is the PLAYGROUND section in Quick Run mode — the fastest path from
idea to running agent.

DESIGN LANGUAGE
- Page background: #0f1115, Panel background: #12131a
- Panel borders: 1px gradient (violet #8b5cf6 → cyan #06b6d4) with soft breathing glow
- Violet #8b5cf6: primary accent, active elements
- Cyan #06b6d4: success, results  |  Amber #eab308: tool calls
- UI labels: Geist sans-serif  |  Data/output: JetBrains Mono

LAYOUT
Standard top nav, PLAYGROUND tab active.
Mode toggle at top of content: [Quick Run]  [Builder]  — Quick Run is active (violet underline,
slightly brighter), Builder is muted.

QUICK RUN FORM PANEL (upper portion, ~45% of page height):
A centered panel (max-width ~720px) with the gradient border treatment.

Row 1 — Provider and Model (side by side):
[anthropic ▾]  custom dropdown styled with dark fill, violet border, Geist text,
               chevron in violet
[claude-sonnet-4-6 ▾]  same style

Row 2 — Prompt textarea:
A multiline textarea (~5 lines visible) with dark fill (#0d0f14), violet focus ring (glowing),
rounded corners. Contains typed text:
"Research the latest TypeScript AI agent frameworks released in 2026 and summarize
the top 3 by GitHub activity and developer sentiment."
Placeholder ghost text shows "Describe what you want the agent to do..." when empty.

Row 3 — Tools multi-select:
Label: "TOOLS" in small muted monospace caps.
Active tool pills (violet background, white text, × to remove):
  [× web-search]  [× file-write]
Inactive add pill: [+ add tool ▾] in ghost style (dark fill, violet border at 40%)
The dropdown (if shown open below the pills) shows a short list of available tools with
checkboxes and small description text.

Row 4 — Action row:
Right-aligned: [▶ Run Agent] primary button — violet-to-deep-violet gradient background,
white text, Geist medium, subtle outer violet glow. Slight upward lift and glow on hover.
Left side of row: optional small text "No API key set" warning in amber if applicable.

PREVIOUS RUN RESULT (lower portion, ~45% page height):
A results panel below the form showing the most recent Quick Run.

Panel header row:
"✓ COMPLETED" green badge · "research-task-prev" · "8 iter · $0.014 · 38.2s" · [Full Inspect ›]

COMPACT SIGNAL MONITOR (same 4-track layout, half height of the main runs view):
All tracks show a completed run — the entropy track showing a converging arc (violet at the end),
the token bars all rendered, tool spans all cyan (completed), latency area chart settled.
The rightmost edge of all tracks has a subtle green pulse — completion indicator.

RESULT PREVIEW below the compact monitor:
"FINAL ANSWER" label in small violet monospace caps.
2–3 lines of the agent's synthesized answer text in JetBrains Mono at normal size.
A "Copy" icon top-right of the result block.
[Show full debrief ›] link in violet.

Overall feel: fast and direct. Form → run → result. The signal monitor in the results
area shows that something real and measurable happened, not just a chatbot response.
```

---

## Screen 5 — Playground: Builder Mode

```
Design a single screen of "Cortex" — a dark-mode developer control center for an AI agent
framework. This is the PLAYGROUND section in Builder mode — a progressive disclosure form
for composing an agent capability by capability.

DESIGN LANGUAGE
- Page background: #0f1115, Panel background: #12131a
- Panel borders: 1px gradient (violet #8b5cf6 → cyan #06b6d4) with soft breathing glow
- Violet #8b5cf6: active sections, primary accent  |  Cyan #06b6d4: secondary
- Amber #eab308: warnings  |  Green #22c55e: valid/saved state
- UI labels: Geist sans-serif  |  Data values: JetBrains Mono

LAYOUT
Standard top nav, PLAYGROUND tab active.
Mode toggle: [Quick Run]  [Builder]  — Builder is active.

BUILDER PANEL (centered, max-width ~760px, full gradient border treatment):

SECTION: BASE CONFIG (always visible, expanded)
Subtle section label "BASE CONFIG" in tiny violet monospace caps with a thin violet left bar.
Two dropdowns side by side: [anthropic ▾]  [claude-sonnet-4-6 ▾]
Below: Agent name input field, dark fill, violet focus ring. Shows "my-research-agent".

SECTION: PROMPT (always visible)
Label "PROMPT" with violet left bar.
Multiline textarea, 4 lines visible, dark fill (#0d0f14):
"Research recent benchmarks comparing TypeScript AI agent frameworks and
produce a structured comparison with pros/cons for each."

CAPABILITY SECTIONS (each added capability appears as an expandable section below):

CAPABILITY: REASONING (expanded, showing its contents)
Section header row: [▼] "REASONING" in small caps · violet left bar ·
                    [×] remove icon far right (muted red on hover)
Inside (indented, with subtle dark inner background):
- Strategy: [react ▾] dropdown
- Max Iterations: [10] number input, dark fill
- Strategy Switching: [✓] toggle enabled (violet fill)
- Fallback Strategy: [plan-execute-reflect ▾]

CAPABILITY: TOOLS (expanded)
Section header: [▼] "TOOLS" · violet left bar · [×]
Inside: Tool toggle list:
  [✓] web-search    — small description text in muted
  [✓] file-write    — small description text
  [ ] code-execute  — small description text, unchecked
  [ ] recall        — small description text

CAPABILITY: HARNESS CONTROLS (expanded)
Section header: [▼] "HARNESS CONTROLS" · violet left bar · [×]
Inside (two columns):
- Min Iterations: [3] number input
- Verification Step: [reflect ▾] dropdown
- Output Validator: [none ▾] dropdown
- Task Context: small key-value editor showing one entry "project: cortex"

ADD CAPABILITY ROW (below all added sections):
A dashed-border row (violet dashed line at 30% opacity):
[+ Add capability ▾] ghost button centered in the row
The open dropdown shows (in a dark floating panel):
  Guardrails  ·  Memory  ·  Cost / Pricing  ·  Streaming  ·  Health Check  ·  Skills
Each item has an icon and one-line description.

ACTION ROW (bottom of builder panel, right-aligned):
[▶ Run Agent]   primary button, violet gradient, white text, glow
[Save as Agent →] secondary ghost button, violet border —
                  "save as persistent Gateway agent" tooltip below in tiny muted text

Overall feel: a thoughtful form that grows as you add capabilities.
Not intimidating at first glance, but reveals full framework depth as you explore.
The "+ Add capability" section should feel like unlocking superpowers one at a time.
```

---

## Screen 6 — Tools: Browse and Test

```
Design a single screen of "Cortex" — a dark-mode developer control center for an AI agent
framework. This is the TOOLS section — browse registered tools and test them in isolation.

DESIGN LANGUAGE
- Page background: #0f1115, Panel background: #12131a
- Panel borders: 1px gradient (violet #8b5cf6 → cyan #06b6d4) with soft breathing glow
- Violet #8b5cf6: primary accent  |  Cyan #06b6d4: success/results
- Amber #eab308: built-in tools  |  Muted #64748b: secondary text
- UI labels: Geist sans-serif  |  Schemas/values: JetBrains Mono

LAYOUT
Standard top nav, TOOLS tab active.
Split: 40% left (tool list), 60% right (selected tool detail + test panel).

LEFT PANEL: TOOL LIST
Search input at top: dark fill, violet border, magnifying glass icon. Placeholder: "Search tools..."

Tool rows (each is a clickable row with hover lift):

Row (selected, highlighted with violet left border and slightly lighter bg):
◈ web-search        [built-in]  tag in amber pill, tiny
"Search the web using Tavily API"  muted description, Geist small

Row:
◈ file-write        [built-in]  amber pill
"Write content to a file on the filesystem"

Row:
◈ recall            [meta-tool]  violet pill
"Selective working memory retrieval"

Row:
◈ github-search     [mcp]  cyan pill
"Search GitHub repos, issues, PRs"

Row:
◈ code-execute      [built-in]  amber pill
"Execute TypeScript/JavaScript in sandbox"

Row:
◈ custom-validator  [custom]  muted pill
"Custom validation tool (user-defined)"

Tag legend below the list (tiny):
● built-in  ● meta-tool  ● mcp  ● custom

RIGHT PANEL: SELECTED TOOL — "web-search"
Panel header:
"◈ WEB-SEARCH" in JetBrains Mono medium, violet  ·  [built-in] amber pill

Description:
"Search the web for real-time information using the Tavily API. Returns ranked results
with titles, URLs, and content snippets."

Section: INPUT SCHEMA
Label "INPUT SCHEMA" in small violet monospace caps.
Schema rendered as a clean property list:
  query        string  required   "The search query"
  maxResults   number  optional   default: 5
  searchDepth  enum    optional   "basic" | "advanced"  default: "basic"
Each property row: name in violet monospace, type in cyan, required/optional badge, description muted.

Section: OUTPUT SCHEMA
Label "OUTPUT SCHEMA" in small violet monospace caps.
  results[]  array of:
    title    string   "Page title"
    url      string   "Source URL"
    content  string   "Relevant excerpt"

Section: USAGE STATS (from run history)
Four inline stat pills: [142 calls] [94% success] [avg 380ms] [last used 1h ago]
Each pill: dark fill, muted border, JetBrains Mono value, Geist tiny label below.

Section: TEST THIS TOOL
Label "TEST" in small violet monospace caps.
A dark inner panel (#0d0f14):
JSON input editor with syntax highlighting showing:
{
  "query": "TypeScript agent framework benchmarks 2026",
  "maxResults": 3
}
[▶ Run Test] button — violet gradient, white text, small

Below the button: the last test result shown in a result block:
"✓ 340ms" green badge + response preview in JetBrains Mono, cyan-tinted code block,
first 5 lines of JSON visible with [Expand ▾] at bottom.

Overall feel: a focused API explorer. Developers can understand exactly what each tool
does and verify it works before building an agent that depends on it.
```

---

## Screen 7 — Skills: Browse Living Skills

```
Design a single screen of "Cortex" — a dark-mode developer control center for an AI agent
framework. This is the SKILLS section — browse and inspect the framework's Living Skills system,
where agents develop and refine their own reusable knowledge over time.

DESIGN LANGUAGE
- Page background: #0f1115, Panel background: #12131a
- Panel borders: 1px gradient (violet #8b5cf6 → cyan #06b6d4) with soft breathing glow
- Violet #8b5cf6: primary, skill identity  |  Cyan #06b6d4: recently evolved / fresh
- Amber #eab308: high usage, active skills  |  Muted #64748b: inactive/older
- UI labels: Geist sans-serif  |  Skill content: JetBrains Mono

LAYOUT
Standard top nav, SKILLS tab active.
Split: 38% left (skills list with search/filter), 62% right (selected skill detail).

LEFT PANEL: SKILL LIST
Search input at top: "Search skills..." with magnifying glass icon.
Filter row below: [All ▾] tier filter · [Sort: Usage ▾]

Skill rows (each clickable, hover lift):

Row (selected, violet left border):
⚡ harness-workflow      tier: CONDUCTOR  ·  v3
"Built-in workflow for orchestrating multi-step agent runs"
Usage: ████████  42 activations   — amber bar proportional to usage

Row:
◈ react-kernel           tier: STRATEGY  ·  v1
"ReAct reasoning loop patterns and tool selection heuristics"
Usage: ██████  31 activations

Row:
✦ github-patterns        tier: DOMAIN  ·  v2  ·  [evolved ↑] cyan badge
"GitHub API usage patterns learned from 14 agent runs"
Usage: ████  18 activations

Row:
◈ typescript-debugging   tier: DOMAIN  ·  v1
"TypeScript error patterns and resolution strategies"
Usage: ██  8 activations

Row:
◈ search-refinement      tier: TASK  ·  v4  ·  [evolved ↑] cyan badge
"Query refinement heuristics for web search tasks"
Usage: ███  12 activations

Stats footer below list: "5 skills  ·  3 tiers  ·  2 evolved this week"

RIGHT PANEL: SELECTED SKILL — "harness-workflow"
Panel header row:
"⚡ HARNESS-WORKFLOW" in JetBrains Mono medium, violet
[CONDUCTOR] tier pill in violet  ·  [v3] version badge  ·  [42 activations] amber pill

Meta row:
"Last evolved: 2 days ago  ·  Created: 14 days ago  ·  Source: built-in"
All in muted Geist small.

Section: SKILL CONTENT
Label "CONTENT" in small violet monospace caps.
Rendered markdown content in a scrollable dark panel (#0d0f14):
A structured skill document with headers (violet), bullet points, code examples
(JetBrains Mono, syntax highlighted). Shows 8–10 lines before scrolling.
The content looks like expert guidance: "## When to use this skill / ## Core workflow / ## Tool sequencing"

Section: VERSION HISTORY
Label "VERSION HISTORY" in small violet monospace caps.
A compact timeline:
  v3  ·  2 days ago     [current]  green badge
  v2  ·  8 days ago     [view diff ›] violet link
  v1  ·  14 days ago    [view diff ›] violet link

Section: EVOLUTION
Label "EVOLUTION" in small violet monospace caps.
A muted row showing the last evolution trigger:
"LLM refinement after 30 activations — improved tool sequencing guidance"
[Trigger Evolution ▾] ghost button with cyan border — "Provide a reason to guide refinement"
A small input appears on click: "Reason for evolution..." — currently collapsed.

Section: ACTIVATION CONTEXTS (small)
Where this skill has been activated recently, shown as tiny pill tags:
[research-task-42]  [data-pipeline-run-39]  [github-monitor-run-12]  [+39 more]
Each in dark fill, muted border, JetBrains Mono tiny.

Overall feel: a living knowledge base that grows with agent usage. The evolution feature
makes clear that these aren't static docs — they improve. The version history shows
genuine progression. The usage bars make hot vs. cold skills immediately legible.
```

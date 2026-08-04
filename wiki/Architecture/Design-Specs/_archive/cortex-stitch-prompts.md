# Cortex — Stitch Design Prompts

Prompts follow the Stitch best practice: establish the foundation first, then one focused
screen per prompt. Start with Prompt 0 to seed the design system, then use each numbered
prompt independently to generate or refine that specific screen.

**How to use:** Paste Prompt 0 first. Then paste any numbered prompt to generate that screen.
To refine, use short follow-up prompts targeting one element at a time.

---

## Prompt 0 — Foundation Seed

> Paste this first to establish the design system before generating any screen.

```
A dark, clinical developer tool called Cortex — a companion studio for an AI agent framework.

The aesthetic is alive and precise: mission control meets neural interface. Every element
encodes real data. Nothing decorative.

Color palette:
- Background: near-black #0f1115
- Panels: deep navy #12131a with a 1px animated gradient border fading between
  violet #8b5cf6 and cyan #06b6d4, with a soft outer glow
- Primary accent: violet #8b5cf6 (reasoning, active state)
- Secondary accent: cyan #06b6d4 (success, data returns)
- Amber #eab308 for tool calls and warnings
- Green #22c55e for healthy, live, completed states
- Red #ef4444 for errors and high entropy

Typography:
- UI labels and navigation: Geist, clean sans-serif, medium weight
- All data, metrics, and trace content: JetBrains Mono, tabular, uppercase labels

Navigation: a slim top bar with the ◈ CORTEX wordmark in violet-to-cyan gradient text,
three nav tabs (Stage / Run / Workshop), a Cmd+K command palette icon, and a settings gear.
Active tab has a violet underline.

Cards lift 2px on hover with a violet shadow. Scrollbar uses a violet-to-cyan gradient thumb.
```

---

## Prompt 1 — Stage View (Default Home)

```
Design the Stage view for Cortex. This is the default home screen.

The Stage shows all connected AI agents as glowing nodes on a dark canvas.
Each node is a soft circle with a name label below it in JetBrains Mono.

Node states:
- Idle: small, dim violet circle, low opacity
- Running: larger, bright pulsing violet glow that breathes in and out
- High entropy (confused): color shifts from violet to amber to red as stress increases
- Completed: settles to a calm cyan
- Error: small, static red circle, no pulse

Show four nodes arranged organically on the canvas:
one running (violet, pulsing, labeled "research-task-42"),
one completed (cyan, settled, labeled "data-pipeline-31"),
one error (red, static, labeled "pr-review-bot"),
one idle (dim, labeled "scheduled-digest").

At the very bottom of the screen, a persistent full-width input bar:
a dark rounded input field with placeholder text "What should your agent do?"
and a violet [Run] button on the right.

The canvas background is #0f1115 with a very subtle radial gradient — slightly lighter
at center, fading to pure dark at edges, giving depth to the node field.
```

---

## Prompt 2 — Stage View (Empty State / Onboarding)

```
Refine the Stage view to show the empty state — no agents connected yet.

Remove all agent nodes from the canvas. Center the canvas on a minimal onboarding message
in muted JetBrains Mono:

  No agents connected yet.

  Start one:  rax run "your prompt" --cortex
  Or type below ↓

The code snippet "rax run..." should use a subtle inline code style:
dark background chip, violet text, monospace.

The persistent input bar at the bottom remains, with the cursor blinking inside it —
ready for immediate use. Add a soft violet glow on the input bar to draw the eye down.
```

---

## Prompt 3 — Run View (Live Execution)

```
Design the Run view for Cortex. This screen shows a single agent run in progress.

Top breadcrumb bar: "← Stage" link, then run name "research-task-42" in monospace,
then ● LIVE badge in green, then "iter 04 / 10" and "η 0.71 EXPLORING" in amber.

Below the breadcrumb: a vitals strip spanning the full width.
Five metrics separated by thin violet dividers:
η 0.71 · EXPLORING (amber pill) · 4,820 TOKENS · $0.006 COST · 18.4s DURATION
Below the metrics, a full-width EKG heartbeat line in amber, gently oscillating.

Below the vitals: the main content split into two panels side by side.

Left panel (65% width) — the Signal Monitor:
Four horizontal data tracks stacked vertically, sharing a time axis.
Each track has a small muted label on the far left in monospace caps.

Track 1 ENTROPY: a continuous line chart. The line starts violet on the left,
rises to amber in the center, curves slightly downward at the right edge.
Semi-transparent color fill beneath the line.

Track 2 TOKENS: vertical bars per iteration in violet at 80% opacity.
One bar noticeably taller than the others. Rightmost bar pulses.

Track 3 TOOLS: sparse horizontal spans. Completed spans are cyan.
One active amber span on the right edge, pulsing — tool call in progress.
Tiny tool name labels inside wide spans.

Track 4 LATENCY: filled area chart in cyan at 20% opacity, line at 70%.

Right panel (35% width) — the Trace Panel:
Showing the currently selected iteration (3).
Sections stacked vertically with small violet left-accent bars:
THOUGHT — 2 lines of agent reasoning text in JetBrains Mono, muted
ACTION — amber pill [web-search] + code block showing query args
OBSERVATION — cyan-tinted code block, truncated, [Expand ▾] link
Raw exchange — collapsed [▶ Show raw LLM exchange] row

Bottom bar: three toggle tabs [Reactive Decisions] [Memory] [Context Pressure]
plus [Pause] and [Stop] ghost buttons right-aligned.
```

---

## Prompt 4 — Run View (Reactive Decisions Panel)

```
Refine the Run view. Show the bottom panel expanded to the Reactive Decisions tab.

The Reactive Decisions panel slides up from the bottom, taking the lower 30% of the screen.
It shows a chronological log of controller decisions the agent made mid-run.

Each decision is a row with:
- A small icon indicating type (lightning bolt for strategy-switch, compress for compression,
  stop for early-stop)
- Iteration number in violet monospace: "iter 03"
- Decision type in small caps: "STRATEGY SWITCH"
- Reason text in muted Geist: "Entropy diverging after 3 consecutive thoughts — switching
  to plan-execute-reflect"
- Entropy before and after: "η 0.84 → 0.61" in amber → violet

Show three decision rows. The most recent row is slightly highlighted.

The Signal Monitor and Trace Panel above remain visible but slightly compressed.
```

---

## Prompt 5 — Run View (Chat Mode)

```
Refine the Run view to show a chat session — when the agent is used conversationally.

Replace the Signal Monitor with a vertical split:
Left side (55%): a chat transcript panel. Messages alternate between
user bubbles (right-aligned, dark violet fill, white text) and
assistant responses (left-aligned, dark panel fill, #e2e8f0 text).
The transcript uses Geist for chat text but JetBrains Mono for any code or tool outputs.
A chat input bar sits at the bottom of this panel.

Right side (45%): a live event stream panel labeled "LIVE EVENTS" in small muted caps.
Events stream in as the agent responds — each line is a timestamped `AgentEvent` type
in JetBrains Mono, color-coded by type:
violet for reasoning events, amber for tool calls, cyan for observations, green for completion.

The vitals strip at the top remains. The Trace Panel on the right is replaced by this
event stream — they serve the same purpose in chat mode.
```

---

## Prompt 6 — Workshop View (Builder Tab)

```
Design the Workshop view for Cortex, showing the Builder tab.

Three tabs at the top of the content area: [Builder] [Skills] [Tools]
Builder tab is active with a violet underline.

The builder is a centered form panel (max width 720px) with the gradient border treatment.

Section: BASE CONFIG (always visible)
Two dropdowns side by side: [anthropic ▾] and [claude-sonnet-4-6 ▾]
Both use dark fill, violet border, Geist text.

Section: PROMPT
A multiline textarea in dark fill (#0d0f14) with violet focus ring.
Contains sample text: "Research TypeScript agent frameworks and summarize the top 3."

Section: ACTIVE CAPABILITIES
Three capability sections already added, each with a small collapse toggle and a remove ×:

REASONING (expanded): strategy dropdown [react ▾], max iterations [10],
strategy switching toggle (enabled, violet), fallback [plan-execute-reflect ▾]

TOOLS (expanded): a compact checklist — [✓] web-search, [✓] file-write, [ ] code-execute

HARNESS CONTROLS (collapsed): just the header row visible

Below the capability sections: a dashed-border row with [+ Add capability ▾] centered.
The dropdown is open, showing: Guardrails · Memory · Cost / Pricing · Streaming · Health Check · Skills
Each item has a small icon and a one-line description in muted text.

Bottom action row, right-aligned:
[▶ Run Agent] violet gradient button
[Save as Gateway Agent →] secondary ghost button with violet border
```

---

## Prompt 7 — Workshop View (Skills Tab)

```
Switch to the Skills tab in the Workshop view.

Left column (38%): a scrollable skill list with a search input at the top.
Each skill row shows: icon · skill name in Geist medium · version badge · tier pill.
Tier pills: CONDUCTOR in violet, STRATEGY in indigo, DOMAIN in cyan, TASK in slate.
A small horizontal usage bar under each name shows relative activation count.
One row is selected (violet left border, slightly lighter background): "harness-workflow".

Right column (62%): the selected skill detail panel.

Header: ⚡ HARNESS-WORKFLOW in JetBrains Mono violet · [CONDUCTOR] pill · [v3] badge · [42 activations] amber pill

Below the header: a scrollable content panel in dark fill showing rendered markdown.
Headers in violet, bullet points and code blocks in JetBrains Mono.
The content looks like expert guidance with sections: When to use · Core workflow · Tool sequencing

Version history section (below content):
Three compact rows: v3 current (green badge) · v2 [view diff ›] · v1 [view diff ›]

Evolution section:
Muted description text + [Trigger Evolution ▾] ghost button in cyan border.
```

---

## Prompt 8 — Workshop View (Tools Tab)

```
Switch to the Tools tab in the Workshop view.

Left column (38%): scrollable tool list with a search input.
Tool rows: ◈ icon · tool name in Geist · source tag (built-in amber / mcp cyan / custom muted).
One tool is selected: "web-search".

Right column (62%): selected tool detail.

Header: ◈ WEB-SEARCH in violet monospace · [built-in] amber pill

Description text in muted Geist.

INPUT SCHEMA section: a clean property table.
Each row: property name in violet monospace · type in cyan · required/optional badge · description muted.
Properties: query (string, required) · maxResults (number, optional, default 5) · searchDepth (enum, optional)

USAGE STATS: four inline stat chips in a row.
[142 calls] [94% success] [avg 380ms] [last used 1h ago]
Dark fill, muted borders, JetBrains Mono values, tiny Geist labels.

TEST section: a dark inner panel with a JSON code editor showing sample args,
and a [▶ Run Test] violet button.
Below the button: last test result — ✓ 340ms green badge + cyan-tinted code block
showing truncated JSON response with [Expand ▾] link.
```

---

## Refinement Prompts (Use After Generating Any Screen)

Short focused follow-ups — paste one at a time after generating a screen.

**To add depth to the glow effects:**
```
Make the panel border glow more prominent — increase the violet-to-cyan gradient
border glow intensity and add a subtle inner shadow on panels.
```

**To adjust the signal monitor tracks:**
```
Make the four signal monitor tracks taller with more breathing room between them.
Add a subtle horizontal grid line every 25% height on each track.
```

**To refine the node pulse animation description:**
```
The running agent node should have three concentric rings expanding outward
like a sonar pulse, fading from violet to transparent. The rings repeat every 2 seconds.
```

**To add the command palette:**
```
Add a command palette overlay: a centered dark modal with a violet border,
a search input at the top reading "Search commands...", and a list of
command results below. First result highlighted in violet. Each result shows
an icon, command name in Geist, and keyboard shortcut in muted monospace.
```

**To show a notification:**
```
Add a desktop notification-style toast in the bottom-right corner:
dark panel, thin violet left border, agent name in violet monospace bold,
event description in muted Geist, timestamp in tiny monospace.
```

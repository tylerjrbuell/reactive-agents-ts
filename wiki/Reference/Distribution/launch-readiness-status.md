---
type: reference
status: active
created: 2026-11-19
tags: [launch, adoption, positioning, release-0.19]
---

# Launch readiness status (as of 2026-11-19)

This is a handoff for the Show HN and Reddit launch. Sources:
- [[../../Research/2026-11-18-agent-harness-market-landscape]] (competitors, framing sweep)
- [[../../Research/2026-11-18-community-pain-signal-scan]] (HN and GitHub pain themes; Reddit was blocked)
- [[show-hn-post]], [[reddit-posts]], [[awesome-list-submissions]] (fact sheets; the owner writes the final text, because HN bans AI-written posts)

## Done (all on `dev`, not yet pushed)

### Funnel and first run

- Landing panel MDX defect fixed. A strict MDX parse test now covers all docs pages.
- READMEs aligned. The root README went from 56 KB to 13 KB. The CLI, scaffolder, Cortex and judgment READMEs were rewritten.
- `rax` runs on Node 22.5+. Bun-only commands (`cortex`, `examples`) print a clear message. The facade bin uses a node shebang.
- The facade depends on the local CLI through `workspace:*`. The publish workflow syncs `apps/cli` and `apps/cortex` versions back.
- The homepage no longer gives the broken command `bunx @reactive-agents/cortex`; it uses `rax cortex`.
- Unsourced claims were cut: "30-50% of iterations", the "industry alignment" table, and the wrong task counts.
- The CLI reference and install pages match the code: the `CORTEX_TOKEN` requirement, Node/Bun runtimes, npm tabs, `--env-file`, and `type=module`.

### Agent-ready docs, at parity with Mastra's docs patterns

- Every page has a `.md` twin, and each twin starts with a "trust these docs over training data" preamble.
- A Copy page menu offers copy, view, Open in Claude and Open in ChatGPT.
- The quickstart has a copyable agent prompt and a "Quickstart for agents" section with a wrong-patterns table. A test checks it against `builder.ts`.
- `llms.txt` was rewritten with a page index.
- Every scaffolded project gets an `AGENTS.md` that points coding agents at `llms.txt`, the skills and `rax diagnose`.

### Try it without a key

- `rax demo`.
- `packages/diagnose/examples/failed-run.jsonl`: a real failed run, shipped in the npm package from 0.19. `rax-diagnose` blames the harness for it, not the model, which makes a credible demo.

### Harness and strategy quality (the 0.19 substance)

- Strategy substrate audit, G1 through G10:
  - Every strategy now gets the run's provider, context profile and calibration mode.
  - Strategy errors end on the shared terminal.
  - Reflexion's final pass decides the run status.
  - Code-action's approval refusal is scoped to tools it can actually call.
  - The environment notice is shown once per run.
- The repetition guard now blocks on information yield, not on call count.
- Approval policy now gates MCP tools that write, `.withAgentTool` sub-agents and tools registered after build. This was a security gap under every strategy.
- `rax-diagnose` gained a `strategy-error` cause, per-run segments and a status-override veto.
- H3 check, no regression: cogito:8b went from 20/60 to 27/60 (McNemar +7/-0, p=0.016). gemini-2.5-flash stayed flat at 46/60. Report: `wiki/Research/Harness-Reports/2026-11-19-strategy-substrate-wave-h3.md`.

## Open for 0.19 (coordinated across sessions; see the release plan below)

1. Pause stop-kind fix (Cortex session; runtime `execute-stream.ts`).
2. F1, the shared synthesis prompt: when the format is unknown it no longer says "prose", and "markdown report" phrasing is detected. F4, every act-phase guard block emits a `guard-fired` event.
3. `strategy-error` attributes to `harness:strategy-error`, with a docs row.
4. A `repetitionBackstop` setting (reasoning side, plus `.withHarness` wiring through runtime-warden).
5. Code-execute Python (measurement session; Docker path untested) and its docs.
6. A gemini-2.5-flash tier in `run-h3.ts`.
7. Commit the `bun.lock` drift (bun-types 1.4.4 to 1.4.5) so `--frozen-lockfile` passes.
8. Release gate: `release:dry 0.19.0`, clean install, build, typecheck, full test run, `repo ci`.

## Deferred past 0.19

- G5: reflexion budget split (needs a live ablation).
- L2 (arithmetic repeat-failure guard).
- L3 (write-time ungrounded-figure nudge).
- Tier heuristic cleanup.
- Plan-execute tool-visibility trace gap.
- Reflexion critique call still carries tool text with no tools declared. No `UNEXPECTED_TOOL_CALL` in 10 samples; watch it.
- Docs shipped inside npm packages (the Mastra `dist/docs` pattern).
- An opt-in `--skills` flag on the scaffolder.

## Positioning and reframe (owner decision pending)

- **Direction the owner leans to: the honest agent harness.** It answers the angriest community pain ("said it was done, wasn't": fake success and fabricated tool results), and outside coding tools no one owns it.
  - Candidate headline: "Know when your agent's 'done' is real."
  - Subline: open-source TypeScript agent harness. Every run leaves a trace and a receipt that flags claims with no tool evidence. `rax-diagnose` says why a failed run failed, harness or model, without rerunning it. The same code runs on a 4B Ollama model or a frontier API.
- **Alternatives scored:**
  - "Agents that show their work." Genkit's "Every step visible" is close.
  - "Agents that hold up on any model." Needs a with/without number. That measurement is on hold, and without it this line reads as a weaker version of Forge.
- **Truth rules:**
  - A receipt grades the evidence trail, not the truth. Say "flags", never "prevents".
  - `rax-diagnose` can return undetermined. Never say "every failure".
  - Signing is opt-in. Never say "signed" without "optional".
- **Wording:** say "harness", not "framework".
- **When the tagline is chosen, apply it in one pass to:**
  - the README;
  - the npm README and `package.json` description, which still say "typed 12-phase engine";
  - the docs hero and meta;
  - `llms.txt`;
  - GitHub About, which needs owner approval;
  - the awesome-list entries.
- **Launch mechanics:**
  - Post from an HN account with real comment history.
  - Post Tuesday to Thursday, 12:00-13:00 UTC.
  - Avoid the weeks of 2026-11-23 and 2026-12-21 to 2027-01-01.
  - Check Reddit sidebar rules by hand.
  - Lead with commands people can run (`rax demo`, the sample failed trace).
  - Answer in the thread.

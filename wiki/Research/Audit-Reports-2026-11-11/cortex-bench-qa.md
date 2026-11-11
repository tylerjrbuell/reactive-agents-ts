---
type: audit
status: complete
created: 2026-11-11
tags: [cortex, bench, qa, ui]
---

# Cortex Bench live QA (2026-11-11)

Live QA of the Cortex Bench redesign (spec `wiki/Architecture/Design-Specs/2026-11-10-cortex-ui-modernization.md`, steps 0-8 through `3bdca9981`). Run by cortex-warden on an isolated stack (server :4417, UI :5217, a scratch copy of the Cortex DB); the owner's :4321/:5173 stack and DB were not touched.

## Method

- **Static sweep.** A Playwright script loaded 10 routes (Beacon Board and Field, Chat, Runs, a finished run, a failed run, Lab, Settings, a Model page, a provider page) at 1280x800, 768x1024 and 1920x1080, in dark and light: 60 page loads. It recorded console errors and warnings, page errors, and elements past the viewport edge (unless an ancestor clips them), and took a screenshot of each page for review.
- **Empty and loading states.** The same pages ran with the list endpoints answering `[]`, then with every API call delayed 2.5s. Pages: Beacon, Runs, Chat, Lab saved agents, run view, Model page; 1280 and 768, dark and light. The script also looked for text cut off inside clipping containers.
- **Reduced motion.** `document.getAnimations()` on 9 pages under OS `prefers-reduced-motion` and under the Settings Motion choice. A run without reduced motion was the control: it found the orbs, the live glow, the rail, the sonar and the pulse, so the probe can see animations.
- **Live flows.**
  - A chat turn with a tool call (ollama `qwen3:4b`, `crypto-price`).
  - An abstained chat turn (`qwen3:4b`).
  - A desk run viewed while live, then Terminated.
  - A durable chat turn paused on an approval (test provider, scripted, `approvalPolicy: detach`). It was checked in chat, Runs, Beacon and the run view in light mode, approved from the chat card, then approved again through `POST /api/runs/:runId/approve`.

## Results by page

"Clean" means no console errors or warnings, nothing past the viewport edge, and no visual defect left after the fixes below.

| Page | 1280 dark | 1280 light | 768 dark | 768 light | 1920 dark | 1920 light |
|---|---|---|---|---|---|---|
| Beacon Board | clean | clean | clean | clean | clean | clean |
| Beacon Field | fixed (overlap) | fixed | fixed (overlap, stacking) | fixed | fixed | fixed |
| Chat | clean | clean (live turn) | fixed (rail) | fixed (rail) | clean | clean |
| Runs | clean | clean (waiting row) | clean | clean | clean | clean |
| Run view (finished) | fixed (title, loops, preview) | fixed | clean | clean | clean | clean |
| Run view (failed) | fixed (loops) | fixed | clean | clean | clean | clean |
| Run view (live, waiting, stopped) | fixed (duration, loading copy) | clean (waiting) | n/a | n/a | n/a | n/a |
| Lab | clean | clean | clean | clean | clean | clean |
| Settings | clean | clean | clean | clean | clean | clean |
| Model page | clean | clean | clean | clean | clean | clean |
| Provider page | clean | clean | clean | clean | clean | clean |

- The final sweep after the fixes: 60 of 60 loads had 0 console errors and 0 overflow.
- Empty and loading states: 40 loads, 0 errors, 0 clipped text.
- Reduced motion: 0 running animations on every page in both modes.

## Defects fixed (before / after)

| # | Defect (before) | After | Where |
|---|---|---|---|
| 1 | Beacon Field: nodes overlapped in the default layout. The spiral placement worked in percent and did not know the node size. Arrange used 6 rows in 60% of the height, about 68px apart for nodes about 104px tall. Every computed position was saved, so an overlapping layout stayed after a reload. | Nodes take free slots of a pixel grid sized to the measured Field. Sub-agents sit centred in the row under their parent. The plane grows to fit and scrolls, so 22 nodes at 768 no longer stack. Only dragged positions are saved (key `v2`). Arrange forgets drags and orders trees, then state lanes. The legend has an opaque chip. | `lib/beacon-layout.ts` (`fieldGrid`, `fieldHeightFor`, `layoutPositions` options), `BeaconCanvas.svelte`; 8 new tests. A reverted mutation (spiral roots) fails 5 of them. |
| 2 | Chat at 768: the 264px session rail stayed open, leaving about 500px for the transcript. The top-bar sessions button showed at every width but did nothing at 768px and up. | The rail is a drawer below 1024px. The sessions button shows only below 1024px. | `routes/chat/+page.svelte`, `TopBar.svelte` |
| 3 | A chat config with `calculator` (a tool the framework does not ship) showed it in the tools chip, but neither `/tools` nor the Tools settings had a row to untick it. | `/tools` lists selected tools that have no row, marked "not in the catalog", and unticking removes them. The Tools section shows them under "Also selected" with a remove action. | `unlistedTools` in `lib/chat-quickbar.ts`, `chat-menu-items.ts`, `ToolsSection.svelte`; 1 new test |
| 4 | An abstained `qwen3:4b` turn showed the model's decline as answer prose, then repeated the decline's first line (cut mid-word) in the "The agent abstained" note. | When the answer already holds the reason (`abstentionInAnswer`, which accepts a reason cut mid-word), the note reads "The agent declined; its reason is above" with no repeated text. Checked live. | Cortex `turn-ending.ts` (`abstentionInAnswer`, `endingNote(o, { reasonInAnswer })`), `ChatRunEndingNote`, `ChatTranscript`; 1 new test. The rule belongs in ui-core's transcript `ending` segment so builders' chat UIs get it too; it stays in Cortex because this mission's brief kept `packages/**` out of scope. |
| 5 | Run view title read `--- Conversation history ---` for a chat run whose session had been deleted. | Titles use the message after `--- Current message ---` (`taskHeadline`). Beacon labels use the same rule. | `lib/run-view.ts`, `stores/agent-store.ts`; 1 new test |
| 6 | The trace showed `Loop 1` twice, `Loop 2` twice, and so on, and the Loops tab counted 13 rows for 8 loops. The kernel sends `ReasoningIterationProgress` twice per iteration with the same number. | Same-iteration frames fold into one row (thought plus tools). Replay counts loops by distinct iteration. The vitals read `8 traced`. | `stores/trace-store.ts`, `lib/run-view.ts`; 2 new tests |
| 7 | A desk run terminated during its first model call read `Duration 3s` after about 2 minutes. Duration only moved on LLM completions and `AgentCompleted`. | `AgentStopped`, `AgentTerminated`, `ExecutionCancelled` and `TaskFailed` end the duration at the event's time. | `stores/run-store.ts` `updateVitals`; 1 new test |
| 8 | While a run loaded, the run view said "This run recorded no kernel loops.", "No step of this run was scored" and "No debrief was recorded". | Each says "Loading the run…" until the run loads. | `TracePanel`, `RunOverview`, `DebriefPanel` |
| 9 | The Answer preview kept `---` rules and list dashes, and dropped inline-code words (`` `hybrid` `` disappeared). | Rules, list, quote and heading markers, table rules and pipes are dropped. Inline code text is kept. | `lib/markdown/plain-preview.ts`; 1 new test |
| 10 | The approval toast ended in a bare agent ULID (`· 01M75CRYN1ZHG17DZ5`). | It names the call and its source (`· from a chat` / `· from a desk run`). | `stores/approval-watcher.ts` `approvalToastMessage`; new test file |
| 11 | The chat busy bar ran its animation forever while hidden (opacity 0). | The animation runs only while the bar shows. | `app.css` |
| 12 | The desk runner's launch log said `cortexUrl: http://127.0.0.1:4321` on a server running on another port (log only; events go straight to ingest). | The log honours `CORTEX_PORT`. | `server/services/runner-service.ts` |

## Listed, not fixed (with reason)

| Item | Why not fixed here | Owner / next step |
|---|---|---|
| A durable chat run that is approved and resumed stays `live` for good (Runs "1 live", the top bar "1 agent running", a glowing Field node). On resume, `AgentStarted` and `AgentCompleted` carry the durable run id (`3m64cafbzfxgp`), while the kernel events (`ReasoningStepCompleted`, `FinalAnswerProduced`) carry the original task id (`01M75CX1…`). Nothing ends the original row. | The cause is split run identity in the framework's durable resume. A Cortex-side close would have to guess by agent id. | runtime / durable runs: keep one task id across pause and resume, or emit a link event. Cortex can then close the paused row. |
| The framework emits `FinalAnswerProduced` with `"Run paused — awaiting human approval."` for a paused run, so the trace shows it as a Final answer. | A harness sentence in the answer field. Cortex must not filter harness text. | reasoning (kernel pause path): no `FinalAnswerProduced` on pause. |
| An abstained run's `AgentCompleted` / `StreamCompleted` carries `output` (the model's decline) where the contract says `""`. `abstention.reason` is the same text cut at 200 characters mid-word (`account statem`). | Framework contract. Cortex now handles both cases (fix 4). | runtime / reasoning: abstention output contract and the reason cut. |
| `AgentCompleted.totalIterations` is 23 for a run with 7 model calls and 8 loops (max 10). It equals the count of `ReasoningStepCompleted`, so the vitals read `Loops 23 · 8 traced`. | Framework counter. | runtime: `totalIterations` should count kernel loops. |
| `LLMRequestCompleted.provider` is `"anthropic"` for the `test` provider, and `LLMRequestStarted.provider` is `"unknown"` for ollama. The run view showed `anthropic / test-model`. | Framework event fields. Cortex prefers the completed event's provider on purpose (after routing). | llm-provider: report the real provider on both events. |
| `crypto-price` returned `notFound` for `bitcoin` asked by `qwen3:4b`. | Tool behaviour, outside Cortex. | tools: check the arguments `qwen3:4b` sent against the tool schema. |
| A `JudgmentFailed` event appears on every run: `HTTP 400 … 'nimble:latest' …` from the Ollama judgment backend. | Framework judgment backend config. | judgment: the default Ollama judge model. |
| Abstained runs read red "Failed" in Runs and on Beacon, while chat and the run view show a quiet "abstained". | Run summaries carry no ending. The fix needs a stored ending (a schema column, an ingest write from `AgentCompleted.terminationReason` and a backfill). That is a feature-sized change, and parsing `errorMessage` is not allowed. | cortex follow-up: `ending` on `cortex_runs`, then `runHeaderStatus` in `RunsTable` and `beaconStatusOf`. |
| The run view of a run waiting on approval shows Pause / Stop / Terminate and no Approve / Deny. Approval stays reachable through the toast, the Runs strip and the chat card. | Adding approval actions to the run header is a new control, out of scope for polish. | cortex follow-up (approval rules editor mission). |
| Runs with no label or chat read `Run 01M74X5X` with the id again under it. Beacon names the same runs `test · test-model`. | Run summaries carry no task, and both names are fallbacks. | cortex follow-up: carry the task headline on the summary. |
| The Settings server version reads `v0.10.6`, the workspace baseline. | By design: release stamps versions at tag time. | none |
| The 7 run inspector tabs wrap onto two rows in the 420px side column. | Deliberate and documented in `RunInspector.svelte`. | none |

## Verification

- UI `src/lib`: 810 before, 827 after, 0 fail. Server suite: 705 before, 705 after, 0 fail. ui-core is unchanged.
- `svelte-check`: 0 errors, 0 warnings. `bun run --cwd apps/cortex typecheck` is clean. The UI build passes.
- `bun run repo verify apps/cortex`: green. `bun run repo check --changed`: 17 pass, 0 fail.

## Addendum: approval rules editor (2026-11-11, cortex-warden)

Two follow-ups above are closed:

- **Abstained runs read Failed.** Runs now store their ending (`cortex_runs.ending`, ui-core `turnOutcomeOf` over `AgentCompleted`, backfilled once from each run's last `AgentCompleted`). Runs and Beacon read it through `runRowStatus`. Checked live: a `qwen3:14b` chat turn that abstained reads **Abstained** in Runs and on Beacon; the credit-failure run beside it still reads **Failed**.
- **No Approve / Deny in the run view.** The header shows `Approve <call>?` with **Approve** and **Deny** while a run waits on an approval (the endpoints take the approval's durable run id). Checked live: approving from the header resumed the paused chat run.

New: the Lab builder (Reasoning, **Approvals**) and chat (`/approvals`) edit the framework's `approvalPolicy`: tools, shell command rules and the mode.

Live check (stack on 4417/5217, scratch DB, scratch git repo, `ollama` `qwen3:14b`, `tools: ["git"]`, rule `git commit`, mode `detach`):

1. The Lab editor normalized `git   commit` to `git commit` and switched durable execution on.
2. The chat turn paused on `git commit -m "Add second line"`. Approved from the run view header, it ran (nothing staged, so git committed nothing).
3. The agent then asked for `git add notes.txt && git commit …`, which paused (segment match). Approved from the chat card, the read-only `git` preset still refused `git add`: only rule-matched writes run after approval. That is the framework's documented rule, and the docs now say it.
4. `/approvals add git add` added the rule from the chat menu. The next turn paused on the same command; nothing was committed until **Approve**. After Approve, commit `0288fa2 Add second line` landed.

Findings for other owners:

| Finding | Owner |
|---|---|
| A run approved with a command that holds an unmatched write segment (`git add` with only a `git commit` rule) is refused after the user approved it. The approval card does not say that part will be refused. Showing which segments the read-only shell will refuse, before the user decides, needs the matcher exposed from `@reactive-agents/tools`. | tools / ui-core |
| A gated `shell-execute` that the framework auto-gates (full shell) and the read-only preset both report as `shell-execute`, so the approval card cannot tell the user which shell asked. | tools |
| The Runs status segment groups Abstained and Partial with **Waiting** (all are the ui-core `attention` tone). The label reads as "waiting on you". | cortex follow-up: rename the segment, or split it |

Verification: server suite 705 before, 720 after, 0 fail. UI `src/lib` 827 before, 847 after, 0 fail. `bun run --cwd apps/cortex typecheck`, `svelte-check` and the UI build are clean. Pins proven by reverting the ingest ending write and the AgentConfig `approvalPolicy` mapping (2 tests failed, then passed when restored).

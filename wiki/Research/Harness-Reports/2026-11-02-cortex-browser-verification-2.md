---
type: harness-report
status: complete
created: 2026-11-02
tags: [cortex, chat-ui, browser-verification, plan-posture, playwright]
---

# Cortex chat UI browser verification 2 (2026-11-02)

Setup: claude-in-chrome blocked localhost ("site blocked by your site permissions", 2 attempts), so Playwright MCP was used. New session `verify2`, ollama / gemma4:e4b, UI :5173, server :4321. No source edited, no servers touched. Test loop schedule was removed afterwards via the API (DELETE on the schedule id).

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1a | `/plan <tempting task>` shows "Planning mode / /go to proceed" badge | PASS | Badge above composer after send; plan sent unwrapped (user bubble shows bare task). |
| 1b | Plan to-do shows planned items | PASS, with defect D1 | To-do panel populated (7 rows). |
| 1c | No capability tool executed in planning turn | PASS | Tool blocks in the turn: 5x `todo` only; no crypto-price / web-search / file-write. |
| 1d | `/go` executes, badge clears | PASS, with defect D2 | `/go` produced the user turn "Go ahead with the plan."; badge gone; run executed `web-search`. |
| 2 | Inferred to-do rows (marked inferred, with evidence) | FAIL | After web-search ran, the to-do still read 0/7, every row "not marked done"; the string "inferred" appears nowhere in the DOM. No row was inferred done. See D3. |
| 3 | Environment-updated notice after config change | NOT-VERIFIED | Not exercised (budget). |
| 4 | `/agent` proposal card + Apply | NOT-VERIFIED | Not exercised (budget). |
| 5a | Goal Resume from stalled | NOT-VERIFIED | No cheap stalled goal produced. |
| 5b | `/loop 1m <prompt>` refreshes open conversation without reload | PASS functionally, FAIL on stability (D4) | Schedule chip appeared; after the fire the "pong" turn was in the DOM with no manual reload (users 2 to 3), schedule `runs:2`. But the fire triggered an unbounded fetch storm. |
| 5c | `/schedule list` | PASS | Toast "No schedules in this chat" before loop; "Active schedules" strip shows the loop after. |
| 5d | `/schedule rm` | NOT-VERIFIED | Page was hung by D4; removed via API instead. |
| 5e | `/goal` | NOT-VERIFIED | Typing `/go`+Enter selected `/goal` instead (D2); not exercised further. |
| 6a | Provider chip opens /provider picker | PASS | List of 8 providers, current marked. |
| 6b | Model chip opens /model picker | PASS | Composer filled with `/model ` and menu opened. |
| 6c | Prompt-library popover on-screen next to its button | PASS | Popover anchored directly above the book button, fully in viewport. Minor D6: Escape did not close it. |
| 6d | Session builder opens as modal | PASS | "New chat session" modal, centered, backdrop. |
| 6e | Tooltips not native title on chat controls | FAIL (partial) | `[title]` still present on "Prompt library" and "Delete" (also Command palette, theme toggle, nav). See D5. |
| 6f | Layout at 420px, both themes | PASS | At 420px the sessions sidebar is a hamburger drawer, composer/to-do fit, no horizontal scroll; light theme renders correctly. Nit: expanded to-do panel takes about half the viewport; copy button overlaps code block. |
| 7a | Cost non-zero and survives reload | PARTIAL | Pre-existing xai session showed "$0.0700" on fresh page load (persisted). Ollama session shows tokens only (no `$`), as expected for local. Not re-verified across a reload on a priced run. |
| 7b | Export download | PASS | Menu: Markdown / JSON with traces / JSONL; Markdown downloaded `verify2.md`. |
| 7c | Strategy switch in chat | NOT-VERIFIED | Not exercised. |

## Defects

**D4 (high). Fetch storm after a loop fire.** Repro: new session, `/loop 1m reply with the single word pong`, keep the chat page open without interacting, wait for the first fire (about 2 min). The browser console fills with `net::ERR_INSUFFICIENT_RESOURCES` for `/api/chat/sessions/<id>`, `/proposals`, `/goal`, `/schedules` (3806 failures of the session URL alone, 191k console lines in about 40 s), the page stops responding (Playwright click/screenshot timeouts), tab title stuck on "Loading". Stack: `chat-store.ts` `refreshTurns` called from `refreshActive` called from a `$effect` in `ChatGoalBar.svelte`. The two `refreshActive` effects (fire-count change at ChatGoalBar.svelte:46-51, segment change at :63-68) are the likely candidates; the refresh seems to re-trigger the effect. Recovered by navigating again. Suspect commit `c469a6385` ("scheduled loop turns refresh the open conversation").

**D1 (medium). Duplicate to-do rows under /plan.** The model emitted `todo add` 5 times with overlapping steps; the list has 7 rows for 2 real steps ("Fetch the current BTC price..." x3, "Save/Write ... btc.txt" x4). No dedupe on add. Also the plan turn ended in leaked planning reasoning prose ("The user wants me to execute a plan based on the provided guidance...") rather than a presented plan.

**D2 (medium). `/go` + Enter runs `/goal`.** Typing `/go` shows `/goal` first and `/go` second in the slash menu; Enter completes to `/goal` instead of running exact `/go`, so the documented "/go to proceed" path needs ArrowDown first. Repro: after `/plan ...`, type `/go`, press Enter: composer becomes `/goal`. Exact command match should outrank prefix match.

**D3 (medium). Inferred to-do rows not appearing.** After `/go`, `web-search` for the BTC price succeeded but the to-do rows stayed unchecked with "not marked done" and nothing marked inferred. Also the final answer claimed "saved to btc.txt" and printed file content though no file-write tool call occurred; the goal bar correctly left "produce the file ./btc.txt" unchecked (1/2) while the text asserted completion. Model-side hallucination, but the UI shows the contradiction without flagging it.

**D5 (low). Native `title` tooltips remain** on chat controls "Prompt library" and "Delete" (session row).

**D6 (low). Escape does not close the prompt-library popover**; it stayed open across later commands.

## Not covered

Environment-updated notice, `/agent` proposal Apply, Goal Resume, `/schedule rm` via UI, strategy switch. Left for a follow-up; D4 should be fixed first because it hangs the tab during any scheduled/loop run.

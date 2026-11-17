# Cortex docs screenshots

Generates the Cortex images for the docs and the README from a hermetic demo Cortex.
No keys, no network, no real data: the agents run on the scripted `test` provider, and everything
lives in a temp directory. `~/.reactive-agents` and your real `.cortex/` are never read or written.

## Run

```bash
bun run --cwd apps/cortex build:ui                         # the shots show ui/build: rebuild first after UI changes
bun run --cwd apps/cortex screenshots:docs                 # every stable shot
bun run --cwd apps/cortex screenshots:docs --only tools-lab,channels-hub
bun run --cwd apps/cortex screenshots:docs --include-pending   # also shots whose UI is still moving
bun run --cwd apps/cortex screenshots:docs --out /tmp/a   # write somewhere else
bun run --cwd apps/cortex screenshots:docs --out /tmp/b --compare /tmp/a   # determinism check
```

Output: `apps/docs/public/screens/cortex/<id>.webp` and `manifest.json` (file, status, caption, alt text,
route, size, sha256, note; Cortex version from `VERSION`, capture date). A run only rewrites the shots it
captured; other manifest entries keep their last values.

## What it does

1. Wipes the demo dir (`/tmp/cortex-docs-demo`, `DEMO_DIR`). Every process is spawned with `HOME` set to it:
   Bun reads `HOME` for `os.homedir()` once, at start, so setting it later does nothing. `demo-server.ts` and
   `seed.ts` refuse to run unless `homedir()` is the demo dir (fail closed). Provider key env vars are removed.
2. Shots are grouped by dataset: `empty` (a Cortex with no data: the Beacon first-run view) first, then `demo`.
3. For `demo`: `seed.ts` writes chat states BEFORE the server starts (a pending approval is restored from the durable
   store when the server boots), then `demo-server.ts` starts Cortex on port 4399 (`DEMO_PORT`), then `seed-http.ts` adds
   what needs the API: two MCP servers that connect (`fake-mcp.ts` over stdio) and one that fails, a webhook channel that
   runs plus Telegram and Signal channels saved switched off.
4. `run.ts` drives the built UI with Playwright at 1440x900 @2x, dark theme, UTC, a frozen browser clock, then writes
   WebP downscaled to 1440 wide (sharp, quality 82, budget 200 KB).

Seeded chat states (`seed.ts`): a plan-mode chat (run for real by the Execute shot), a durable run the person stopped
(a real Stop through the chat control), a run that spent its step budget (real, the framework's own stop), and a
durable turn paused on a `file-write` approval.

## Prerequisites

- A built UI (`build:ui`).
- `playwright-core` and a Chromium. The script uses the repo's `playwright-core` if installed, else the copy in the bun
  cache (`~/.bun/install/cache/playwright-core`). Browsers come from `~/.cache/ms-playwright`
  (`bunx playwright-core install chromium` if missing). Nothing is downloaded by the script.
- `sharp` (already in the repo's `node_modules`).

## Determinism rules

- Fixed viewport, scale, scheme, locale, timezone; caret hidden; toasts hidden (they carry run ids).
- Reduced motion on and animations disabled, except a shot with `motion: "full"`: its capture freezes every CSS animation
  at a fixed time (`freezeAnimations`, the Beacon uses 2.0 s). JS-driven motion would not be frozen: `--compare` catches it.
- Browser clock frozen after the seed, so relative times read "just now".
- Text that varies between runs (random ids, pids, secret tails, measured ms, event numbers) is replaced with fixed
  text by `MASKS` in `shots.ts`; a readout that exists only some of the time is hidden with a shot's `hideText`.
  If `--compare` reports a changed image, find the region (`magick compare ... -threshold`), add a rule, run again.
- Never add a shot that needs a real key, a real network call or a personal path.

## Add a shot

Add an entry to `SHOTS` in `shots.ts`: `id`, `route`, `caption`, `alt`, optional `width`/`height`/`scheme`/`dataset`/
`motion`/`note`, and `capture({ page, base, sessionId, runId })` that navigates and waits for the state (wait on text,
never on timeouts alone). Seed anything new in `seed.ts` (chat state) or `seed-http.ts` (API). Mark it `status: "pending"`
until its UI is final; pending shots are skipped unless named with `--only` or `--include-pending`. Then run `--only <id>`
twice with `--compare`.

## Captions must stay true

- State only what the shot shows. "On by default" is used only where the code says so: durable runs
  (`server/services/durable-default.ts`, `ui/src/lib/durable-runs.ts`; the framework default stays off) and learned and community
  calibration being OFF by default (`packages/runtime/src/builder/withers/calibration.ts`).
- The plan, stop, budget and approval shots use the scripted provider: step results are scripted, so captions describe the
  UI, not model quality.

## Refresh at release

Rebuild the UI, run `screenshots:docs`, read every image back (no keys, tokens, usernames or personal paths), run it twice with
`--compare`, commit the images and `manifest.json` together.

## Known limits

- `chat-plan-executed` runs the plan with Plan-execute-reflect: with the scripted provider, Auto ran as a plain Execute turn
  and Blueprint returned no per-step results. The plan card does not stay in the thread after the run in this flow; the shot
  shows the reply and the to-do list ticked off.
- `model-calibration` is pending: the label "applied only when learned calibration is on" shows only for a model that has learned
  values, which needs a shipped-calibration model plus recorded runs in `calibration.db`. The hermetic home has none.
- The run-cause diagnosis on a step-budget stop reads "At fault: Harness: tool call dropped" (the call the cap cut off). That is the
  framework's own answer, not a script artifact, but check the wording before using the image beside a claim.
- Dark theme only.

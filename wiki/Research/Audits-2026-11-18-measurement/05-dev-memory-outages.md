---
type: audit
status: active
created: 2026-11-18
tags: [tooling, oom, tmpfs, tests, dev-machine]
---

# Dev-machine memory outages (2026-11-17/18)

## Root cause

`/tmp` is RAM-backed tmpfs (16 GB). 308 TypeScript files call `mkdtemp`/`os.tmpdir()`; 263 of them (all but about 45) have no matching cleanup call. `scripts/test-preload.ts` removed only its own trace/runs dirs, and only in `process.on("exit")`, which does not run on SIGKILL, OOM kill or timeout. Peak: 7.2 GB, ~33,000 entries. Kernel OOM kills since 2026-11-17: 9 in the journal (VS Code 11-17 23:53 and 11-18 16:08, Chrome 11-17 21:29).

Leak volume by prefix at peak (from the brief): ra-test-traces 2.0 GB / 2,371 dirs, ra-test-runs 695 MB / 723, rax-clean-install-test 596 MB / 596, then corrective-guard 1,269, w3b-triad 1,036, ra-ep 812, ra-wb 572, ra-k1-outcome 484, ra-tolerance 480, ra-edit 468, ra-autoshadow 437, ra-authority 363 dirs (small each). Count by package of files using tmpdir: runtime 101, cortex 50, benchmarks 32, tools 26, tools/repo 19.

No shared test helper existed. Editing 263 files is the wrong boundary; the boundary is `TMPDIR`.

## Fix (shipped)

- One temp root per test process: `<tmp>/ra-tests-<pid>-<rand>/`. `repo test` creates it, sets `TMPDIR` and `RA_TEST_TMP_ROOT` for `bun test`, removes it in `finally` and on process exit. `scripts/test-preload.ts` does the same for raw `bun test` (root, `TMPDIR`, cleanup on exit/SIGINT/SIGTERM, startup sweep of dead-PID roots by name only). Every suite that calls `os.tmpdir()` is covered without edits.
- `bun run repo janitor [--dry-run]` (`tools/repo/src/lib/tmp-janitor.ts`, pure `sweep` over an injectable fs + pid probe, tested in `tools/repo/tests/tmp-janitor.test.ts`): reaps dead-PID roots at any age, and legacy prefixes (ra-*, corrective-guard, w3b-triad, rax-clean-install-test, ingest-, rooted-heal, cortex-chat-, cal-config-test- and others) older than 60 min. Never touches live-PID roots or `repo-test-slots-*`. Runs at the start of `repo test`, `repo verify`, `repo ci`.
- Memory guard (`lib/mem-guard.ts`): `repo test/verify/ci` warn at MemAvailable < 3 GB or tmpfs temp > 50% full; refuse at < 1 GB or > 80%, printing `bash scripts/mem-watch.sh`. Constants, no override (an override would be a bypass).
- `scripts/mem-watch.sh [--watch]`: MemAvailable, temp usage, top RSS, `ollama ps`. Read-only.
- Opt-in `REPO_TEST_MEM_MAX=8G`: `bun test` runs under `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0`. Verified working on this machine (`systemd-run --user --scope -p MemoryMax=2G -p MemorySwapMax=0 true`). Opt-in because a legitimately large suite would be killed by a wrong cap.
- Opt-in `REPO_TEST_TMPDIR=$HOME/.cache/ra-tmp`: test roots on disk. Tradeoff: slower fs-heavy tests, SSD writes; zero RAM pressure. The janitor scans it too.

Dry-run at report time (after another session had already deleted most of the peak): 1,070 dirs, 159 MB reapable, 0 live roots touched. Peak numbers were not re-measured. `/tmp` was at 3.6 GB; of that, `/tmp/claude-1000` is 2.9 GB (Claude Code scratch, not a test dir, untouched) and `node-compile-cache` 595 MB.

## Not built (owner decisions, cost/benefit)

| Option | Benefit | Cost |
|---|---|---|
| Default-on `REPO_TEST_MEM_MAX` | Runaway test dies in its own cgroup | Needs a measured per-chunk peak first; wrong cap = false kills |
| Default-on `REPO_TEST_TMPDIR` on disk | Removes tmpfs as an OOM vector | Slower fs tests; needs a `.cache` dir policy |
| Concurrency cap on `tsc`/`turbo` | Test slots already cap `bun test` (max(2, cores/3)); tsc/turbo are uncapped | `bunx turbo run ... --concurrency=4` in the commands wardens run |
| Warden rule: at most 2 heavy processes (bun test, tsc, turbo, build) at once per warden | Fewer simultaneous peaks | Edit to `.claude/agents` / `wardens.yaml`: owner-owned, not done |
| Clean `/tmp/claude-1000` | 2.9 GB | Owned by Claude Code, not this repo |

## Owner commands (system level, not applied)

Cap /tmp so it cannot exceed 6 GB (Fedora/Nobara `tmp.mount`):

```
sudo systemctl edit tmp.mount
# add:
# [Mount]
# Options=mode=1777,strictatime,nosuid,nodev,size=6G
sudo systemctl daemon-reload && sudo systemctl restart tmp.mount   # clears /tmp; reboot if busy
```

Or move /tmp to disk: `sudo systemctl mask tmp.mount` and reboot.

Swap/zram (Fedora default is zram-generator; check with `zramctl`):

```
sudo tee /etc/systemd/zram-generator.conf <<'EOF'
[zram0]
zram-size = ram / 2
compression-algorithm = zstd
EOF
sudo systemctl restart systemd-zram-setup@zram0.service
```

Kill the right process first: systemd-oomd (check `systemctl status systemd-oomd`) or earlyoom:

```
sudo dnf install earlyoom
# /etc/default/earlyoom:
# EARLYOOM_ARGS="-m 5 -s 10 --prefer '(^|/)(bun|tsc|node|ollama)$' --avoid '(^|/)(code|plasmashell|kwin_wayland|Xorg)$'"
sudo systemctl enable --now earlyoom
```

Ollama resident cap (systemd override, `sudo systemctl edit ollama`):

```
[Service]
Environment="OLLAMA_KEEP_ALIVE=2m"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
```

Detect non-bench loaded models and their RSS: `curl -s localhost:11434/api/ps` (model name, `size`, `size_vram`; RAM part = size - size_vram) and `ps -C ollama -o rss=,pid=`. `bash scripts/mem-watch.sh` prints `ollama ps`. The bench preflight already flags foreign loads; extending it to print RSS is a `packages/benchmarks` change (not in this authority).

## Known gaps

- Janitor legacy age gate is by directory mtime, 60 min. A live process using a legacy-named dir idle for over 60 min could lose it; new runs are protected by the PID root.
- If `repo test` is SIGKILLed while its `bun test` child lives on, the root is reaped by dead PID under the orphan. Rare; the child is also killed by the 600 s cap in normal timeouts.
- `/tmp` entries outside the listed prefixes (cortex-chat-*.db-wal, cal-config-test-*.sqlite-*) are only partly covered; new leaking suites outside `TMPDIR` (hard-coded `/tmp`) are not caught by the root.

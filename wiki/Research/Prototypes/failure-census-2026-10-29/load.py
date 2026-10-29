"""Trace loader shared by the failure census. Dedupes by runId across sources."""
import glob, json, os, re

HOME = os.path.expanduser("~")
REPO = os.path.join(HOME, "Documents/AIProjects/reactive-agents-ts")

# (label, glob). Order = precedence when the same runId appears twice.
SOURCES = [
    ("live-traces", HOME + "/.reactive-agents/traces/*.jsonl"),
    ("trash-traces", HOME + "/.local/share/Trash/files/.reactive-agents (1)/traces/*.jsonl"),
    ("forge-agent", HOME + "/Documents/AIProjects/forge/app/data/agent-traces/*.jsonl"),
    ("benchmark-traces", REPO + "/packages/benchmarks/benchmark-traces/*.jsonl"),
    ("gate-traces", REPO + "/wiki/Research/Harness-Reports/gate-traces/*/*.jsonl"),
    ("job-tmp", HOME + "/.claude/jobs/*/tmp/trace-*/*.jsonl"),
]

SYNTHETIC_MODELS = {"test", "test-model", "m", "m1", "m2", "sentinel-model", "other",
                    "nimble", "model-a", "model-b", "", None}


def is_real(model, provider):
    return model not in SYNTHETIC_MODELS and provider != "test"


def iter_runs(sources=SOURCES):
    """Yield (source, path, runId, [events]). One trace file == one run in practice."""
    seen = set()
    for label, pat in sources:
        for path in sorted(glob.glob(pat)):
            try:
                with open(path, errors="replace") as fh:
                    evs = []
                    for ln in fh:
                        ln = ln.strip()
                        if not ln:
                            continue
                        try:
                            evs.append(json.loads(ln))
                        except ValueError:
                            pass
            except OSError:
                continue
            if not evs:
                continue
            rid = next((e.get("runId") for e in evs if e.get("runId")), os.path.basename(path))
            if rid in seen:
                continue
            seen.add(rid)
            yield label, path, rid, evs

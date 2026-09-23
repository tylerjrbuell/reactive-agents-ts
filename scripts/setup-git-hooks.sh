#!/usr/bin/env bash
# Point git at the repo-tracked .githooks/ dir and make its scripts executable.
# Safe to re-run. Run automatically by the root `postinstall` script so every
# clone gets the hooks without a manual step.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

chmod +x "$REPO_ROOT"/.githooks/*
git -C "$REPO_ROOT" config core.hooksPath .githooks

echo "git hooks: core.hooksPath -> .githooks (commit-msg, pre-commit)"

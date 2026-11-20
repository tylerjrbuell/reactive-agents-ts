#!/usr/bin/env bash
# actionlint over .github/workflows: syntax, expression types, job/step
# references, action inputs, runner labels. Workflow logic otherwise first
# executes on GitHub, often at a tag (v0.19.1 docs deploy, v0.18/v0.19 release
# body). Repo deploy policy is the separate `workflow-invariants` builtin.
#
# Binary: `actionlint` on PATH if it is the pinned version, else the release
# tarball for this platform, verified against the pinned SHA-256 and cached
# under node_modules/.cache/actionlint/<version>/. If that fails (offline,
# unsupported platform) the check SKIPS with a warning locally and FAILS when
# CI is set (GitHub Actions sets CI=true), so CI always lints.
#
# shellcheck/pyflakes integration is off: CI runners have shellcheck and most
# dev machines do not, so leaving it on would make CI stricter than local
# (the parity gap this gate exists to close).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="1.7.12"
# From actionlint_1.7.12_checksums.txt on the v1.7.12 GitHub release.
sha_for() {
  case "$1" in
    linux_amd64) echo "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8" ;;
    linux_arm64) echo "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6" ;;
    darwin_amd64) echo "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644" ;;
    darwin_arm64) echo "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f" ;;
    *) echo "" ;;
  esac
}

unavailable() {
  if [ -n "${CI:-}" ]; then
    echo "check-actionlint: FAILED: $1 (required in CI)"
    exit 1
  fi
  echo "⚠ check-actionlint: SKIPPED: $1. Install actionlint $VERSION or rerun online; CI runs it."
  exit 0
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

BIN=""
if command -v actionlint >/dev/null 2>&1 && actionlint -version 2>/dev/null | head -n1 | grep -qxF "$VERSION"; then
  BIN="$(command -v actionlint)"
else
  CACHE="$ROOT/node_modules/.cache/actionlint/$VERSION"
  BIN="$CACHE/actionlint"
  if [ ! -x "$BIN" ]; then
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    arch="$(uname -m)"
    case "$arch" in x86_64 | amd64) arch="amd64" ;; aarch64 | arm64) arch="arm64" ;; esac
    platform="${os}_${arch}"
    want="$(sha_for "$platform")"
    [ -n "$want" ] || unavailable "no pinned actionlint build for $platform"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    url="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/actionlint_${VERSION}_${platform}.tar.gz"
    curl -fsSL "$url" -o "$tmp/actionlint.tar.gz" 2>/dev/null || unavailable "could not download $url"
    got="$(sha256_of "$tmp/actionlint.tar.gz")"
    if [ "$got" != "$want" ]; then
      echo "check-actionlint: FAILED: checksum mismatch for $url (got $got, pinned $want)"
      exit 1
    fi
    tar -xzf "$tmp/actionlint.tar.gz" -C "$tmp" actionlint
    mkdir -p "$CACHE"
    mv "$tmp/actionlint" "$BIN"
    chmod +x "$BIN"
  fi
fi

cd "$ROOT"
files=(.github/workflows/*.yml)
"$BIN" -shellcheck= -pyflakes= "${files[@]}"
echo "actionlint $VERSION: ${#files[@]} workflows clean"

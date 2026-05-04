#!/usr/bin/env bash
set -euo pipefail

# Signal Registration Helper
#
# Two modes:
#   link     — Link as secondary device (keeps your phone active, recommended)
#   register — Register as primary device (logs out ALL other devices on this number!)
#
# Usage:
#   ./scripts/signal-register.sh link +1234567890 [data-dir]
#   ./scripts/signal-register.sh register +1234567890 [data-dir]

MODE="${1:?Usage: $0 <link|register> +1234567890 [data-dir]}"
PHONE="${2:?Usage: $0 <link|register> +1234567890 [data-dir]}"
DATA_DIR="${3:-./signal-data}"
IMAGE="ghcr.io/reactive-agents/signal-mcp"

if [[ "$MODE" != "link" && "$MODE" != "register" ]]; then
  echo "Error: first argument must be 'link' or 'register'"
  echo "  link     — Add as linked device (recommended, keeps other devices active)"
  echo "  register — Primary registration (WARNING: logs out all other devices)"
  exit 1
fi

# Fall back to local build if published image not available
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Published image not found. Building locally..."
  IMAGE="signal-mcp:local"
  docker build -t "$IMAGE" docker/signal-mcp/
fi

# Ensure data dir exists and is writable by container UID 1000
mkdir -p "$DATA_DIR"
chmod 777 "$DATA_DIR"

REAL_DATA_DIR="$(realpath "$DATA_DIR")"

echo "=== Signal Registration ==="
echo "Mode:  $MODE"
echo "Phone: $PHONE"
echo "Data:  $REAL_DATA_DIR"
echo ""

if [[ "$MODE" == "link" ]]; then
  # ── Link mode: add as secondary device ──────────────────────────────────
  echo "This will link signal-cli as a secondary device on your account."
  echo "Your phone and other devices will stay active."
  echo ""
  echo "Scan the QR code below with your phone:"
  echo "  Signal -> Settings -> Linked Devices -> '+' -> Scan QR code"
  echo ""
  echo "Waiting for signal-cli to generate link URI..."
  echo ""

  # Run signal-cli link inside bash so we can pipe its output through
  # qrencode for a scannable terminal QR code, then wait for completion.
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$REAL_DATA_DIR:/data:rw" \
    -e SIGNAL_CLI_CONFIG=/data \
    --entrypoint bash \
    "$IMAGE" \
    -c 'signal-cli --config /data link -n "reactive-agents" 2>&1 | while IFS= read -r line; do
      echo "$line" >&2
      if echo "$line" | grep -q "^tsdevice://\|^sgnl://"; then
        echo "" >&2
        qrencode -t ANSIUTF8 "$line" >&2
        echo "" >&2
        echo "Scan the QR code above, then wait for linking to complete..." >&2
      fi
    done'

else
  # ── Register mode: primary device ───────────────────────────────────────
  echo "⚠️  WARNING: This will register as a NEW primary device."
  echo "   All other devices on $PHONE will be LOGGED OUT."
  echo ""
  read -rp "Type 'yes' to continue: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi

  echo ""
  echo "Step 1: Solve the captcha"
  echo "  • Open ONLY: https://signalcaptchas.org/registration/generate.html"
  echo "    (Do not use /challenge/ — that token is for a different flow.)"
  echo "  • After solving, click the \"Open Signal\" link under the captcha."
  echo "  • Right‑click \"Open Signal\" → Copy link."
  echo "    The URL must look like: signalcaptcha://signal-hcaptcha....registration...."
  echo "    Do NOT use sgnl://linkdevice?... (that is for linking a phone, not register.)"
  echo "  • Solve the captcha from a browser on the SAME public IP as this machine"
  echo "    (same Wi‑Fi / no VPN mismatch), and paste within ~1–2 minutes — tokens expire."
  echo ""
  echo "Tip: If you already use Signal on your phone, abort and run:"
  echo "  $0 link $PHONE $DATA_DIR"
  echo "  …to link this CLI as a secondary device (no captcha)."
  echo ""
  read -rp "Paste the full signalcaptcha:// URL (or token): " CAPTCHA

  # Trim whitespace; avoid embedding the token in shell -c (breaks on $ ` ! ' \" etc.)
  CAPTCHA="${CAPTCHA#"${CAPTCHA%%[![:space:]]*}"}"
  CAPTCHA="${CAPTCHA%"${CAPTCHA##*[![:space:]]}"}"

  if [[ "$CAPTCHA" != signalcaptcha://* && "$CAPTCHA" != signal-hcaptcha* ]]; then
    echo ""
    echo "Warning: Expected a string starting with signalcaptcha:// or signal-hcaptcha."
    echo "If you copied from the wrong place, registration will fail with \"Invalid captcha\"."
    read -rp "Continue anyway? [y/N]: " CONT
    if [[ "${CONT,,}" != "y" ]]; then
      echo "Aborted."
      exit 1
    fi
  fi

  echo ""
  echo "Step 2: Register + verify..."
  docker run -it --rm \
    --user "$(id -u):$(id -g)" \
    -v "$REAL_DATA_DIR:/data:rw" \
    -e SIGNAL_CLI_CONFIG=/data \
    -e SIGNAL_PHONE="$PHONE" \
    -e SIGNAL_CAPTCHA="$CAPTCHA" \
    --entrypoint bash \
    "$IMAGE" \
    -c 'signal-cli --config /data -a "$SIGNAL_PHONE" register --captcha "$SIGNAL_CAPTCHA" && echo "" && read -rp "Enter the SMS verification code for ${SIGNAL_PHONE}: " CODE && signal-cli --config /data -a "$SIGNAL_PHONE" verify "$CODE"'
fi

echo ""

# Verify auth data was written
if ls "$REAL_DATA_DIR"/data/+* >/dev/null 2>&1 || ls "$REAL_DATA_DIR"/data/*.d/ >/dev/null 2>&1; then
  echo "✓ Registration complete. Auth data stored in: $REAL_DATA_DIR"
  echo ""
  echo "Contents:"
  ls -la "$REAL_DATA_DIR/data/" 2>/dev/null || ls -la "$REAL_DATA_DIR/" 2>/dev/null
else
  echo "⚠ WARNING: No auth data found in $REAL_DATA_DIR"
  echo "  Check permissions and try again."
  echo ""
  echo "Debug: directory contents:"
  ls -laR "$REAL_DATA_DIR/" 2>/dev/null || echo "  (empty)"
  exit 1
fi

echo ""
echo "Add to your .env:"
echo "  SIGNAL_PHONE_NUMBER=$PHONE"

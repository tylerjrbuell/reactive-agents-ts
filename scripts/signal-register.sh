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
  echo "  Open: https://signalcaptchas.org/registration/generate.html"
  echo "  Solve the captcha, then right-click 'Open Signal' and copy the link."
  echo ""
  read -rp "Paste the signalcaptcha:// URL: " CAPTCHA

  echo ""
  echo "Step 2: Register + verify..."
  docker run -it --rm \
    --user "$(id -u):$(id -g)" \
    -v "$REAL_DATA_DIR:/data:rw" \
    -e SIGNAL_CLI_CONFIG=/data \
    --entrypoint bash \
    "$IMAGE" \
    -c "signal-cli --config /data -a '$PHONE' register --captcha '$CAPTCHA' && echo '' && read -rp 'Enter the verification code sent to $PHONE: ' CODE && signal-cli --config /data -a '$PHONE' verify \"\$CODE\""
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

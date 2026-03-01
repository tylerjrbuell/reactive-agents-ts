#!/usr/bin/env bash
set -euo pipefail

# Signal Registration Helper
# Registers a phone number with signal-cli for agent use.
#
# Usage: ./scripts/signal-register.sh +1234567890 [data-dir]
#
# Signal requires a captcha for registration:
#   1. Open https://signalcaptchas.org/registration/generate.html
#   2. Solve the captcha
#   3. Right-click "Open Signal" link → copy link address
#   4. Paste the signalcaptcha:// URL when prompted
#
# After registration, auth data is stored in the data directory
# and volume-mounted into the Docker container on subsequent runs.

PHONE="${1:?Usage: $0 +1234567890 [data-dir]}"
DATA_DIR="${2:-./signal-data}"
IMAGE="ghcr.io/reactive-agents/signal-mcp"

# Fall back to local build if published image not available
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Published image not found. Building locally..."
  IMAGE="signal-mcp:local"
  docker build -t "$IMAGE" docker/signal-mcp/
fi

mkdir -p "$DATA_DIR"

echo "=== Signal Registration ==="
echo "Phone: $PHONE"
echo "Data:  $DATA_DIR"
echo ""

echo "Step 1: Solve the captcha"
echo "  Open: https://signalcaptchas.org/registration/generate.html"
echo "  Solve the captcha, then right-click 'Open Signal' and copy the link."
echo ""
read -rp "Paste the signalcaptcha:// URL: " CAPTCHA

echo ""
echo "Step 2: Requesting verification code..."
docker run -it --rm \
  -v "$(realpath "$DATA_DIR"):/data:rw" \
  -e SIGNAL_CLI_CONFIG=/data \
  --entrypoint signal-cli \
  "$IMAGE" \
  -a "$PHONE" register --captcha "$CAPTCHA"

echo ""
echo "Step 3: Enter the verification code sent to $PHONE:"
read -r CODE

docker run -it --rm \
  -v "$(realpath "$DATA_DIR"):/data:rw" \
  -e SIGNAL_CLI_CONFIG=/data \
  --entrypoint signal-cli \
  "$IMAGE" \
  -a "$PHONE" verify "$CODE"

echo ""
echo "Registration complete."
echo "Auth data stored in: $DATA_DIR"
echo ""
echo "Add to your .env:"
echo "  SIGNAL_PHONE_NUMBER=$PHONE"

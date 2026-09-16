#!/usr/bin/env bash
# Records docs/hero.gif and docs/hero.mp4 from a real demo office.
#
# Uses gifski when it is installed, because it dithers better, and ffmpeg's
# palette pipeline otherwise so that this runs for anyone with ffmpeg alone.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
OFFICE="$WORK/office"
trap 'rm -rf "$WORK"; [[ -n "${PID:-}" ]] && kill "$PID" 2>/dev/null || true' EXIT

command -v ffmpeg >/dev/null || { echo "ffmpeg is needed: brew install ffmpeg"; exit 1; }

echo "Building..."
(cd "$ROOT" && pnpm build >/dev/null)

echo "Opening an office..."
node "$ROOT/packages/cli/dist/index.js" init --template studio --dir "$OFFICE" >/dev/null
node "$ROOT/packages/cli/dist/index.js" demo --no-open --port 0 --office "$OFFICE" > "$WORK/serve.log" 2>&1 &
PID=$!

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?t=[A-Za-z0-9_-]+' "$WORK/serve.log" | head -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 0.5
done
[[ -n "$URL" ]] || { echo "The office never printed a URL:"; cat "$WORK/serve.log"; exit 1; }

echo "Recording..."
# Run from packages/web: the recorder imports @playwright/test, and Node resolves
# that relative to the script's own location, not the working directory.
(cd "$ROOT/packages/web" && URL="$URL" OUT="$WORK/video" node e2e/hero.mjs >/dev/null)
VIDEO="$(find "$WORK/video" -name '*.webm' | head -1)"
[[ -n "$VIDEO" ]] || { echo "No video was recorded."; exit 1; }

mkdir -p "$ROOT/docs"

echo "Writing docs/hero.mp4..."
ffmpeg -y -loglevel error -i "$VIDEO" \
  -vf "scale=1200:-2:flags=lanczos" -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
  "$ROOT/docs/hero.mp4"

echo "Writing docs/hero.gif..."
if command -v gifski >/dev/null; then
  ffmpeg -y -loglevel error -i "$VIDEO" -vf "scale=1200:-2:flags=lanczos" -r 12 "$WORK/f%04d.png"
  gifski --fps 12 --width 1200 --quality 80 -o "$ROOT/docs/hero.gif" "$WORK"/f*.png
else
  ffmpeg -y -loglevel error -i "$VIDEO" \
    -vf "fps=12,scale=1200:-2:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" \
    "$WORK/palette.png"
  ffmpeg -y -loglevel error -i "$VIDEO" -i "$WORK/palette.png" \
    -lavfi "fps=12,scale=1200:-2:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
    "$ROOT/docs/hero.gif"
fi

SIZE=$(( $(wc -c < "$ROOT/docs/hero.gif") / 1024 ))
echo "docs/hero.gif  ${SIZE} KB"
echo "docs/hero.mp4  $(( $(wc -c < "$ROOT/docs/hero.mp4") / 1024 )) KB"
[[ "$SIZE" -lt 8192 ]] || { echo "The GIF is over 8 MB. Shorten it or drop the frame rate."; exit 1; }

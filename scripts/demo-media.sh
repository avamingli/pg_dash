#!/usr/bin/env bash
# Turn a screen recording (.mov from Cmd+Shift+5) into the demo media:
#
#   scripts/demo-media.sh gif   replay.mov  [--width 1280] [--fps 15] [--speed 1]
#   scripts/demo-media.sh mp4   live.mov    [--speed 1.8] [--cards]
#   scripts/demo-media.sh cards                       # just render the title/end cards
#
# gif  → docs/plan-tree.gif (README) + docs/media/plan-tree-slack.gif
# mp4  → docs/media/plan-tree-linkedin.mp4 (1080p H.264, optional title/end cards)
#
# Needs: ffmpeg, gifski, gifsicle (brew install ffmpeg gifski gifsicle) and
# Google Chrome for rendering the cards headlessly. Retina captures are
# ~3000px wide; every output is downscaled with lanczos, which is where
# the crispness comes from — never record at a small size and upscale.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEDIA="$ROOT/docs/media"
WORK="${TMPDIR:-/tmp}/pg-dash-demo-media"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$WORK" "$MEDIA"

mode="${1:-}"; shift || true
input=""; width=1280; fps=15; speed=1; cards=0
while [ $# -gt 0 ]; do
  case "$1" in
    --width) width="$2"; shift 2 ;;
    --fps)   fps="$2";   shift 2 ;;
    --speed) speed="$2"; shift 2 ;;
    --cards) cards=1;    shift ;;
    *) input="$1"; shift ;;
  esac
done

render_card() { # html → png, 1920x1080, via headless Chrome
  local html="$1" png="$2"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=1920,1080 --screenshot="$png" "file://$html" >/dev/null 2>&1
  echo "rendered $png"
}

ensure_card() { # html + png → render headlessly unless the png is newer than the html
  local html="$1" png="$2"
  if [ ! -f "$png" ] || [ "$html" -nt "$png" ]; then
    render_card "$html" "$png"
  fi
}

case "$mode" in
  cards)
    render_card "$MEDIA/title-card.html" "$MEDIA/title-card.png"
    render_card "$MEDIA/end-card.html"   "$MEDIA/end-card.png"
    ;;

  gif)
    [ -n "$input" ] || { echo "usage: $0 gif <recording.mov> [--width N] [--fps N] [--speed X]"; exit 1; }
    rm -rf "$WORK/frames"; mkdir -p "$WORK/frames"
    # setpts speeds the clip up (2 → twice as fast); fps then samples it evenly.
    ffmpeg -y -loglevel error -i "$input" \
      -vf "setpts=PTS/${speed},fps=${fps},scale=${width}:-2:flags=lanczos" \
      "$WORK/frames/%04d.png"
    # gifski silently caps the output at 640px unless --width is given; the
    # frames are already scaled by ffmpeg to $width, so pass it through.
    gifski -o "$ROOT/docs/plan-tree.gif" --width "$width" --fps "$fps" --quality 90 "$WORK/frames"/*.png
    # Slack copy: narrower and lighter.
    gifski -o "$MEDIA/plan-tree-slack.gif" --fps 12 --width 960 --quality 85 "$WORK/frames"/*.png
    for f in "$ROOT/docs/plan-tree.gif" "$MEDIA/plan-tree-slack.gif"; do
      size=$(stat -f %z "$f")
      if [ "$size" -gt $((5 * 1024 * 1024)) ]; then
        gifsicle -O3 --lossy=80 "$f" -o "$f.tmp" && mv "$f.tmp" "$f"
        echo "compressed $(basename "$f") (was $((size / 1024)) KB)"
      fi
      printf '%-28s %6d KB\n' "$(basename "$f")" "$(( $(stat -f %z "$f") / 1024 ))"
    done
    ;;

  mp4)
    [ -n "$input" ] || { echo "usage: $0 mp4 <recording.mov> [--speed X] [--cards]"; exit 1; }
    out="$MEDIA/plan-tree-linkedin.mp4"
    # Encode the cards + recording in ONE ffmpeg run so the output is a single
    # H.264 stream. Splicing separately encoded clips with `-c copy` bakes in
    # mismatched parameter sets (e.g. card @L4.0 vs main @L5.0), which makes
    # QuickTime and similar players stop decoding right after the intro card.
    vf="setpts=PTS/${speed},scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#09090b,fps=30,format=yuv420p,setsar=1"
    if [ "$cards" = 1 ]; then
      ensure_card "$MEDIA/title-card.html" "$MEDIA/title-card.png"
      ensure_card "$MEDIA/end-card.html"   "$MEDIA/end-card.png"
      ffmpeg -y -loglevel error \
        -loop 1 -framerate 30 -t 3 -i "$MEDIA/title-card.png" \
        -i "$input" \
        -loop 1 -framerate 30 -t 3 -i "$MEDIA/end-card.png" \
        -filter_complex \
          "[0:v]scale=1920:1080,format=yuv420p,fps=30,setsar=1[title];\
           [1:v]${vf}[main];\
           [2:v]scale=1920:1080,format=yuv420p,fps=30,setsar=1[end];\
           [title][main][end]concat=n=3:v=1:a=0,format=yuv420p[v]" \
        -map "[v]" -c:v libx264 -crf 18 -preset slow -profile:v high -level 4.0 \
        -r 30 -movflags +faststart "$out"
    else
      ffmpeg -y -loglevel error -i "$input" -map 0:v:0 -vf "$vf" \
        -c:v libx264 -crf 18 -preset slow -profile:v high -level 4.0 \
        -r 30 -movflags +faststart "$out"
    fi
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
    printf '%-28s %6d KB  %.1fs\n' "$(basename "$out")" "$(( $(stat -f %z "$out") / 1024 ))" "$dur"
    ;;

  *)
    sed -n '2,12p' "$0"; exit 1 ;;
esac

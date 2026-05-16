#!/usr/bin/env bash
# Re-encode all MP4 files in the current directory to proper CFR H.264
# Replaces files in-place (make a backup first!)
# Fixes VFR/container metadata issues for training tools

set -euo pipefail

COUNT=0
ERRORS=0

for f in *.mp4; do
    [ -f "$f" ] || continue
    
    TMP="${f%.mp4}_reenc_tmp.mp4"
    echo "Re-encoding: $f"
    
    if ffmpeg -y -i "$f" \
        -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
        -c:v libx264 -preset fast -crf 18 \
        -vsync cfr \
        -map 0:v:0 -map 1:a:0 -shortest \
        -c:a aac -b:a 128k \
        -movflags +faststart \
        "$TMP" 2>/dev/null; then
        mv "$TMP" "$f"
        echo "  Done: $f"
        COUNT=$((COUNT + 1))
    else
        echo "  ERROR: Failed to re-encode $f"
        rm -f "$TMP"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Show progress
    echo "  ($COUNT done, $ERRORS errors)"
done

echo ""
echo "Complete: $COUNT files re-encoded, $ERRORS errors"
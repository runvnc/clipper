#!/bin/bash
# strip_and_blur.sh - Remove first/last 5 seconds and blur upper-right watermark
#
# Usage: ./strip_and_blur.sh input.mp4 output.mp4
#        ./strip_and_blur.sh input.mp4  (overwrites with stripped version)
#
# 1) Removes first 5s and last 5s from the video
# 2) Heavily blurs the upper-right region (top 10% height, right 15% width)
#    to obscure watermarks
#
# Requires: ffmpeg with libavfilter (boxblur)

set -euo pipefail

INPUT="${1:?Usage: $0 input.mp4 [output.mp4]}"
OUTPUT="${2:-}"

if [ -z "$OUTPUT" ]; then
    # No output specified - write to temp then replace input
    OUTPUT="${INPUT}.tmp$$.mp4"
    REPLACE=1
else
    REPLACE=0
fi

# Get video duration
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$INPUT")
if [ -z "$DUR" ]; then
    echo "Error: Could not get duration of $INPUT" >&2
    exit 1
fi

# Calculate trim points
SKIP_START=5
SKIP_END=5
NEW_START=$SKIP_START
NEW_END=$(echo "$DUR - $SKIP_END" | bc)

if [ "$(echo "$NEW_END <= $NEW_START" | bc)" -eq 1 ]; then
    echo "Error: Video is too short (${DUR}s) to remove ${SKIP_START}s + ${SKIP_END}s" >&2
    exit 1
fi

# Get video dimensions
WIDTH=$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width -of csv=p=0 "$INPUT")
HEIGHT=$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=height -of csv=p=0 "$INPUT")

if [ -z "$WIDTH" ] || [ -z "$HEIGHT" ]; then
    echo "Error: Could not get video dimensions" >&2
    exit 1
fi

# Calculate blur region (top 10%, right 15%)
BLUR_H=$(echo "$HEIGHT * 10 / 100" | bc)
BLUR_W=$(echo "$WIDTH * 15 / 100" | bc)
BLUR_X=$(echo "$WIDTH - $BLUR_W" | bc)
BLUR_Y=0

# Ensure even dimensions (ffmpeg requirement)
BLUR_W=$(( BLUR_W / 2 * 2 ))
BLUR_H=$(( BLUR_H / 2 * 2 ))
BLUR_X=$(( BLUR_X / 2 * 2 ))

# Make sure blur region doesn't exceed video bounds
if [ $((BLUR_X + BLUR_W)) -gt "$WIDTH" ]; then
    BLUR_W=$(( WIDTH - BLUR_X ))
fi
if [ $((BLUR_Y + BLUR_H)) -gt "$HEIGHT" ]; then
    BLUR_H=$(( HEIGHT - BLUR_Y ))
fi

echo "Video: ${WIDTH}x${HEIGHT}, Duration: ${DUR}s"
echo "Trim: ${NEW_START}s to ${NEW_END}s (removing first ${SKIP_START}s, last ${SKIP_END}s)"
echo "Blur region: ${BLUR_W}x${BLUR_H} at (${BLUR_X},${BLUR_Y})"

# Build ffmpeg filter:
# 1) delogo is an option but boxblur in a region is more reliable
# 2) We use crop the region, blur it, and overlay it back
#
# Filter chain:
#   - Split video into main + blur source
#   - Crop the watermark region from blur source
#   - Heavy boxblur on the cropped region
#   - Overlay the blurred region back onto the main video

BLUR_FILTER="[0:v]split=2[main][blursrc];"\
"[blursrc]crop=${BLUR_W}:${BLUR_H}:${BLUR_X}:${BLUR_Y},boxblur=18:2:cr=18:cr_mode=average[blurred];"\
"[main][blurred]overlay=${BLUR_X}:${BLUR_Y}[out]"

ffmpeg -y \
    -ss "$NEW_START" \
    -to "$NEW_END" \
    -i "$INPUT" \
    -filter_complex "$BLUR_FILTER" \
    -map "[out]" \
    -map 0:a? \
    -c:v libx264 -preset fast -crf 18 \
    -c:a copy \
    "$OUTPUT"

if [ "$REPLACE" -eq 1 ]; then
    mv "$OUTPUT" "$INPUT"
    echo "Replaced $INPUT with stripped+blurred version"
else
    echo "Wrote $OUTPUT"
fi

echo "Done!"

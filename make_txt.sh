#!/bin/bash

for mp4 in *.mp4; do
    [ -f "$mp4" ] || continue
    base="${mp4%.mp4}"
    txt="${base}.txt"
    if [ ! -f "$txt" ]; then
        echo "camgirl,$base" > "$txt"
        echo "Created $txt"
    else
        echo "Skipping $txt (already exists)"
    fi
done

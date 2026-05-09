# Clipper - Video Clip Tagger for LTX Video 2.3 Fine-Tuning

## Overview

A lightweight tool for creating tagged video clips from source videos, purpose-built for preparing LTX Video 2.3 fine-tuning datasets. Provides a scrubbing UI to mark in/out points, write captions, and export clip+text pairs.

## WebM vs MP4

**Use MP4.** LTX Video training pipelines expect MP4 (H.264). WebM (VP8/VP9) would require re-encoding during training preprocessing anyway, adding a slow unnecessary step. If your source is already MP4/H264, ffmpeg can extract clips with stream copy (`-c copy`) which is nearly instant and lossless. WebM would force a full re-encode on every clip extraction. Stick with `.mp4`.

## Architecture

```
/files/clipper/
  server.py          # FastAPI backend
  static/
    index.html       # Single-page UI
    app.js           # Frontend logic
    style.css        # Styling
```

**Backend**: Python FastAPI server
- Serves the frontend
- Serves source videos from a configurable directory
- Handles clip extraction via ffmpeg (stream copy when possible)
- Writes .txt caption files
- Manages filename uniqueness

**Frontend**: Vanilla HTML/JS/CSS (no build step)
- HTML5 `<video>` element with custom controls
- Keyboard-driven workflow for speed

## UI Layout

```
+--------------------------------------------------+
|  [Source Video Dir: /path/to/videos    ] [Load]   |
|  [Output Dir: /path/to/output          ]          |
+--------------------------------------------------+
|                                                   |
|            VIDEO PLAYER / SCRUBBER                |
|                                                   |
+--------------------------------------------------+
|  [<< 1s] [< frame] [> frame] [1s >>]               |
|  IN: 00:01.200  OUT: 00:03.450  DUR: 2.250s       |
|  [Mark In (I)]  [Mark Out (O)]  [Export (Enter)]  |
+--------------------------------------------------+
|  Caption:                                         |
|  [a woman walking through a park, sunny day,     ]|
|  [outdoor, nature, peaceful                       ]|
+--------------------------------------------------+
|  Preview filename: a_woman_walking_through_a_park  |
|  Status: Ready                                     |
+--------------------------------------------------+
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `I` | Mark In point at current position |
| `O` | Mark Out point at current position |
| `←` | Step back ~1/30s (one frame) |
| `→` | Step forward ~1/30s (one frame) |
| `Shift+←` | Step back 1 second |
| `Shift+→` | Step forward 1 second |
| `Enter` | Export clip + caption |
| `Space` | Play/Pause |

## Filename Logic

1. Parse caption text into tags (split by commas, strip whitespace)
2. Take first 5 tags
3. Join with underscores, lowercase, replace spaces with underscores
4. Sanitize: remove special chars, collapse multiple underscores
5. Check uniqueness in output dir - if `name.mp4` exists, append `_2`, `_3`, etc.
6. Write `name.mp4` and `name.txt`

Example:
- Caption: `a woman walking through a park, sunny day, outdoor, nature, peaceful, extra tag`
- Tags: `[a woman walking through a park, sunny day, outdoor, nature, peaceful]`
- Filename: `a_woman_walking_through_a_park_sunny_day_outdoor_nature_peaceful.mp4`

## Backend API

### `GET /api/videos`
List available source videos in the configured directory.

### `GET /api/video/{filename}`
Serve a source video file for playback.

### `POST /api/export`
Extract and save a clip.

Request body:
```json
{
  "source_video": "myvid.mp4",
  "in_time": 1.2,
  "out_time": 3.45,
  "caption": "a woman walking through a park, sunny day, outdoor, nature, peaceful",
  "output_dir": "/path/to/output"
}
```

Response:
```json
{
  "clip_path": "/path/to/output/a_woman_walking_through_a_park_sunny_day_outdoor_nature_peaceful.mp4",
  "caption_path": "/path/to/output/a_woman_walking_through_a_park_sunny_day_outdoor_nature_peaceful.txt",
  "filename": "a_woman_walking_through_a_park_sunny_day_outdoor_nature_peaceful"
}
```

### `GET /api/preview-filename`
Preview what the filename would be for a given caption (without writing anything).

## Clip Extraction

Use ffmpeg with stream copy when source is H.264 MP4:
```bash
ffmpeg -ss {in_time} -to {out_time} -i {source} -c copy {output}
```

If source is not H.264 MP4, re-encode:
```bash
ffmpeg -ss {in_time} -to {out_time} -i {source} -c:v libx264 -preset fast -crf 18 -an {output}
```

Strip audio by default (training doesn't need it) with `-an`.

## Implementation Steps

1. **Backend skeleton** - FastAPI app with video serving, directory listing
2. **Frontend UI** - Video player, scrub controls, mark in/out, caption area
3. **Export endpoint** - ffmpeg extraction + filename logic + .txt writing
4. **Keyboard shortcuts** - I/O/Arrow/Enter bindings
5. **Polish** - Timeline visualization, filename preview, error handling, status feedback

## Dependencies

- Python 3.10+
- fastapi + uvicorn
- ffmpeg (system install)
- No frontend dependencies (vanilla JS)

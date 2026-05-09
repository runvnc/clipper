#!/usr/bin/env python3
"""Clipper - Video Clip Tagger for LTX Video 2.3 Fine-Tuning"""

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


app = FastAPI(title="Clipper")

# Mount static files
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")


# --- Models ---

class ExportRequest(BaseModel):
    source_video: str
    in_time: float
    out_time: float
    caption: str
    output_dir: str


# --- Helpers ---

def sanitize_tag(tag: str) -> str:
    """Sanitize a single tag for use in filename."""
    tag = tag.strip().lower()
    tag = tag.replace(" ", "_")
    tag = re.sub(r"[^a-z0-9_]", "", tag)
    tag = re.sub(r"_+", "_", tag)
    tag = tag.strip("_")
    return tag


def caption_to_filename(caption: str) -> str:
    """Convert caption to filename using first 5 comma-separated tags."""
    tags = [t.strip() for t in caption.split(",") if t.strip()]
    tags = tags[:5]
    sanitized = [sanitize_tag(t) for t in tags]
    sanitized = [t for t in sanitized if t]  # remove empties
    if not sanitized:
        return "untitled"
    return "_".join(sanitized)


def unique_filename(output_dir: Path, base_name: str) -> str:
    """Ensure filename is unique in output_dir by appending _2, _3, etc."""
    if not (output_dir / f"{base_name}.mp4").exists():
        return base_name
    n = 2
    while (output_dir / f"{base_name}_{n}.mp4").exists():
        n += 1
    return f"{base_name}_{n}"


def is_h264_mp4(filepath: Path) -> bool:
    """Check if video is H.264 MP4 using ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
             "-show_entries", "stream=codec_name", "-of", "csv=p=0",
             str(filepath)],
            capture_output=True, text=True, timeout=10
        )
        return result.stdout.strip() == "h264"
    except Exception:
        return False


def update_dataset_json(output_dir: Path, clip_filename: str, caption: str):
    """Append an entry to dataset.json in the output directory.
    
    Creates or updates a dataset.json file compatible with LTX-2 trainer.
    Uses just the clip filename as media_path (relative to output dir).
    """
    dataset_path = output_dir / "dataset.json"
    
    # Load existing entries
    entries = []
    if dataset_path.exists():
        try:
            existing = dataset_path.read_text().strip()
            if existing:
                entries = json.loads(existing)
        except (json.JSONDecodeError, OSError):
            entries = []
    
    # Add new entry
    entries.append({
        "caption": caption.strip(),
        "media_path": clip_filename
    })
    
    # Write back
    dataset_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n")
    return dataset_path


# --- API Routes ---

@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main UI."""
    html_path = Path(__file__).parent / "static" / "index.html"
    return HTMLResponse(content=html_path.read_text())


@app.get("/api/videos")
async def list_videos(directory: str = Query(default="")):
    """List video files in the given directory."""
    if not directory:
        return {"videos": []}
    dir_path = Path(directory)
    if not dir_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {directory}")
    video_exts = {".mp4", ".webm", ".mkv", ".avi", ".mov", ".mpg", ".mpeg"}
    videos = sorted([
        f.name for f in dir_path.iterdir()
        if f.is_file() and f.suffix.lower() in video_exts
    ])
    return {"videos": videos}


@app.get("/api/video/{filename:path}")
async def serve_video(filename: str, directory: str = Query(default="")):
    """Serve a source video file."""
    if not directory:
        raise HTTPException(status_code=400, detail="directory query param required")
    filepath = Path(directory) / filename
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail=f"Video not found: {filename}")
    # Security: ensure the resolved path is within the directory
    try:
        filepath.resolve().relative_to(Path(directory).resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")
    return FileResponse(str(filepath), media_type="video/mp4")


@app.post("/api/preview-filename")
async def preview_filename(caption: str = Query(default="")):
    """Preview what the filename would be for a given caption."""
    base = caption_to_filename(caption)
    return {"filename": base}


@app.post("/api/export")
async def export_clip(req: ExportRequest):
    """Extract a clip and write caption file."""
    if req.in_time >= req.out_time:
        raise HTTPException(status_code=400, detail="in_time must be less than out_time")
    if req.in_time < 0:
        raise HTTPException(status_code=400, detail="in_time must be >= 0")

    source_path = Path(req.source_video)
    # If not absolute, treat relative to CWD
    if not source_path.is_absolute():
        source_path = Path.cwd() / source_path

    if not source_path.is_file():
        raise HTTPException(status_code=404, detail=f"Source video not found: {req.source_video}")

    output_dir = Path(req.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Generate filename
    base_name = caption_to_filename(req.caption)
    final_name = unique_filename(output_dir, base_name)

    clip_path = output_dir / f"{final_name}.mp4"
    caption_path = output_dir / f"{final_name}.txt"

    # Extract clip with ffmpeg
    try:
        if is_h264_mp4(source_path) and source_path.suffix.lower() == ".mp4":
            # Stream copy - fast and lossless
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(req.in_time),
                "-to", str(req.out_time),
                "-i", str(source_path),
                "-c", "copy",
                "-an",
                str(clip_path)
            ]
        else:
            # Re-encode to H.264 MP4
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(req.in_time),
                "-to", str(req.out_time),
                "-i", str(source_path),
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-an",
                str(clip_path)
            ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"ffmpeg failed: {result.stderr[:500]}"
            )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="ffmpeg timed out")

    # Write caption file
    caption_path.write_text(req.caption.strip() + "\n")

    # Update dataset.json for LTX trainer
    dataset_path = update_dataset_json(output_dir, f"{final_name}.mp4", req.caption)

    return {
        "clip_path": str(clip_path),
        "caption_path": str(caption_path),
        "dataset_path": str(dataset_path),
        "filename": final_name
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8760)

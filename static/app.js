// Clipper - Video Clip Tagger Frontend

const FRAME_STEP = 1 / 30; // ~1 frame at 30fps
const LTX_FPS = 24; // LTX Video native frame rate
const VALID_FRAME_COUNTS = [1, 9, 17, 25, 33, 41, 49, 57, 65, 73, 81, 89, 97, 121, 161, 257];

// State
let inTime = null;
let outTime = null;
let sourceDir = '';
let currentVideo = '';
let exporting = false;

// DOM elements
const video = document.getElementById('videoPlayer');
const sourceDirInput = document.getElementById('sourceDir');
const outputDirInput = document.getElementById('outputDir');
const loadVideosBtn = document.getElementById('loadVideosBtn');
const videoSelect = document.getElementById('videoSelect');
const markInBtn = document.getElementById('markInBtn');
const markOutBtn = document.getElementById('markOutBtn');
const scrubBack1s = document.getElementById('scrubBack1s');
const scrubBackFrame = document.getElementById('scrubBackFrame');
const playPauseBtn = document.getElementById('playPause');
const scrubForwardFrame = document.getElementById('scrubForwardFrame');
const scrubForward1s = document.getElementById('scrubForward1s');
const inTimeDisplay = document.getElementById('inTimeDisplay');
const outTimeDisplay = document.getElementById('outTimeDisplay');
const durationDisplay = document.getElementById('durationDisplay');
const frameCountDisplay = document.getElementById('frameCountDisplay');
const frameValidIndicator = document.getElementById('frameValidIndicator');
const captionInput = document.getElementById('captionInput');
const filenamePreview = document.getElementById('filenamePreview');
const exportBtn = document.getElementById('exportBtn');
const statusDiv = document.getElementById('status');
const timeline = document.getElementById('timeline');
const clipRegion = document.getElementById('clipRegion');
const markerIn = document.getElementById('markerIn');
const markerOut = document.getElementById('markerOut');
const snapBtn = document.getElementById('snapBtn');

// --- Utility ---

function formatTime(seconds) {
    if (seconds === null || seconds === undefined) return '--';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(3);
    return `${m}:${s.padStart(6, '0')}`;
}

function setStatus(msg, type = '') {
    statusDiv.textContent = msg;
    statusDiv.className = 'status' + (type ? ' ' + type : '');
}

// --- LTX Frame Helpers ---

function getFrameCount(inT, outT) {
    if (inT === null || outT === null) return null;
    const dur = outT - inT;
    if (dur <= 0) return 0;
    return Math.round(dur * LTX_FPS) + 1; // +1 because frame count includes both endpoints
}

function isValidLTXFrameCount(frames) {
    if (frames === null || frames === undefined) return false;
    return (frames - 1) % 8 === 0 && frames >= 1;
}

function snapToNearestValidFrameCount(frames) {
    if (frames === null || frames <= 1) return 1;
    // Round to nearest 8n+1
    const n = Math.round((frames - 1) / 8);
    return Math.max(1, n * 8 + 1);
}

function frameCountToDuration(frameCount) {
    return (frameCount - 1) / LTX_FPS;
}

// --- Video Loading ---

loadVideosBtn.addEventListener('click', async () => {
    sourceDir = sourceDirInput.value.trim();
    if (!sourceDir) return;
    try {
        const resp = await fetch(`/api/videos?directory=${encodeURIComponent(sourceDir)}`);
        const data = await resp.json();
        videoSelect.innerHTML = '';
        if (data.videos.length === 0) {
            videoSelect.innerHTML = '<option value="">-- No videos found --</option>';
            return;
        }
        data.videos.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            videoSelect.appendChild(opt);
        });
        loadSelectedVideo();
    } catch (e) {
        setStatus('Failed to load videos: ' + e.message, 'error');
    }
});

videoSelect.addEventListener('change', loadSelectedVideo);

function loadSelectedVideo() {
    const name = videoSelect.value;
    if (!name) return;
    currentVideo = name;
    video.src = `/api/video/${encodeURIComponent(name)}?directory=${encodeURIComponent(sourceDir)}`;
    video.load();
    inTime = null;
    outTime = null;
    updateMarks();
    setStatus(`Loaded: ${name}`);
}

// --- Scrubbing ---

function stepVideo(delta) {
    if (!video.duration) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
    updatePlayPauseBtn();
}

scrubBack1s.addEventListener('click', () => stepVideo(-1));
scrubBackFrame.addEventListener('click', () => stepVideo(-FRAME_STEP));
scrubForwardFrame.addEventListener('click', () => stepVideo(FRAME_STEP));
scrubForward1s.addEventListener('click', () => stepVideo(1));

playPauseBtn.addEventListener('click', () => {
    if (video.paused) {
        video.play();
    } else {
        video.pause();
    }
});

video.addEventListener('play', updatePlayPauseBtn);
video.addEventListener('pause', updatePlayPauseBtn);

function updatePlayPauseBtn() {
    playPauseBtn.textContent = video.paused ? '\u25b6 Play' : '\u23f8 Pause';
}

// --- Mark In/Out ---

function markIn() {
    if (!video.duration) return;
    inTime = video.currentTime;
    if (outTime !== null && inTime >= outTime) {
        outTime = null;
    }
    updateMarks();
    setStatus(`In: ${formatTime(inTime)}`);
}

function markOut() {
    if (!video.duration) return;
    outTime = video.currentTime;
    if (inTime !== null && outTime <= inTime) {
        inTime = null;
    }
    updateMarks();
    setStatus(`Out: ${formatTime(outTime)}`);
}

markInBtn.addEventListener('click', markIn);
markOutBtn.addEventListener('click', markOut);

function updateMarks() {
    inTimeDisplay.textContent = formatTime(inTime);
    outTimeDisplay.textContent = formatTime(outTime);
    if (inTime !== null && outTime !== null) {
        durationDisplay.textContent = formatTime(outTime - inTime);
        // Frame count display
        const frames = getFrameCount(inTime, outTime);
        frameCountDisplay.textContent = frames !== null ? frames : '--';
        if (frames !== null) {
            const valid = isValidLTXFrameCount(frames);
            frameValidIndicator.className = 'frame-valid ' + (valid ? 'valid' : 'invalid');
        } else {
            frameValidIndicator.className = 'frame-valid';
        }
    } else {
        durationDisplay.textContent = '--';
        frameCountDisplay.textContent = '--';
        frameValidIndicator.className = 'frame-valid';
    }
    updateTimeline();
}

// --- Snap to Valid Frame Count ---

snapBtn.addEventListener('click', () => {
    if (inTime === null) {
        setStatus('Mark In point first', 'error');
        return;
    }
    const frames = getFrameCount(inTime, outTime);
    if (frames === null || frames <= 0) {
        setStatus('Mark both In and Out first', 'error');
        return;
    }
    const targetFrames = snapToNearestValidFrameCount(frames);
    const targetDuration = frameCountToDuration(targetFrames);
    const newOutTime = inTime + targetDuration;
    if (newOutTime > video.duration) {
        setStatus('Not enough video for ' + targetFrames + ' frames from In point', 'error');
        return;
    }
    outTime = newOutTime;
    video.currentTime = outTime;
    updateMarks();
    setStatus(`Snapped to ${targetFrames} frames (${formatTime(targetDuration)})`, 'success');
});

// --- Frame Preset Buttons ---

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetFrames = parseInt(btn.dataset.frames);
        if (inTime === null) {
            setStatus('Mark In point first', 'error');
            return;
        }
        const targetDuration = frameCountToDuration(targetFrames);
        const newOutTime = inTime + targetDuration;
        if (newOutTime > video.duration) {
            setStatus('Not enough video for ' + targetFrames + ' frames from In point', 'error');
            return;
        }
        outTime = newOutTime;
        video.currentTime = outTime;
        video.pause();
        updateMarks();
        updatePlayPauseBtn();
        setStatus(`Set to ${targetFrames} frames (${formatTime(targetDuration)})`, 'success');
    });
});

// --- Timeline ---

function updateTimeline() {
    const dur = video.duration || 1;
    if (inTime !== null) {
        markerIn.style.display = 'block';
        markerIn.style.left = (inTime / dur * 100) + '%';
    } else {
        markerIn.style.display = 'none';
    }
    if (outTime !== null) {
        markerOut.style.display = 'block';
        markerOut.style.left = (outTime / dur * 100) + '%';
    } else {
        markerOut.style.display = 'none';
    }
    if (inTime !== null && outTime !== null) {
        clipRegion.style.display = 'block';
        clipRegion.style.left = (inTime / dur * 100) + '%';
        clipRegion.style.width = ((outTime - inTime) / dur * 100) + '%';
    } else {
        clipRegion.style.display = 'none';
    }
}

video.addEventListener('timeupdate', () => {
    // Update timeline playhead position could be added here
});

video.addEventListener('loadedmetadata', () => {
    updateTimeline();
});

// Click on timeline to seek
timeline.addEventListener('click', (e) => {
    if (!video.duration) return;
    const rect = timeline.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    video.currentTime = pct * video.duration;
});

// --- Caption / Filename Preview ---

let previewDebounce = null;

captionInput.addEventListener('input', () => {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(updateFilenamePreview, 300);
});

async function updateFilenamePreview() {
    const caption = captionInput.value.trim();
    if (!caption) {
        filenamePreview.textContent = '--';
        return;
    }
    try {
        const resp = await fetch(`/api/preview-filename?caption=${encodeURIComponent(caption)}`, { method: 'POST' });
        const data = await resp.json();
        filenamePreview.textContent = data.filename + '.mp4';
    } catch (e) {
        filenamePreview.textContent = '--';
    }
}

// --- Export ---

exportBtn.addEventListener('click', doExport);

async function doExport() {
    if (exporting) return;
    if (!currentVideo) {
        setStatus('No video loaded', 'error');
        return;
    }
    if (inTime === null || outTime === null) {
        setStatus('Mark both In and Out points first', 'error');
        return;
    }
    const caption = captionInput.value.trim();
    if (!caption) {
        setStatus('Enter a caption first', 'error');
        return;
    }
    const outputDir = outputDirInput.value.trim();
    if (!outputDir) {
        setStatus('Set output directory', 'error');
        return;
    }

    // Warn about invalid frame count but still allow export
    const frames = getFrameCount(inTime, outTime);
    if (frames !== null && !isValidLTXFrameCount(frames)) {
        const snapped = snapToNearestValidFrameCount(frames);
        if (!confirm(`Frame count ${frames} is not valid for LTX (needs 8n+1). Nearest valid: ${snapped}. Export anyway?`)) {
            return;
        }
    }

    exporting = true;
    exportBtn.disabled = true;
    setStatus('Exporting...', 'working');

    try {
        const resp = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_video: sourceDir + '/' + currentVideo,
                in_time: inTime,
                out_time: outTime,
                caption: caption,
                output_dir: outputDir
            })
        });
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.detail || 'Export failed');
        }
        setStatus(`Exported: ${data.filename}.mp4 + .txt`, 'success');
        // Clear marks for next clip
        inTime = null;
        outTime = null;
        captionInput.value = '';
        filenamePreview.textContent = '--';
        updateMarks();
    } catch (e) {
        setStatus('Export failed: ' + e.message, 'error');
    } finally {
        exporting = false;
        exportBtn.disabled = false;
    }
}

// --- Keyboard Shortcuts ---

document.addEventListener('keydown', (e) => {
    // Don't capture when typing in inputs
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        // Only allow Enter in caption input to export
        if (e.key === 'Enter' && tag === 'textarea' && !e.shiftKey) {
            e.preventDefault();
            doExport();
        }
        return;
    }

    switch (e.key) {
        case 'i':
        case 'I':
            e.preventDefault();
            markIn();
            break;
        case 'o':
        case 'O':
            e.preventDefault();
            markOut();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            stepVideo(e.shiftKey ? -1 : -FRAME_STEP);
            break;
        case 'ArrowRight':
            e.preventDefault();
            stepVideo(e.shiftKey ? 1 : FRAME_STEP);
            break;
        case ' ':
            e.preventDefault();
            if (video.paused) video.play(); else video.pause();
            break;
        case 'Enter':
            e.preventDefault();
            doExport();
            break;
        case 's':
        case 'S':
            e.preventDefault();
            snapBtn.click();
            break;
    }
});

// --- Init ---

setStatus('Ready - set source directory and load videos');

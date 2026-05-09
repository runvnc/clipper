// Clipper - Video Clip Tagger Frontend

const FRAME_STEP = 1 / 30;
const LTX_FPS = 24;
const VALID_FRAME_COUNTS = [1, 9, 17, 25, 33, 41, 49, 57, 65, 73, 81, 89, 97, 121, 161, 257];
const CROP_SNAP = 32; // LTX requires dimensions as multiples of 32

// State
let inTime = null;
let outTime = null;
let sourceDir = '';
let currentVideo = '';
let exporting = false;
let cropActive = false;
let cropAspect = 'free'; // 'free', '16:9', '9:16', '1:1'
let cropBox = null; // { x, y, w, h } in video pixel coords
let cropDragging = null; // { type: 'move'|'tl'|'tr'|'bl'|'br', startX, startY, startBox }

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
const bucketSelect = document.getElementById('bucketSelect');
const customBucketFields = document.getElementById('customBucketFields');
const customW = document.getElementById('customW');
const customH = document.getElementById('customH');
const customF = document.getElementById('customF');
const cropOverlay = document.getElementById('cropOverlay');
const cropRegionUI = document.getElementById('cropRegionUI');
const cropInfo = document.getElementById('cropInfo');
const cropToggleBtn = document.getElementById('cropToggleBtn');
const cropResetBtn = document.getElementById('cropResetBtn');
const cropDimsDisplay = document.getElementById('cropDimsDisplay');
const playerContainer = document.getElementById('playerContainer');
const clearCaptionBtn = document.getElementById('clearCaptionBtn');

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

// --- Resolution Bucket ---

function getBucket() {
    const val = bucketSelect.value;
    if (val === 'custom') {
        return {
            width: parseInt(customW.value) || 960,
            height: parseInt(customH.value) || 544,
            frames: parseInt(customF.value) || 49
        };
    }
    const parts = val.split('x');
    return {
        width: parseInt(parts[0]),
        height: parseInt(parts[1]),
        frames: parseInt(parts[2])
    };
}

bucketSelect.addEventListener('change', () => {
    customBucketFields.style.display = bucketSelect.value === 'custom' ? 'flex' : 'none';
    // If crop is active, resize crop to match bucket aspect
    if (cropActive && cropBox) {
        applyBucketAspectToCrop();
    }
});

function applyBucketAspectToCrop() {
    const bucket = getBucket();
    const aspectStr = `${bucket.width}:${bucket.height}`;
    // Find matching aspect button or set free
    const btns = document.querySelectorAll('.aspect-btn');
    let found = false;
    btns.forEach(b => {
        if (b.dataset.aspect === aspectStr) {
            b.classList.add('active');
            cropAspect = aspectStr;
            found = true;
        } else {
            b.classList.remove('active');
        }
    });
    if (!found) {
        // Set to free and resize crop to bucket dimensions
        cropAspect = 'free';
        btns.forEach(b => b.classList.remove('active'));
        btns[0].classList.add('active');
    }
    if (cropBox && video.videoWidth) {
        // Resize crop to bucket dimensions, centered
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        let cw = Math.min(bucket.width, vw);
        let ch = Math.min(bucket.height, vh);
        // Snap to 32
        cw = Math.floor(cw / CROP_SNAP) * CROP_SNAP;
        ch = Math.floor(ch / CROP_SNAP) * CROP_SNAP;
        cropBox = {
            x: Math.floor((vw - cw) / 2 / CROP_SNAP) * CROP_SNAP,
            y: Math.floor((vh - ch) / 2 / CROP_SNAP) * CROP_SNAP,
            w: cw,
            h: ch
        };
        renderCrop();
    }
}

// --- LTX Frame Helpers ---

function getFrameCount(inT, outT) {
    if (inT === null || outT === null) return null;
    const dur = outT - inT;
    if (dur <= 0) return 0;
    return Math.round(dur * LTX_FPS) + 1;
}

function isValidLTXFrameCount(frames) {
    if (frames === null || frames === undefined) return false;
    return (frames - 1) % 8 === 0 && frames >= 1;
}

function snapToNearestValidFrameCount(frames) {
    if (frames === null || frames <= 1) return 1;
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
    cropBox = null;
    updateMarks();
    updateCropDisplay();
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

video.addEventListener('loadedmetadata', () => {
    updateTimeline();
    // Initialize crop to full video
    if (video.videoWidth && video.videoHeight) {
        cropBox = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
        // Snap to 32
        cropBox.w = Math.floor(cropBox.w / CROP_SNAP) * CROP_SNAP;
        cropBox.h = Math.floor(cropBox.h / CROP_SNAP) * CROP_SNAP;
        renderCrop();
    }
});

// Click on timeline to seek
timeline.addEventListener('click', (e) => {
    if (!video.duration) return;
    const rect = timeline.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    video.currentTime = pct * video.duration;
});

// --- Crop System ---

function videoToDisplayCoords(box) {
    // Convert video pixel coords to display (CSS) coords relative to player container
    const rect = video.getBoundingClientRect();
    const containerRect = playerContainer.getBoundingClientRect();
    const scaleX = rect.width / video.videoWidth;
    const scaleY = rect.height / video.videoHeight;
    // Offset of video within container
    const offsetX = rect.left - containerRect.left;
    const offsetY = rect.top - containerRect.top;
    return {
        x: box.x * scaleX + offsetX,
        y: box.y * scaleY + offsetY,
        w: box.w * scaleX,
        h: box.h * scaleY
    };
}

function displayToVideoCoords(dx, dy) {
    const rect = video.getBoundingClientRect();
    const containerRect = playerContainer.getBoundingClientRect();
    const scaleX = video.videoWidth / rect.width;
    const scaleY = video.videoHeight / rect.height;
    const offsetX = rect.left - containerRect.left;
    const offsetY = rect.top - containerRect.top;
    return {
        x: (dx - offsetX) * scaleX,
        y: (dy - offsetY) * scaleY
    };
}

function renderCrop() {
    if (!cropBox || !video.videoWidth) return;
    const d = videoToDisplayCoords(cropBox);
    cropRegionUI.style.left = d.x + 'px';
    cropRegionUI.style.top = d.y + 'px';
    cropRegionUI.style.width = d.w + 'px';
    cropRegionUI.style.height = d.h + 'px';
    // Update shades
    const containerRect = playerContainer.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const vLeft = videoRect.left - containerRect.left;
    const vTop = videoRect.top - containerRect.top;
    const vW = videoRect.width;
    const vH = videoRect.height;

    document.getElementById('cropShadeTop').style.cssText = `top:${vTop}px;left:${vLeft}px;width:${vW}px;height:${d.y - vTop}px`;
    document.getElementById('cropShadeBottom').style.cssText = `top:${d.y + d.h}px;left:${vLeft}px;width:${vW}px;height:${vH - (d.y + d.h - vTop)}px`;
    document.getElementById('cropShadeLeft').style.cssText = `top:${d.y}px;left:${vLeft}px;width:${d.x - vLeft}px;height:${d.h}px`;
    document.getElementById('cropShadeRight').style.cssText = `top:${d.y}px;left:${d.x + d.w}px;width:${vW - (d.x + d.w - vLeft)}px;height:${d.h}px`;

    cropInfo.textContent = `${cropBox.w}\u00d7${cropBox.h}`;
    updateCropDisplay();
}

function updateCropDisplay() {
    if (cropBox && (cropBox.w < video.videoWidth || cropBox.h < video.videoHeight)) {
        cropDimsDisplay.textContent = `Crop: ${cropBox.w}\u00d7${cropBox.h} @ (${cropBox.x},${cropBox.y})`;
    } else {
        cropDimsDisplay.textContent = 'No crop';
    }
}

function snapCropTo32(box) {
    box.x = Math.round(box.x / CROP_SNAP) * CROP_SNAP;
    box.y = Math.round(box.y / CROP_SNAP) * CROP_SNAP;
    box.w = Math.max(CROP_SNAP, Math.round(box.w / CROP_SNAP) * CROP_SNAP);
    box.h = Math.max(CROP_SNAP, Math.round(box.h / CROP_SNAP) * CROP_SNAP);
    // Clamp to video bounds
    if (video.videoWidth) {
        box.x = Math.max(0, Math.min(box.x, video.videoWidth - box.w));
        box.y = Math.max(0, Math.min(box.y, video.videoHeight - box.h));
        if (box.x + box.w > video.videoWidth) box.w = video.videoWidth - box.x;
        if (box.y + box.h > video.videoHeight) box.h = video.videoHeight - box.y;
    }
    return box;
}

function applyAspectConstraint(box, aspect) {
    if (aspect === 'free') return box;
    let parts = aspect.split(':');
    let ar = parseInt(parts[0]) / parseInt(parts[1]);
    // Adjust height to match aspect based on width
    let newH = Math.round(box.w / ar / CROP_SNAP) * CROP_SNAP;
    newH = Math.max(CROP_SNAP, newH);
    if (newH > video.videoHeight) {
        newH = Math.floor(video.videoHeight / CROP_SNAP) * CROP_SNAP;
        box.w = Math.round(newH * ar / CROP_SNAP) * CROP_SNAP;
    }
    box.h = newH;
    return box;
}

// Toggle crop mode
cropToggleBtn.addEventListener('click', () => {
    cropActive = !cropActive;
    cropOverlay.classList.toggle('active', cropActive);
    cropToggleBtn.classList.toggle('active', cropActive);
    cropToggleBtn.textContent = cropActive ? '\u2716 Crop Off' : '\u2702 Crop';
    if (cropActive && !cropBox && video.videoWidth) {
        cropBox = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
        cropBox = snapCropTo32(cropBox);
    }
    renderCrop();
});

// Reset crop
cropResetBtn.addEventListener('click', () => {
    if (video.videoWidth) {
        cropBox = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
        cropBox = snapCropTo32(cropBox);
        renderCrop();
    }
});

// Aspect ratio buttons
document.querySelectorAll('.aspect-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.aspect-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cropAspect = btn.dataset.aspect;
        if (cropBox && video.videoWidth) {
            cropBox = applyAspectConstraint(cropBox, cropAspect);
            cropBox = snapCropTo32(cropBox);
            renderCrop();
        }
    });
});

// Crop mouse interaction
cropRegionUI.addEventListener('mousedown', (e) => {
    if (!cropActive || !cropBox) return;
    e.preventDefault();
    const handle = e.target.dataset.handle;
    cropDragging = {
        type: handle || 'move',
        startX: e.clientX,
        startY: e.clientY,
        startBox: { ...cropBox }
    };
});

document.addEventListener('mousemove', (e) => {
    if (!cropDragging) return;
    e.preventDefault();
    const dx = e.clientX - cropDragging.startX;
    const dy = e.clientY - cropDragging.startY;
    const rect = video.getBoundingClientRect();
    const scaleX = video.videoWidth / rect.width;
    const scaleY = video.videoHeight / rect.height;
    const vdx = dx * scaleX;
    const vdy = dy * scaleY;
    const sb = cropDragging.startBox;
    let nb = { ...sb };

    switch (cropDragging.type) {
        case 'move':
            nb.x = sb.x + vdx;
            nb.y = sb.y + vdy;
            break;
        case 'br':
            nb.w = sb.w + vdx;
            nb.h = sb.h + vdy;
            break;
        case 'bl':
            nb.x = sb.x + vdx;
            nb.w = sb.w - vdx;
            nb.h = sb.h + vdy;
            break;
        case 'tr':
            nb.y = sb.y + vdy;
            nb.w = sb.w + vdx;
            nb.h = sb.h - vdy;
            break;
        case 'tl':
            nb.x = sb.x + vdx;
            nb.y = sb.y + vdy;
            nb.w = sb.w - vdx;
            nb.h = sb.h - vdy;
            break;
    }

    // Enforce minimum size
    nb.w = Math.max(CROP_SNAP, nb.w);
    nb.h = Math.max(CROP_SNAP, nb.h);

    // Apply aspect constraint for corner drags
    if (['tl', 'tr', 'bl', 'br'].includes(cropDragging.type) && cropAspect !== 'free') {
        nb = applyAspectConstraint(nb, cropAspect);
    }

    nb = snapCropTo32(nb);
    cropBox = nb;
    renderCrop();
});

document.addEventListener('mouseup', () => {
    cropDragging = null;
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

    // Warn about invalid frame count
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

    // Build export payload
    const payload = {
        source_video: sourceDir + '/' + currentVideo,
        in_time: inTime,
        out_time: outTime,
        caption: caption,
        output_dir: outputDir
    };

    // Add crop if active and not full video
    if (cropActive && cropBox && video.videoWidth) {
        if (cropBox.w < video.videoWidth || cropBox.h < video.videoHeight) {
            payload.crop_x = cropBox.x;
            payload.crop_y = cropBox.y;
            payload.crop_w = cropBox.w;
            payload.crop_h = cropBox.h;
        }
    }

    try {
        const resp = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.detail || 'Export failed');
        }
        setStatus(`Exported: ${data.filename}.mp4 + .txt + dataset.json`, 'success');
        inTime = null;
        outTime = null;
        updateFilenamePreview();
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
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
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
        case 'c':
        case 'C':
            e.preventDefault();
            cropToggleBtn.click();
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

// --- Window resize: re-render crop ---
window.addEventListener('resize', () => {
    if (cropActive) renderCrop();
});

// --- Init ---

setStatus('Ready - set source directory and load videos');

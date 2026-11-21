// Application State
let currentVideoData = null;
let ytPlayer = null;
let playerUpdateInterval = null;
let selectedResolution = "best";
let activeDownloadId = null;
let pollInterval = null;

// DOM Elements
const videoUrlInput = document.getElementById("videoUrl");
const pasteBtn = document.getElementById("pasteBtn");
const parseBtn = document.getElementById("parseBtn");
const parseBtnText = document.getElementById("parseBtnText");
const errorMessage = document.getElementById("errorMessage");
const errorText = document.getElementById("errorText");
const loadingSkeleton = document.getElementById("loadingSkeleton");
const videoStudio = document.getElementById("videoStudio");

// Video Info Elements
const badgeDuration = document.getElementById("badgeDuration");
const badgeChannel = document.getElementById("badgeChannel");
const videoTitle = document.getElementById("videoTitle");
const videoDesc = document.getElementById("videoDesc");
const statDuration = document.getElementById("statDuration");
const statMaxRes = document.getElementById("statMaxRes");
const playerCurrentTimeDisplay = document.getElementById("playerCurrentTimeDisplay");

// Resolution & Format Elements
const resolutionList = document.getElementById("resolutionList");
const customFilenameInput = document.getElementById("customFilename");

// Timeline & Slicer Elements
const rangeStart = document.getElementById("rangeStart");
const rangeEnd = document.getElementById("rangeEnd");
const sliderHighlight = document.getElementById("sliderHighlight");
const timelineStartLabel = document.getElementById("timelineStartLabel");
const timelineEndLabel = document.getElementById("timelineEndLabel");
const startTimeInput = document.getElementById("startTimeInput");
const endTimeInput = document.getElementById("endTimeInput");
const selectedDurationDisplay = document.getElementById("selectedDurationDisplay");
const setStartFromPlayerBtn = document.getElementById("setStartFromPlayerBtn");
const setEndFromPlayerBtn = document.getElementById("setEndFromPlayerBtn");
const resetStartBtn = document.getElementById("resetStartBtn");
const resetEndBtn = document.getElementById("resetEndBtn");

// Download Elements
const startDownloadBtn = document.getElementById("startDownloadBtn");
const downloadBtnLabel = document.getElementById("downloadBtnLabel");
const downloadModal = document.getElementById("downloadModal");
const taskTitleDisplay = document.getElementById("taskTitleDisplay");
const taskStatusMsg = document.getElementById("taskStatusMsg");
const progressPercentBadge = document.getElementById("progressPercentBadge");
const progressBarFill = document.getElementById("progressBarFill");
const statSpeed = document.getElementById("statSpeed");
const statEta = document.getElementById("statEta");
const statDownloaded = document.getElementById("statDownloaded");
const statCutBadge = document.getElementById("statCutBadge");
const completedActions = document.getElementById("completedActions");
const browserDownloadBtn = document.getElementById("browserDownloadBtn");
const openFolderActionBtn = document.getElementById("openFolderActionBtn");
const openFolderBtn = document.getElementById("openFolderBtn");
const downloadsLibrary = document.getElementById("downloadsLibrary");
const refreshLibraryBtn = document.getElementById("refreshLibraryBtn");

// Helper: Format seconds to HH:MM:SS or MM:SS
function formatTime(totalSeconds) {
    if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds < 0) return "00:00";
    totalSeconds = Math.round(totalSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num) => String(num).padStart(2, "0");
    if (hours > 0) {
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
}

// Helper: Parse HH:MM:SS or MM:SS or seconds string to numeric seconds
function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const clean = timeStr.trim();
    if (/^\d+(\.\d+)?$/.test(clean)) {
        return parseFloat(clean);
    }
    const parts = clean.split(":").map(Number);
    if (parts.some(isNaN)) return 0;

    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    return parts[0] || 0;
}

// Helper: Extract YouTube ID
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Paste Button
pasteBtn.addEventListener("click", async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            videoUrlInput.value = text.trim();
            handleParse();
        }
    } catch (e) {
        videoUrlInput.focus();
    }
});

videoUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        handleParse();
    }
});

parseBtn.addEventListener("click", handleParse);

function showError(msg) {
    errorText.textContent = msg;
    errorMessage.classList.remove("hidden");
    loadingSkeleton.classList.add("hidden");
    if (window.lucide) lucide.createIcons();
}

function hideError() {
    errorMessage.classList.add("hidden");
    errorText.textContent = "";
}

// Parse Video from URL
async function handleParse() {
    const url = videoUrlInput.value.trim();
    if (!url) {
        showError("Please enter a YouTube video URL.");
        return;
    }

    hideError();
    loadingSkeleton.classList.remove("hidden");
    videoStudio.classList.add("hidden");
    parseBtn.disabled = true;
    parseBtnText.textContent = "Analyzing...";

    try {
        const res = await fetch("/api/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || "Failed to analyze video.");
        }

        currentVideoData = data;
        renderVideoStudio(data);
    } catch (err) {
        showError(err.message || "An error occurred while parsing the video.");
    } finally {
        loadingSkeleton.classList.add("hidden");
        parseBtn.disabled = false;
        parseBtnText.textContent = "Analyze Video";
    }
}

// Initialize / Update YouTube Player
function initPlayer(videoId) {
    const container = document.getElementById("playerContainer");
    container.innerHTML = `<div id="ytIframe"></div>`;

    if (playerUpdateInterval) {
        clearInterval(playerUpdateInterval);
    }

    const watchLink = document.getElementById("watchOnYtLink");
    if (watchLink) {
        watchLink.href = `https://www.youtube.com/watch?v=${videoId}`;
    }

    try {
        ytPlayer = new YT.Player("ytIframe", {
            height: "100%",
            width: "100%",
            videoId: videoId,
            playerVars: {
                playsinline: 1,
                modestbranding: 1,
                rel: 0,
                enablejsapi: 1,
                origin: window.location.origin
            },
            events: {
                onReady: (event) => {
                    playerUpdateInterval = setInterval(() => {
                        if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration) {
                            try {
                                const cur = ytPlayer.getCurrentTime() || 0;
                                const dur = ytPlayer.getDuration() || currentVideoData.duration || 0;
                                playerCurrentTimeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
                            } catch (e) {}
                        }
                    }, 500);
                },
                onError: (event) => {
                    // Video playback restricted by owner in embedded iframes
                    const thumb = currentVideoData?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                    container.innerHTML = `
                        <div class="relative w-full h-full bg-cover bg-center flex flex-col items-center justify-center p-4 text-center select-none" style="background-image: linear-gradient(rgba(10,12,18,0.75), rgba(10,12,18,0.92)), url('${thumb}');">
                            <div class="w-10 h-10 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 flex items-center justify-center mb-2 shadow-lg">
                                <i data-lucide="shield-alert" class="w-5 h-5"></i>
                            </div>
                            <p class="text-xs font-bold text-white mb-1">Embedded Playback Restricted by Owner</p>
                            <p class="text-[11px] text-gray-300 max-w-xs mb-3 leading-relaxed">
                                The creator disabled in-page playback on external sites. 
                                <span class="text-emerald-400 font-medium block mt-1">✓ You can still select resolution & download any middle duration clip below!</span>
                            </p>
                            <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold shadow transition transform active:scale-95">
                                <span>Check Timestamps on YouTube</span>
                                <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                            </a>
                        </div>
                    `;
                    if (window.lucide) lucide.createIcons();
                }
            }
        });
    } catch (err) {
        console.error("Player initialization error:", err);
    }
}

// Render Video Information & Timeline Controls
function renderVideoStudio(data) {
    videoStudio.classList.remove("hidden");

    // Populate metadata
    videoTitle.textContent = data.title;
    videoDesc.textContent = data.description || "No description available.";
    badgeDuration.textContent = data.duration_formatted;
    badgeChannel.textContent = data.channel;
    statDuration.textContent = data.duration_formatted;

    const maxRes = (data.resolutions && data.resolutions.length > 0) ? `${data.resolutions[0].height}p` : "Auto";
    statMaxRes.textContent = maxRes;

    // Render Resolutions
    resolutionList.innerHTML = "";
    
    // Add "Best Quality" button
    const bestBtn = createResolutionBadge("best", "✨ Best Quality (Auto)", true);
    resolutionList.appendChild(bestBtn);
    selectedResolution = "best";

    if (data.resolutions && data.resolutions.length > 0) {
        data.resolutions.forEach((res) => {
            const btn = createResolutionBadge(String(res.height), res.label, false);
            resolutionList.appendChild(btn);
        });
    }

    // Add Audio Only Badge
    const audioBtn = createResolutionBadge("audio_only", "🎵 Audio Only (MP3)", false);
    resolutionList.appendChild(audioBtn);

    // Setup Timeline Controls
    setupTimeline(data.duration);

    // Embed player
    if (data.id) {
        initPlayer(data.id);
    }

    if (window.lucide) lucide.createIcons();
    videoStudio.scrollIntoView({ behavior: "smooth", block: "start" });
}

function createResolutionBadge(value, label, isSelected) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `res-badge text-xs px-3.5 py-2 rounded-xl font-medium border transition ${
        isSelected 
            ? "bg-red-600 text-white border-red-500 shadow-lg shadow-red-600/30 font-semibold" 
            : "bg-dark-900 text-gray-300 border-dark-600 hover:border-dark-500 hover:bg-dark-700"
    }`;
    btn.textContent = label;
    btn.dataset.value = value;

    btn.addEventListener("click", () => {
        document.querySelectorAll(".res-badge").forEach((b) => {
            b.className = "res-badge text-xs px-3.5 py-2 rounded-xl font-medium border transition bg-dark-900 text-gray-300 border-dark-600 hover:border-dark-500 hover:bg-dark-700";
        });
        btn.className = "res-badge text-xs px-3.5 py-2 rounded-xl font-semibold border transition bg-red-600 text-white border-red-500 shadow-lg shadow-red-600/30";
        selectedResolution = value;

        // Auto select MP3 radio if audio_only is clicked
        if (value === "audio_only") {
            const mp3Radio = document.querySelector('input[name="videoFormat"][value="mp3"]');
            if (mp3Radio) mp3Radio.checked = true;
        }
    });

    return btn;
}

// Setup Timeline Slider and Inputs
function setupTimeline(totalDuration) {
    const total = Math.max(1, Math.round(totalDuration || 0));

    rangeStart.min = 0;
    rangeStart.max = total;
    rangeStart.value = 0;

    rangeEnd.min = 0;
    rangeEnd.max = total;
    rangeEnd.value = total;

    timelineStartLabel.textContent = "00:00";
    timelineEndLabel.textContent = formatTime(total);

    startTimeInput.value = "00:00";
    endTimeInput.value = formatTime(total);

    updateTimelineView();
}

function updateTimelineView() {
    if (!currentVideoData) return;
    const total = currentVideoData.duration || 1;

    let start = parseFloat(rangeStart.value) || 0;
    let end = parseFloat(rangeEnd.value) || total;

    if (start > end) {
        // Swap or prevent cross
        start = end;
        rangeStart.value = start;
    }

    const leftPercent = (start / total) * 100;
    const widthPercent = ((end - start) / total) * 100;

    sliderHighlight.style.left = `${leftPercent}%`;
    sliderHighlight.style.width = `${widthPercent}%`;

    const diff = end - start;
    const isFull = (start === 0 && Math.abs(end - total) <= 1);

    if (isFull) {
        selectedDurationDisplay.textContent = `${formatTime(diff)} (Full Video)`;
        downloadBtnLabel.textContent = "Download Full Video";
    } else {
        const mins = Math.floor(diff / 60);
        const secs = Math.round(diff % 60);
        const humanReadable = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        selectedDurationDisplay.textContent = `${formatTime(diff)} (${humanReadable} middle slice)`;
        downloadBtnLabel.textContent = `Download Selected Clip (${formatTime(start)} → ${formatTime(end)})`;
    }
}

// Slider Event Listeners
rangeStart.addEventListener("input", () => {
    let s = parseFloat(rangeStart.value);
    let e = parseFloat(rangeEnd.value);
    if (s > e) {
        s = e;
        rangeStart.value = s;
    }
    startTimeInput.value = formatTime(s);
    updateTimelineView();
});

rangeEnd.addEventListener("input", () => {
    let s = parseFloat(rangeStart.value);
    let e = parseFloat(rangeEnd.value);
    if (e < s) {
        e = s;
        rangeEnd.value = e;
    }
    endTimeInput.value = formatTime(e);
    updateTimelineView();
});

// Manual Text Input Event Listeners
startTimeInput.addEventListener("change", () => {
    if (!currentVideoData) return;
    const total = currentVideoData.duration;
    let sec = parseTimeToSeconds(startTimeInput.value);
    sec = Math.max(0, Math.min(sec, total));
    rangeStart.value = sec;
    startTimeInput.value = formatTime(sec);
    updateTimelineView();
});

endTimeInput.addEventListener("change", () => {
    if (!currentVideoData) return;
    const total = currentVideoData.duration;
    let sec = parseTimeToSeconds(endTimeInput.value);
    sec = Math.max(0, Math.min(sec, total));
    rangeEnd.value = sec;
    endTimeInput.value = formatTime(sec);
    updateTimelineView();
});

// Grab Player Position Buttons
setStartFromPlayerBtn.addEventListener("click", () => {
    if (ytPlayer && ytPlayer.getCurrentTime) {
        const cur = Math.floor(ytPlayer.getCurrentTime() || 0);
        rangeStart.value = cur;
        startTimeInput.value = formatTime(cur);
        updateTimelineView();
    }
});

setEndFromPlayerBtn.addEventListener("click", () => {
    if (ytPlayer && ytPlayer.getCurrentTime) {
        const cur = Math.ceil(ytPlayer.getCurrentTime() || 0);
        rangeEnd.value = cur;
        endTimeInput.value = formatTime(cur);
        updateTimelineView();
    }
});

// Reset Buttons
resetStartBtn.addEventListener("click", () => {
    rangeStart.value = 0;
    startTimeInput.value = "00:00";
    updateTimelineView();
});

resetEndBtn.addEventListener("click", () => {
    if (!currentVideoData) return;
    rangeEnd.value = currentVideoData.duration;
    endTimeInput.value = formatTime(currentVideoData.duration);
    updateTimelineView();
});

// Quick Presets
document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        if (!currentVideoData) return;
        const total = currentVideoData.duration;
        const preset = btn.dataset.preset;

        if (preset === "full") {
            rangeStart.value = 0;
            rangeEnd.value = total;
        } else if (preset === "middle-5m") {
            // User requirement: "if the user want 5 min from middle that can select the timeline and download"
            const clipLength = 300; // 5 minutes
            if (total <= clipLength) {
                rangeStart.value = 0;
                rangeEnd.value = total;
            } else {
                const middle = total / 2;
                rangeStart.value = Math.max(0, Math.round(middle - (clipLength / 2)));
                rangeEnd.value = Math.min(total, Math.round(middle + (clipLength / 2)));
            }
        } else if (preset === "first-5m") {
            rangeStart.value = 0;
            rangeEnd.value = Math.min(total, 300);
        } else if (preset === "first-1m") {
            rangeStart.value = 0;
            rangeEnd.value = Math.min(total, 60);
        } else if (preset === "plus-30s") {
            let currentEnd = parseFloat(rangeEnd.value);
            rangeEnd.value = Math.min(total, currentEnd + 30);
        } else if (preset === "minus-30s") {
            let currentEnd = parseFloat(rangeEnd.value);
            rangeEnd.value = Math.max(parseFloat(rangeStart.value) + 1, currentEnd - 30);
        }

        startTimeInput.value = formatTime(parseFloat(rangeStart.value));
        endTimeInput.value = formatTime(parseFloat(rangeEnd.value));
        updateTimelineView();

        // Optional seek video player to start
        if (ytPlayer && ytPlayer.seekTo) {
            ytPlayer.seekTo(parseFloat(rangeStart.value), true);
        }
    });
});

// Start Download
startDownloadBtn.addEventListener("click", async () => {
    if (!currentVideoData) return;

    const startSec = parseFloat(rangeStart.value) || 0;
    const endSec = parseFloat(rangeEnd.value) || currentVideoData.duration;
    const total = currentVideoData.duration;

    const isSliced = !(startSec === 0 && Math.abs(endSec - total) <= 1);
    const selectedFormat = document.querySelector('input[name="videoFormat"]:checked')?.value || "mp4";
    const customFilename = customFilenameInput.value.trim();

    const payload = {
        url: currentVideoData.webpage_url || videoUrlInput.value.trim(),
        resolution: selectedResolution,
        format: selectedFormat,
        start_time: isSliced ? startSec : null,
        end_time: isSliced ? endSec : null,
        custom_filename: customFilename || null
    };

    // UI Feedback: Show Download Modal
    downloadModal.classList.remove("hidden");
    completedActions.classList.add("hidden");
    progressBarFill.style.width = "0%";
    progressPercentBadge.textContent = "0.0%";
    taskTitleDisplay.textContent = currentVideoData.title;
    taskStatusMsg.textContent = "Initiating download task...";
    const resLabel = selectedResolution === "best" ? "Best Quality" : (selectedResolution === "audio_only" ? "MP3 Audio" : `${selectedResolution}p`);
    statCutBadge.textContent = isSliced ? `${formatTime(startSec)} → ${formatTime(endSec)} (${resLabel})` : `Full Video (${resLabel})`;
    startDownloadBtn.disabled = true;

    downloadModal.scrollIntoView({ behavior: "smooth", block: "center" });

    try {
        const res = await fetch("/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || "Failed to start download.");
        }

        activeDownloadId = data.download_id;
        startPollingProgress(activeDownloadId);
    } catch (err) {
        taskStatusMsg.textContent = `Error: ${err.message}`;
        startDownloadBtn.disabled = false;
    }
});

// Poll download progress
function startPollingProgress(downloadId) {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/status/${downloadId}`);
            if (!res.ok) return;

            const task = await res.json();
            const pct = task.progress || 0;
            progressBarFill.style.width = `${pct}%`;
            progressPercentBadge.textContent = `${pct.toFixed(1)}%`;

            statSpeed.textContent = task.speed_str || "Connecting...";
            statEta.textContent = task.eta_str || "--";
            statDownloaded.textContent = `${task.downloaded_bytes_str || "0 MB"} / ${task.total_bytes_str || "..."}`;

            if (task.status === "downloading") {
                taskStatusMsg.textContent = "Downloading high-resolution streams...";
            } else if (task.status === "processing") {
                taskStatusMsg.textContent = task.status_msg || "Trimming & merging streams with FFmpeg...";
            } else if (task.status === "completed") {
                clearInterval(pollInterval);
                taskStatusMsg.textContent = "File ready!";
                progressBarFill.style.width = "100%";
                progressPercentBadge.textContent = "100%";
                startDownloadBtn.disabled = false;

                // Setup download button
                browserDownloadBtn.href = `/api/download-file/${downloadId}`;
                browserDownloadBtn.setAttribute("download", task.filename || "video.mp4");
                completedActions.classList.remove("hidden");

                if (window.lucide) lucide.createIcons();
                loadDownloadsLibrary();
            } else if (task.status === "error") {
                clearInterval(pollInterval);
                taskStatusMsg.textContent = `Failed: ${task.error_message || "Unknown error"}`;
                startDownloadBtn.disabled = false;
            }
        } catch (e) {
            console.error("Progress poll error", e);
        }
    }, 600);
}

// Open folder action button
openFolderBtn.addEventListener("click", openDownloadsFolder);
openFolderActionBtn.addEventListener("click", openDownloadsFolder);

async function openDownloadsFolder() {
    try {
        const res = await fetch("/api/open-folder", { method: "POST" });
        const data = await res.json();
        if (!data.success) {
            alert(data.message || "Could not open folder.");
        }
    } catch (e) {
        console.error(e);
    }
}

// Load Recent Downloads Library
async function loadDownloadsLibrary() {
    try {
        const res = await fetch("/api/downloads");
        if (!res.ok) return;
        const data = await res.json();

        if (!data.downloads || data.downloads.length === 0) {
            downloadsLibrary.innerHTML = `<p class="text-xs text-gray-500 py-3 text-center">No downloads in this folder yet.</p>`;
            return;
        }

        downloadsLibrary.innerHTML = "";
        data.downloads.forEach((file) => {
            const item = document.createElement("div");
            item.className = "flex items-center justify-between p-3 rounded-xl bg-dark-900 border border-dark-700 hover:border-dark-600 transition text-xs";
            item.innerHTML = `
                <div class="flex items-center gap-3 min-w-0 pr-3">
                    <span class="px-2 py-1 rounded bg-dark-800 text-[10px] font-bold text-gray-400 border border-dark-700">${file.ext}</span>
                    <span class="font-medium text-gray-200 truncate" title="${file.filename}">${file.filename}</span>
                </div>
                <div class="flex items-center gap-3 flex-shrink-0">
                    <span class="text-gray-400 font-mono text-[11px]">${file.size_str}</span>
                    <button class="delete-file-btn text-gray-500 hover:text-red-400 p-1 transition" data-filename="${file.filename}" title="Delete file">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            `;
            downloadsLibrary.appendChild(item);
        });

        // Attach delete listeners
        document.querySelectorAll(".delete-file-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const fname = btn.dataset.filename;
                if (confirm(`Delete "${fname}"?`)) {
                    await fetch(`/api/delete-file/${encodeURIComponent(fname)}`, { method: "DELETE" });
                    loadDownloadsLibrary();
                }
            });
        });

        if (window.lucide) lucide.createIcons();
    } catch (e) {
        console.error("Library load error", e);
    }
}

refreshLibraryBtn.addEventListener("click", loadDownloadsLibrary);

// Initial load
loadDownloadsLibrary();

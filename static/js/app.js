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
const statMaxRes = document.getElementById("statMaxRes");
const playerCurrentTimeDisplay = document.getElementById("playerCurrentTimeDisplay");

// Chapters & Subtitles & Advanced Options
const chaptersContainer = document.getElementById("chaptersContainer");
const chaptersList = document.getElementById("chaptersList");
const chaptersCountBadge = document.getElementById("chaptersCountBadge");
const losslessCutCheckbox = document.getElementById("losslessCutCheckbox");
const audioFadeCheckbox = document.getElementById("audioFadeCheckbox");
const subtitleSelect = document.getElementById("subtitleSelect");
const embedSubCheckbox = document.getElementById("embedSubCheckbox");

// In-App Video Player Modal Elements
const videoModal = document.getElementById("videoModal");
const modalVideoTitle = document.getElementById("modalVideoTitle");
const modalVideoPlayer = document.getElementById("modalVideoPlayer");
const modalCloseBtn = document.getElementById("modalCloseBtn");

// Cookie & Verification Modal Elements
const cookiesModalBtn = document.getElementById("cookiesModalBtn");
const openCookiesFromErrorBtn = document.getElementById("openCookiesFromErrorBtn");
const cookiesModal = document.getElementById("cookiesModal");
const cookiesModalCloseBtn = document.getElementById("cookiesModalCloseBtn");
const cookieTextInput = document.getElementById("cookieTextInput");
const cookiesFileInput = document.getElementById("cookiesFileInput");
const saveCookiesBtn = document.getElementById("saveCookiesBtn");
const deleteCookiesBtn = document.getElementById("deleteCookiesBtn");
const cookieStatusMsg = document.getElementById("cookieStatusMsg");

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
const cancelDownloadBtn = document.getElementById("cancelDownloadBtn");
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

// Paste Button
if (pasteBtn && videoUrlInput) {
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
}

if (videoUrlInput) {
    videoUrlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleParse();
        }
    });
    videoUrlInput.addEventListener("input", (e) => {
        localStorage.setItem("yt_cached_url", e.target.value.trim());
    });
}

if (parseBtn) {
    parseBtn.addEventListener("click", handleParse);
}

function showError(msg) {
    if (errorText) errorText.textContent = msg;
    if (errorMessage) errorMessage.classList.remove("hidden");
    if (loadingSkeleton) loadingSkeleton.classList.add("hidden");
    if (openCookiesFromErrorBtn) {
        const needsCookies = /verification|bot|cookie/i.test(msg);
        if (needsCookies) {
            openCookiesFromErrorBtn.classList.remove("hidden");
        } else {
            openCookiesFromErrorBtn.classList.add("hidden");
        }
    }
    if (window.lucide) lucide.createIcons();
}

function hideError() {
    if (errorMessage) errorMessage.classList.add("hidden");
    if (errorText) errorText.textContent = "";
    if (openCookiesFromErrorBtn) openCookiesFromErrorBtn.classList.add("hidden");
}

// Parse Video from URL
async function handleParse() {
    const url = videoUrlInput ? videoUrlInput.value.trim() : "";
    if (!url) {
        showError("Please enter a YouTube video URL.");
        return;
    }

    hideError();
    if (loadingSkeleton) loadingSkeleton.classList.remove("hidden");
    if (videoStudio) videoStudio.classList.add("hidden");
    if (parseBtn) parseBtn.disabled = true;
    if (parseBtnText) parseBtnText.textContent = "Analyzing...";

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
        localStorage.setItem("yt_cached_video", JSON.stringify(data));
        localStorage.setItem("yt_cached_url", url);

        renderVideoStudio(data);
    } catch (err) {
        showError(err.message || "An error occurred while parsing the video.");
    } finally {
        if (loadingSkeleton) loadingSkeleton.classList.add("hidden");
        if (parseBtn) parseBtn.disabled = false;
        if (parseBtnText) parseBtnText.textContent = "Analyze";
    }
}

// YouTube API Ready Queue
let pendingPlayerVideoId = null;
window.onYouTubeIframeAPIReady = function() {
    if (pendingPlayerVideoId) {
        const vid = pendingPlayerVideoId;
        pendingPlayerVideoId = null;
        initPlayer(vid);
    }
};

// Initialize / Update YouTube Player
function initPlayer(videoId) {
    const container = document.getElementById("playerContainer");
    if (!container) return;

    const watchLink = document.getElementById("watchOnYtLink");
    if (watchLink) {
        watchLink.href = `https://www.youtube.com/watch?v=${videoId}`;
    }

    if (typeof YT === "undefined" || !YT.Player) {
        pendingPlayerVideoId = videoId;
        const thumb = currentVideoData?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        container.innerHTML = `
            <div class="relative w-full h-full bg-cover bg-center flex items-center justify-center select-none" style="background-image: url('${thumb}');">
                <div class="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            </div>
        `;
        return;
    }

    container.innerHTML = `<div id="ytIframe"></div>`;

    if (playerUpdateInterval) {
        clearInterval(playerUpdateInterval);
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
                                const dur = ytPlayer.getDuration() || currentVideoData?.duration || 0;
                                if (playerCurrentTimeDisplay) {
                                    playerCurrentTimeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
                                }
                            } catch (e) {}
                        }
                    }, 500);
                },
                onError: (event) => {
                    // Video playback restricted by owner in embedded iframes
                    const thumb = currentVideoData?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                    container.innerHTML = `
                        <div class="relative w-full h-full bg-cover bg-center flex flex-col items-center justify-center p-4 text-center select-none" style="background-image: linear-gradient(rgba(14,16,20,0.88), rgba(14,16,20,0.96)), url('${thumb}');">
                            <p class="text-xs font-medium text-neutral-200 mb-1">In-page playback restricted by creator</p>
                            <p class="text-[11px] text-neutral-400 max-w-xs mb-3">You can still select any resolution & download any clip slice below.</p>
                            <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-50 hover:bg-surface-100 text-neutral-300 hover:text-white rounded-md text-xs border border-border-subtle transition">
                                <span>Check Timestamps on YouTube</span>
                                <i data-lucide="external-link" class="w-3 h-3"></i>
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
    if (!data) return;
    if (videoStudio) videoStudio.classList.remove("hidden");

    // Populate metadata
    if (videoTitle) videoTitle.textContent = data.title;
    if (videoDesc) videoDesc.textContent = data.description || "No description available.";
    if (badgeDuration) badgeDuration.textContent = data.duration_formatted;
    if (badgeChannel) badgeChannel.textContent = data.channel;

    const maxRes = (data.resolutions && data.resolutions.length > 0) ? `${data.resolutions[0].height}p max` : "Auto";
    if (statMaxRes) statMaxRes.textContent = maxRes;

    // Render Resolutions
    if (resolutionList) {
        resolutionList.innerHTML = "";
        
        let savedRes = localStorage.getItem("yt_selected_res") || "best";
        selectedResolution = savedRes;

        // Auto (Best) Button
        const bestBtn = createResolutionBadge("best", "Auto (Best)", savedRes === "best");
        resolutionList.appendChild(bestBtn);

        // Individual resolutions
        if (data.resolutions && data.resolutions.length > 0) {
            data.resolutions.forEach((res) => {
                const isSelected = (String(res.height) === savedRes);
                const btn = createResolutionBadge(String(res.height), res.label, isSelected);
                resolutionList.appendChild(btn);
            });
        }

        // Audio Only Badge
        const audioBtn = createResolutionBadge("audio_only", "Audio (MP3)", savedRes === "audio_only");
        resolutionList.appendChild(audioBtn);
    }

    // Setup Timeline Controls
    setupTimeline(data.duration);

    // Render Chapters if available
    if (data.chapters && data.chapters.length > 0) {
        if (chaptersContainer) chaptersContainer.classList.remove("hidden");
        if (chaptersCountBadge) chaptersCountBadge.textContent = data.chapters.length;
        if (chaptersList) {
            chaptersList.innerHTML = "";
            data.chapters.forEach((ch) => {
                const chBtn = document.createElement("button");
                chBtn.type = "button";
                chBtn.className = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-50 text-neutral-300 hover:text-white border border-border-subtle transition text-xs text-left group";
                chBtn.innerHTML = `
                    <span class="font-mono text-neutral-500 group-hover:text-neutral-300 text-[10px]">${ch.start_formatted}</span>
                    <span class="truncate max-w-[180px]">${ch.title}</span>
                `;
                chBtn.title = `${ch.title} (${ch.start_formatted} → ${ch.end_formatted})`;
                chBtn.addEventListener("click", () => {
                    const s = Math.round(ch.start_time);
                    const e = Math.min(Math.round(ch.end_time), Math.round(data.duration));
                    if (rangeStart) rangeStart.value = s;
                    if (rangeEnd) rangeEnd.value = e;
                    if (startTimeInput) startTimeInput.value = formatTime(s);
                    if (endTimeInput) endTimeInput.value = formatTime(e);
                    updateTimelineView();
                    if (ytPlayer && ytPlayer.seekTo) {
                        ytPlayer.seekTo(s, true);
                    }
                });
                chaptersList.appendChild(chBtn);
            });
        }
    } else {
        if (chaptersContainer) chaptersContainer.classList.add("hidden");
    }

    // Populate Subtitles
    if (subtitleSelect) {
        subtitleSelect.innerHTML = `<option value="">None</option>`;
        if (data.subtitles && data.subtitles.length > 0) {
            data.subtitles.forEach((sub) => {
                const opt = document.createElement("option");
                opt.value = sub.code;
                opt.textContent = sub.label;
                subtitleSelect.appendChild(opt);
            });
            const savedSub = localStorage.getItem("yt_selected_subtitle");
            if (savedSub) subtitleSelect.value = savedSub;
        }
    }

    // Embed player
    if (data.id) {
        initPlayer(data.id);
    }

    if (window.lucide) lucide.createIcons();
}

function createResolutionBadge(value, label, isSelected) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `res-badge text-xs px-3 py-1.5 rounded-lg font-medium border transition ${
        isSelected 
            ? "bg-neutral-100 text-neutral-900 border-neutral-100 font-semibold" 
            : "bg-surface-200 text-neutral-400 border-border-subtle hover:border-neutral-600 hover:text-white"
    }`;
    btn.textContent = label;
    btn.dataset.value = value;

    btn.addEventListener("click", () => {
        document.querySelectorAll(".res-badge").forEach((b) => {
            b.className = "res-badge text-xs px-3 py-1.5 rounded-lg font-medium border transition bg-surface-200 text-neutral-400 border-border-subtle hover:border-neutral-600 hover:text-white";
        });
        btn.className = "res-badge text-xs px-3 py-1.5 rounded-lg font-semibold border transition bg-neutral-100 text-neutral-900 border-neutral-100";
        selectedResolution = value;
        localStorage.setItem("yt_selected_res", value);

        // Auto select MP3 radio if audio_only is clicked
        if (value === "audio_only") {
            const mp3Radio = document.querySelector('input[name="videoFormat"][value="mp3"]');
            if (mp3Radio) {
                mp3Radio.checked = true;
                localStorage.setItem("yt_selected_format", "mp3");
            }
        }
    });

    return btn;
}

// Setup Timeline Slider and Inputs
function setupTimeline(totalDuration) {
    const total = Math.max(1, Math.round(totalDuration || 0));

    if (rangeStart) {
        rangeStart.min = 0;
        rangeStart.max = total;
    }
    if (rangeEnd) {
        rangeEnd.min = 0;
        rangeEnd.max = total;
    }

    let s = 0;
    let e = total;

    const savedS = parseFloat(localStorage.getItem("yt_range_start"));
    const savedE = parseFloat(localStorage.getItem("yt_range_end"));
    if (!isNaN(savedS) && savedS >= 0 && savedS <= total) s = savedS;
    if (!isNaN(savedE) && savedE > s && savedE <= total) e = savedE;

    if (rangeStart) rangeStart.value = s;
    if (rangeEnd) rangeEnd.value = e;

    if (timelineStartLabel) timelineStartLabel.textContent = "00:00";
    if (timelineEndLabel) timelineEndLabel.textContent = formatTime(total);

    if (startTimeInput) startTimeInput.value = formatTime(s);
    if (endTimeInput) endTimeInput.value = formatTime(e);

    updateTimelineView();
}

function updateTimelineView() {
    if (!currentVideoData) return;
    const total = currentVideoData.duration || 1;

    let start = rangeStart ? (parseFloat(rangeStart.value) || 0) : 0;
    let end = rangeEnd ? (parseFloat(rangeEnd.value) || total) : total;

    if (start > end) {
        start = end;
        if (rangeStart) rangeStart.value = start;
    }

    const leftPercent = (start / total) * 100;
    const widthPercent = ((end - start) / total) * 100;

    if (sliderHighlight) {
        sliderHighlight.style.left = `${leftPercent}%`;
        sliderHighlight.style.width = `${widthPercent}%`;
    }

    const diff = end - start;
    const isFull = (start === 0 && Math.abs(end - total) <= 1);

    if (isFull) {
        if (selectedDurationDisplay) selectedDurationDisplay.textContent = `${formatTime(diff)} (Full)`;
        if (downloadBtnLabel) downloadBtnLabel.textContent = "Download Full Video";
    } else {
        const mins = Math.floor(diff / 60);
        const secs = Math.round(diff % 60);
        const humanReadable = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        if (selectedDurationDisplay) selectedDurationDisplay.textContent = `${formatTime(diff)} (${humanReadable})`;
        if (downloadBtnLabel) downloadBtnLabel.textContent = `Download Clip (${formatTime(start)} → ${formatTime(end)})`;
    }

    localStorage.setItem("yt_range_start", start);
    localStorage.setItem("yt_range_end", end);
}

// Slider Event Listeners with Touch & Stacking optimization
function bringToFront(activeEl, backgroundEl) {
    if (activeEl) activeEl.style.zIndex = "30";
    if (backgroundEl) backgroundEl.style.zIndex = "20";
}

if (rangeStart) {
    const onStartActive = () => bringToFront(rangeStart, rangeEnd);
    rangeStart.addEventListener("pointerdown", onStartActive);
    rangeStart.addEventListener("touchstart", onStartActive, { passive: true });
    rangeStart.addEventListener("input", () => {
        onStartActive();
        let s = parseFloat(rangeStart.value);
        let e = rangeEnd ? parseFloat(rangeEnd.value) : s;
        if (s > e) {
            s = e;
            rangeStart.value = s;
        }
        if (startTimeInput) startTimeInput.value = formatTime(s);
        updateTimelineView();
    });
}

if (rangeEnd) {
    const onEndActive = () => bringToFront(rangeEnd, rangeStart);
    rangeEnd.addEventListener("pointerdown", onEndActive);
    rangeEnd.addEventListener("touchstart", onEndActive, { passive: true });
    rangeEnd.addEventListener("input", () => {
        onEndActive();
        let s = rangeStart ? parseFloat(rangeStart.value) : 0;
        let e = parseFloat(rangeEnd.value);
        if (e < s) {
            e = s;
            rangeEnd.value = e;
        }
        if (endTimeInput) endTimeInput.value = formatTime(e);
        updateTimelineView();
    });
}

// Manual Text Input Event Listeners
if (startTimeInput) {
    startTimeInput.addEventListener("change", () => {
        if (!currentVideoData) return;
        const total = currentVideoData.duration;
        let sec = parseTimeToSeconds(startTimeInput.value);
        sec = Math.max(0, Math.min(sec, total));
        if (rangeStart) rangeStart.value = sec;
        startTimeInput.value = formatTime(sec);
        updateTimelineView();
    });
}

if (endTimeInput) {
    endTimeInput.addEventListener("change", () => {
        if (!currentVideoData) return;
        const total = currentVideoData.duration;
        let sec = parseTimeToSeconds(endTimeInput.value);
        sec = Math.max(0, Math.min(sec, total));
        if (rangeEnd) rangeEnd.value = sec;
        endTimeInput.value = formatTime(sec);
        updateTimelineView();
    });
}

// Grab Player Position Buttons
if (setStartFromPlayerBtn) {
    setStartFromPlayerBtn.addEventListener("click", () => {
        if (ytPlayer && ytPlayer.getCurrentTime) {
            const cur = Math.floor(ytPlayer.getCurrentTime() || 0);
            if (rangeStart) rangeStart.value = cur;
            if (startTimeInput) startTimeInput.value = formatTime(cur);
            updateTimelineView();
        }
    });
}

if (setEndFromPlayerBtn) {
    setEndFromPlayerBtn.addEventListener("click", () => {
        if (ytPlayer && ytPlayer.getCurrentTime) {
            const cur = Math.ceil(ytPlayer.getCurrentTime() || 0);
            if (rangeEnd) rangeEnd.value = cur;
            if (endTimeInput) endTimeInput.value = formatTime(cur);
            updateTimelineView();
        }
    });
}

// Reset Buttons
if (resetStartBtn) {
    resetStartBtn.addEventListener("click", () => {
        if (rangeStart) rangeStart.value = 0;
        if (startTimeInput) startTimeInput.value = "00:00";
        updateTimelineView();
    });
}

if (resetEndBtn) {
    resetEndBtn.addEventListener("click", () => {
        if (!currentVideoData) return;
        if (rangeEnd) rangeEnd.value = currentVideoData.duration;
        if (endTimeInput) endTimeInput.value = formatTime(currentVideoData.duration);
        updateTimelineView();
    });
}

// Quick Presets
document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        if (!currentVideoData) return;
        const total = currentVideoData.duration;
        const preset = btn.dataset.preset;

        if (preset === "full") {
            if (rangeStart) rangeStart.value = 0;
            if (rangeEnd) rangeEnd.value = total;
        } else if (preset === "middle-5m") {
            const clipLength = 300; // 5 minutes
            if (total <= clipLength) {
                if (rangeStart) rangeStart.value = 0;
                if (rangeEnd) rangeEnd.value = total;
            } else {
                const middle = total / 2;
                if (rangeStart) rangeStart.value = Math.max(0, Math.round(middle - (clipLength / 2)));
                if (rangeEnd) rangeEnd.value = Math.min(total, Math.round(middle + (clipLength / 2)));
            }
        } else if (preset === "first-5m") {
            if (rangeStart) rangeStart.value = 0;
            if (rangeEnd) rangeEnd.value = Math.min(total, 300);
        } else if (preset === "first-1m") {
            if (rangeStart) rangeStart.value = 0;
            if (rangeEnd) rangeEnd.value = Math.min(total, 60);
        } else if (preset === "plus-30s") {
            let currentEnd = parseFloat(rangeEnd.value);
            if (rangeEnd) rangeEnd.value = Math.min(total, currentEnd + 30);
        } else if (preset === "minus-30s") {
            let currentEnd = parseFloat(rangeEnd.value);
            if (rangeEnd) rangeEnd.value = Math.max(parseFloat(rangeStart.value) + 1, currentEnd - 30);
        }

        if (startTimeInput && rangeStart) startTimeInput.value = formatTime(parseFloat(rangeStart.value));
        if (endTimeInput && rangeEnd) endTimeInput.value = formatTime(parseFloat(rangeEnd.value));
        updateTimelineView();

        if (ytPlayer && ytPlayer.seekTo && rangeStart) {
            ytPlayer.seekTo(parseFloat(rangeStart.value), true);
        }
    });
});

// Format Radio and Custom Filename Listeners
document.querySelectorAll('input[name="videoFormat"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
        localStorage.setItem("yt_selected_format", e.target.value);
    });
});

if (customFilenameInput) {
    customFilenameInput.addEventListener("input", (e) => {
        localStorage.setItem("yt_custom_filename", e.target.value.trim());
    });
}

// Option Checkbox Listeners
if (losslessCutCheckbox) {
    losslessCutCheckbox.addEventListener("change", (e) => {
        localStorage.setItem("yt_lossless_cut", e.target.checked);
    });
}
if (audioFadeCheckbox) {
    audioFadeCheckbox.addEventListener("change", (e) => {
        localStorage.setItem("yt_audio_fade", e.target.checked);
    });
}
if (subtitleSelect) {
    subtitleSelect.addEventListener("change", (e) => {
        localStorage.setItem("yt_selected_subtitle", e.target.value);
    });
}
if (embedSubCheckbox) {
    embedSubCheckbox.addEventListener("change", (e) => {
        localStorage.setItem("yt_embed_sub", e.target.checked);
    });
}

// Start Download
if (startDownloadBtn) {
    startDownloadBtn.addEventListener("click", async () => {
        if (!currentVideoData) return;

        const startSec = rangeStart ? (parseFloat(rangeStart.value) || 0) : 0;
        const endSec = rangeEnd ? (parseFloat(rangeEnd.value) || currentVideoData.duration) : currentVideoData.duration;
        const total = currentVideoData.duration;

        const isSliced = !(startSec === 0 && Math.abs(endSec - total) <= 1);
        const selectedFormat = document.querySelector('input[name="videoFormat"]:checked')?.value || "mp4";
        const customFilename = customFilenameInput ? customFilenameInput.value.trim() : null;
        const lossless = losslessCutCheckbox ? losslessCutCheckbox.checked : false;
        const audioFade = audioFadeCheckbox ? audioFadeCheckbox.checked : false;
        const subtitleLang = subtitleSelect ? subtitleSelect.value : null;
        const embedSub = embedSubCheckbox ? embedSubCheckbox.checked : false;

        const payload = {
            url: currentVideoData.webpage_url || (videoUrlInput ? videoUrlInput.value.trim() : ""),
            resolution: selectedResolution,
            format: selectedFormat,
            start_time: isSliced ? startSec : null,
            end_time: isSliced ? endSec : null,
            custom_filename: customFilename || null,
            lossless: lossless,
            audio_fade: audioFade,
            subtitle_lang: subtitleLang || null,
            embed_sub: embedSub
        };

        // UI Feedback: Show Download Modal
        if (downloadModal) downloadModal.classList.remove("hidden");
        if (completedActions) completedActions.classList.add("hidden");
        if (progressBarFill) progressBarFill.style.width = "0%";
        if (progressPercentBadge) progressPercentBadge.textContent = "0.0%";
        if (taskTitleDisplay && currentVideoData) taskTitleDisplay.textContent = currentVideoData.title;
        if (taskStatusMsg) taskStatusMsg.textContent = "Initiating download task...";
        const resLabel = selectedResolution === "best" ? "Best Quality" : (selectedResolution === "audio_only" ? "MP3 Audio" : `${selectedResolution}p`);
        if (statCutBadge) statCutBadge.textContent = isSliced ? `${formatTime(startSec)} → ${formatTime(endSec)} (${resLabel})` : `Full Video (${resLabel})`;
        if (startDownloadBtn) startDownloadBtn.disabled = true;

        if (downloadModal) downloadModal.scrollIntoView({ behavior: "smooth", block: "center" });

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
            localStorage.setItem("yt_active_download_id", activeDownloadId);
            startPollingProgress(activeDownloadId);
        } catch (err) {
            if (taskStatusMsg) taskStatusMsg.textContent = `Error: ${err.message}`;
            if (startDownloadBtn) startDownloadBtn.disabled = false;
        }
    });
}

// Cancel Download
if (cancelDownloadBtn) {
    cancelDownloadBtn.addEventListener("click", async () => {
        if (!activeDownloadId) return;
        try {
            await fetch(`/api/cancel/${activeDownloadId}`, { method: "POST" });
        } catch (e) {}

        if (pollInterval) clearInterval(pollInterval);
        localStorage.removeItem("yt_active_download_id");

        if (taskStatusMsg) taskStatusMsg.textContent = "Download cancelled.";
        if (startDownloadBtn) startDownloadBtn.disabled = false;
        if (progressBarFill) progressBarFill.style.width = "0%";
        if (progressPercentBadge) progressPercentBadge.textContent = "0.0%";

        setTimeout(() => {
            if (downloadModal) downloadModal.classList.add("hidden");
        }, 1200);
    });
}

// Poll download progress
function startPollingProgress(downloadId) {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/status/${downloadId}`);
            if (!res.ok) return;

            const task = await res.json();
            const pct = task.progress || 0;
            if (progressBarFill) progressBarFill.style.width = `${pct}%`;
            if (progressPercentBadge) progressPercentBadge.textContent = `${pct.toFixed(1)}%`;

            if (statSpeed) statSpeed.textContent = task.speed_str || "Connecting...";
            if (statEta) statEta.textContent = task.eta_str || "--";
            if (statDownloaded) statDownloaded.textContent = `${task.downloaded_bytes_str || "0 MB"} / ${task.total_bytes_str || "..."}`;

            if (task.status === "downloading") {
                if (taskStatusMsg) taskStatusMsg.textContent = "Downloading streams...";
            } else if (task.status === "processing") {
                if (taskStatusMsg) taskStatusMsg.textContent = task.status_msg || "Trimming & merging with FFmpeg...";
            } else if (task.status === "completed") {
                clearInterval(pollInterval);
                localStorage.removeItem("yt_active_download_id");
                if (taskStatusMsg) taskStatusMsg.textContent = "Ready!";
                if (progressBarFill) progressBarFill.style.width = "100%";
                if (progressPercentBadge) progressPercentBadge.textContent = "100%";
                if (startDownloadBtn) startDownloadBtn.disabled = false;

                // Setup download button
                if (browserDownloadBtn) {
                    browserDownloadBtn.href = `/api/download-file/${downloadId}`;
                    browserDownloadBtn.setAttribute("download", task.filename || "video.mp4");
                }
                if (completedActions) completedActions.classList.remove("hidden");

                if (window.lucide) lucide.createIcons();
                loadDownloadsLibrary();
            } else if (task.status === "cancelled") {
                clearInterval(pollInterval);
                localStorage.removeItem("yt_active_download_id");
                if (taskStatusMsg) taskStatusMsg.textContent = "Download cancelled.";
                if (startDownloadBtn) startDownloadBtn.disabled = false;
            } else if (task.status === "error") {
                clearInterval(pollInterval);
                localStorage.removeItem("yt_active_download_id");
                if (taskStatusMsg) taskStatusMsg.textContent = `Failed: ${task.error_message || "Unknown error"}`;
                if (startDownloadBtn) startDownloadBtn.disabled = false;
            }
        } catch (e) {
            console.error("Progress poll error", e);
        }
    }, 600);
}

// Open folder action button
if (openFolderBtn) openFolderBtn.addEventListener("click", openDownloadsFolder);
if (openFolderActionBtn) openFolderActionBtn.addEventListener("click", openDownloadsFolder);

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

// Video Player Modal
function openVideoModal(filename) {
    if (!videoModal || !modalVideoPlayer) return;
    if (modalVideoTitle) modalVideoTitle.textContent = filename;
    modalVideoPlayer.src = `/api/stream/${encodeURIComponent(filename)}`;
    videoModal.classList.remove("hidden");
    modalVideoPlayer.play().catch(() => {});
    if (window.lucide) lucide.createIcons();
}

function closeVideoModal() {
    if (!videoModal || !modalVideoPlayer) return;
    modalVideoPlayer.pause();
    modalVideoPlayer.removeAttribute("src");
    modalVideoPlayer.load();
    videoModal.classList.add("hidden");
}

if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", closeVideoModal);
}

if (videoModal) {
    videoModal.addEventListener("click", (e) => {
        if (e.target === videoModal) {
            closeVideoModal();
        }
    });
}

// Cookies / YouTube Auth Modal Handlers
function openCookiesModal() {
    if (!cookiesModal) return;
    cookiesModal.classList.remove("hidden");
    if (cookieStatusMsg) cookieStatusMsg.classList.add("hidden");
    if (window.lucide) lucide.createIcons();
}

function closeCookiesModal() {
    if (!cookiesModal) return;
    cookiesModal.classList.add("hidden");
}

if (cookiesModalBtn) {
    cookiesModalBtn.addEventListener("click", openCookiesModal);
}

if (openCookiesFromErrorBtn) {
    openCookiesFromErrorBtn.addEventListener("click", openCookiesModal);
}

if (cookiesModalCloseBtn) {
    cookiesModalCloseBtn.addEventListener("click", closeCookiesModal);
}

if (cookiesModal) {
    cookiesModal.addEventListener("click", (e) => {
        if (e.target === cookiesModal) closeCookiesModal();
    });
}

// Upload cookies file reader
if (cookiesFileInput && cookieTextInput) {
    cookiesFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            cookieTextInput.value = event.target.result;
        };
        reader.readAsText(file);
    });
}

// Save cookies
if (saveCookiesBtn) {
    saveCookiesBtn.addEventListener("click", async () => {
        const text = cookieTextInput ? cookieTextInput.value.trim() : "";
        if (!text) {
            showCookieMsg("Please paste cookie data or upload a cookies.txt file.", false);
            return;
        }

        saveCookiesBtn.disabled = true;
        saveCookiesBtn.textContent = "Saving...";
        try {
            const res = await fetch("/api/save-cookies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cookie_text: text })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Failed to save cookies.");

            showCookieMsg(data.message || "Cookies saved successfully!", true);
            setTimeout(() => {
                closeCookiesModal();
                saveCookiesBtn.disabled = false;
                saveCookiesBtn.textContent = "Save & Activate Cookies";
                // If there's an error message showing or a URL entered, re-parse automatically!
                if (videoUrlInput && videoUrlInput.value.trim()) {
                    handleParse();
                }
            }, 1200);
        } catch (err) {
            showCookieMsg(err.message, false);
            saveCookiesBtn.disabled = false;
            saveCookiesBtn.textContent = "Save & Activate Cookies";
        }
    });
}

// Delete cookies
if (deleteCookiesBtn) {
    deleteCookiesBtn.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to remove saved cookies?")) return;
        try {
            await fetch("/api/delete-cookies", { method: "DELETE" });
            if (cookieTextInput) cookieTextInput.value = "";
            showCookieMsg("Cookies removed from server.", true);
        } catch (e) {
            showCookieMsg("Failed to delete cookies.", false);
        }
    });
}

function showCookieMsg(msg, isSuccess) {
    if (!cookieStatusMsg) return;
    cookieStatusMsg.textContent = msg;
    cookieStatusMsg.className = `text-xs p-2.5 rounded font-mono ${
        isSuccess ? "bg-emerald-950/50 border border-emerald-800 text-emerald-300" : "bg-red-950/50 border border-red-800 text-red-300"
    }`;
    cookieStatusMsg.classList.remove("hidden");
}

// Load Recent Downloads Library
async function loadDownloadsLibrary() {
    if (!downloadsLibrary) return;
    try {
        const res = await fetch("/api/downloads");
        if (!res.ok) return;
        const data = await res.json();

        if (!data.downloads || data.downloads.length === 0) {
            downloadsLibrary.innerHTML = `<p class="text-xs text-neutral-500 py-3 text-center font-mono">No files downloaded yet.</p>`;
            return;
        }

        downloadsLibrary.innerHTML = "";
        data.downloads.forEach((file) => {
            const item = document.createElement("div");
            item.className = "flex items-center justify-between p-2.5 rounded-lg bg-surface-200 border border-border-subtle hover:border-neutral-700 transition text-xs";
            const extLower = (file.ext || "").toLowerCase();
            const isPlayable = [".mp4", ".mkv", ".webm", ".mp3", ".gif"].includes(extLower);

            item.innerHTML = `
                <div class="flex items-center gap-2.5 min-w-0 pr-2 cursor-pointer flex-1 preview-trigger" data-filename="${file.filename}">
                    <span class="px-1.5 py-0.5 rounded bg-surface-50 text-[10px] font-mono text-neutral-400 border border-border-subtle">${file.ext}</span>
                    <span class="font-normal text-neutral-200 truncate hover:text-white" title="${file.filename}">${file.filename}</span>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="text-neutral-500 font-mono text-[11px] mr-1">${file.size_str}</span>
                    ${isPlayable ? `
                        <button class="play-modal-btn text-neutral-400 hover:text-white p-1 rounded hover:bg-surface-50 transition" data-filename="${file.filename}" title="Play preview in app">
                            <i data-lucide="play" class="w-3.5 h-3.5"></i>
                        </button>
                    ` : ""}
                    <a href="/api/stream/${encodeURIComponent(file.filename)}" download="${file.filename}" class="text-neutral-400 hover:text-white p-1 rounded hover:bg-surface-50 transition" title="Save file">
                        <i data-lucide="download" class="w-3.5 h-3.5"></i>
                    </a>
                    <button class="delete-file-btn text-neutral-500 hover:text-red-400 p-1 rounded hover:bg-surface-50 transition" data-filename="${file.filename}" title="Delete file">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            `;
            downloadsLibrary.appendChild(item);
        });

        // Attach play/preview listeners
        document.querySelectorAll(".preview-trigger, .play-modal-btn").forEach((el) => {
            el.addEventListener("click", () => {
                const fname = el.dataset.filename;
                if (fname) openVideoModal(fname);
            });
        });

        // Attach delete listeners
        document.querySelectorAll(".delete-file-btn").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
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

if (refreshLibraryBtn) {
    refreshLibraryBtn.addEventListener("click", loadDownloadsLibrary);
}

// Global Keyboard Shortcuts
window.addEventListener("keydown", (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
    const isInputActive = (activeTag === "input" || activeTag === "textarea");

    if (e.key === "Escape") {
        if (cookiesModal && !cookiesModal.classList.contains("hidden")) {
            closeCookiesModal();
            return;
        }
        if (videoModal && !videoModal.classList.contains("hidden")) {
            closeVideoModal();
            return;
        }
    }

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        if (startDownloadBtn && !startDownloadBtn.disabled && currentVideoData) {
            e.preventDefault();
            startDownloadBtn.click();
            return;
        }
    }

    if (isInputActive) return;

    if (e.key === "[") {
        e.preventDefault();
        if (setStartFromPlayerBtn) setStartFromPlayerBtn.click();
    } else if (e.key === "]") {
        e.preventDefault();
        if (setEndFromPlayerBtn) setEndFromPlayerBtn.click();
    } else if (e.code === "Space") {
        if (ytPlayer && ytPlayer.getPlayerState) {
            e.preventDefault();
            const state = ytPlayer.getPlayerState();
            if (state === 1) { // playing
                ytPlayer.pauseVideo();
            } else {
                ytPlayer.playVideo();
            }
        }
    }
});

// Restore Saved Session from localStorage (Persistent across Refresh)
async function restoreSavedSession() {
    const savedUrl = localStorage.getItem("yt_cached_url");
    if (savedUrl && videoUrlInput) {
        videoUrlInput.value = savedUrl;
    }

    const savedFormat = localStorage.getItem("yt_selected_format");
    if (savedFormat) {
        const radio = document.querySelector(`input[name="videoFormat"][value="${savedFormat}"]`);
        if (radio) radio.checked = true;
    }

    const savedCustomName = localStorage.getItem("yt_custom_filename");
    if (savedCustomName && customFilenameInput) {
        customFilenameInput.value = savedCustomName;
    }

    if (losslessCutCheckbox) {
        losslessCutCheckbox.checked = (localStorage.getItem("yt_lossless_cut") === "true");
    }
    if (audioFadeCheckbox) {
        audioFadeCheckbox.checked = (localStorage.getItem("yt_audio_fade") === "true");
    }
    if (embedSubCheckbox) {
        embedSubCheckbox.checked = (localStorage.getItem("yt_embed_sub") === "true");
    }

    const savedVideoJson = localStorage.getItem("yt_cached_video");
    if (savedVideoJson) {
        try {
            const data = JSON.parse(savedVideoJson);
            currentVideoData = data;
            renderVideoStudio(data);
        } catch (e) {
            localStorage.removeItem("yt_cached_video");
        }
    }

    // Check active download task
    const savedDownloadId = localStorage.getItem("yt_active_download_id");
    if (savedDownloadId) {
        try {
            const res = await fetch(`/api/status/${savedDownloadId}`);
            if (res.ok) {
                const task = await res.json();
                if (task.status === "downloading" || task.status === "queued" || task.status === "processing") {
                    activeDownloadId = savedDownloadId;
                    if (downloadModal) downloadModal.classList.remove("hidden");
                    if (taskTitleDisplay && task.title) taskTitleDisplay.textContent = task.title;
                    if (startDownloadBtn) startDownloadBtn.disabled = true;
                    startPollingProgress(savedDownloadId);
                } else if (task.status === "completed") {
                    activeDownloadId = savedDownloadId;
                    if (downloadModal) downloadModal.classList.remove("hidden");
                    if (taskTitleDisplay && task.title) taskTitleDisplay.textContent = task.title;
                    if (taskStatusMsg) taskStatusMsg.textContent = "Ready!";
                    if (progressBarFill) progressBarFill.style.width = "100%";
                    if (progressPercentBadge) progressPercentBadge.textContent = "100%";
                    if (browserDownloadBtn) {
                        browserDownloadBtn.href = `/api/download-file/${savedDownloadId}`;
                        browserDownloadBtn.setAttribute("download", task.filename || "video.mp4");
                    }
                    if (completedActions) completedActions.classList.remove("hidden");
                } else {
                    localStorage.removeItem("yt_active_download_id");
                }
            } else {
                localStorage.removeItem("yt_active_download_id");
            }
        } catch (e) {
            localStorage.removeItem("yt_active_download_id");
        }
    }
}

// Initial Run
loadDownloadsLibrary();
restoreSavedSession();

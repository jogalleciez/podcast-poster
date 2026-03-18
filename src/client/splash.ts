import { ApiEndpoint, type InitResponse } from "../shared/api.ts";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const audio = document.getElementById("podcast-audio") as HTMLAudioElement;
const playPauseBtn = document.getElementById("play-pause-button") as HTMLButtonElement;
const playIcon = document.getElementById("play-icon") as SVGElement;
const pauseIcon = document.getElementById("pause-icon") as SVGElement;
const progressBar = document.getElementById("progress-bar") as HTMLInputElement;
const currentTimeEl = document.getElementById("current-time") as HTMLElement;
const durationEl = document.getElementById("duration") as HTMLElement;
const podcastTitleEl = document.getElementById("podcast-title") as HTMLElement;
const episodeTitleEl = document.getElementById("episode-title") as HTMLElement;
const descriptionEl = document.getElementById("description") as HTMLElement;
const coverArt = document.getElementById("cover-art") as HTMLImageElement;
const coverArtFallback = document.getElementById("cover-art-fallback") as HTMLElement;
const linkBtn = document.getElementById("link-btn") as HTMLAnchorElement;
const loadingOverlay = document.getElementById("loading-overlay") as HTMLElement;
const skipBackBtn = document.getElementById("skip-back-btn") as HTMLButtonElement;
const skipFwdBtn = document.getElementById("skip-fwd-btn") as HTMLButtonElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let isPlaying = false;

// ---------------------------------------------------------------------------
// Init — fetch episode data from the server via postData context
// ---------------------------------------------------------------------------
async function init(): Promise<void> {
  try {
    const response = await fetch(ApiEndpoint.Init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as InitResponse;

    if (data.type !== "init") throw new Error("Unexpected response type");

    // Populate titles
    podcastTitleEl.textContent = data.podcastTitle || "Podcast";
    episodeTitleEl.textContent = data.episodeTitle || "Episode";

    // Description
    descriptionEl.textContent = data.description || "No description available.";

    // Cover art
    if (data.imageUrl) {
      coverArt.src = data.imageUrl;
      coverArt.style.display = "block";
      coverArtFallback.style.display = "none";
    }

    // Link button
    const linkUrl = data.postLinkUrl || data.audioUrl;
    if (linkUrl) {
      linkBtn.href = linkUrl;
    } else {
      linkBtn.style.display = "none";
    }

    // Audio source
    if (data.audioUrl) {
      audio.src = data.audioUrl;
      playPauseBtn.disabled = false;
      playPauseBtn.setAttribute("aria-label", "Play");
    } else {
      descriptionEl.textContent += "\n\n⚠️ Audio unavailable for this episode.";
    }
  } catch (err) {
    console.error("Init error:", err);
    podcastTitleEl.textContent = "Error";
    episodeTitleEl.textContent = "Could not load episode";
    descriptionEl.textContent = "Failed to load episode data. Please refresh.";
  } finally {
    loadingOverlay.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function updateProgressTrack(): void {
  const pct = audio.duration
    ? (Number(progressBar.value) / audio.duration) * 100
    : 0;
  progressBar.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--surface2) ${pct}%)`;
}

function setPlaying(playing: boolean): void {
  isPlaying = playing;
  if (playing) {
    playIcon.style.display = "none";
    pauseIcon.style.display = "block";
    playPauseBtn.setAttribute("aria-label", "Pause");
  } else {
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
    playPauseBtn.setAttribute("aria-label", "Play");
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
playPauseBtn.addEventListener("click", () => {
  if (isPlaying) {
    audio.pause();
  } else {
    audio.play().catch(console.error);
  }
});

skipBackBtn.addEventListener("click", () => {
  audio.currentTime = Math.max(0, audio.currentTime - 15);
});

skipFwdBtn.addEventListener("click", () => {
  audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 30);
});

// ---------------------------------------------------------------------------
// Audio events
// ---------------------------------------------------------------------------
audio.addEventListener("play", () => setPlaying(true));
audio.addEventListener("pause", () => setPlaying(false));
audio.addEventListener("ended", () => setPlaying(false));

audio.addEventListener("loadedmetadata", () => {
  progressBar.max = String(Math.floor(audio.duration));
  durationEl.textContent = formatTime(audio.duration);
  updateProgressTrack();
});

audio.addEventListener("timeupdate", () => {
  if (document.activeElement !== progressBar) {
    progressBar.value = String(Math.floor(audio.currentTime));
  }
  currentTimeEl.textContent = formatTime(audio.currentTime);
  updateProgressTrack();
});

progressBar.addEventListener("input", () => {
  currentTimeEl.textContent = formatTime(Number(progressBar.value));
  updateProgressTrack();
});

progressBar.addEventListener("change", () => {
  audio.currentTime = Number(progressBar.value);
});

// ---------------------------------------------------------------------------
// Devvit inline requirement: pause when post scrolls out of view
// ---------------------------------------------------------------------------
document.addEventListener("visibilitychange", () => {
  if (document.hidden && isPlaying) {
    audio.pause();
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init();

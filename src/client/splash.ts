import { type InitResponse, ApiEndpoint } from "../shared/api.ts";

const audioElement = document.getElementById("podcast-audio") as HTMLAudioElement;
const playPauseButton = document.getElementById("play-pause-button") as HTMLButtonElement;
const playIcon = document.getElementById("play-icon") as HTMLElement;
const pauseIcon = document.getElementById("pause-icon") as HTMLElement;
const progressBar = document.getElementById("progress-bar") as HTMLInputElement;
const currentTimeDisplay = document.getElementById("current-time") as HTMLElement;
const durationDisplay = document.getElementById("duration") as HTMLElement;
const titleElement = document.getElementById("title") as HTMLHeadingElement;
const subtitleElement = document.getElementById("subtitle") as HTMLParagraphElement;
const coverArt = document.getElementById("cover-art") as HTMLImageElement;
const coverArtFallback = document.getElementById("cover-art-fallback") as HTMLElement;

let isPlaying = false;

async function init() {
  try {
    const response = await fetch(ApiEndpoint.Init);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = (await response.json()) as InitResponse;
    if (data.type === "init") {
      // Set metadata if available
      if (data.episodeTitle) {
        titleElement.textContent = data.episodeTitle;
      } else {
        titleElement.textContent = "Podcast Episode";
      }

      if (data.podcastTitle) {
        subtitleElement.textContent = data.podcastTitle;
      } else {
        subtitleElement.textContent = "Listen to the latest episode";
      }

      if (data.imageUrl) {
        coverArt.src = data.imageUrl;
        coverArt.style.display = "block";
        coverArtFallback.style.display = "none";
      }

      if (data.audioUrl) {
        audioElement.src = data.audioUrl;
        playPauseButton.disabled = false;
      } else {
        subtitleElement.textContent = "Audio unavailable";
      }

    }
  } catch (error) {
    console.error("Error fetching initial count:", error);
    titleElement.textContent = "Load Error";
  }
}

// Formatting time from seconds to m:ss
function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Toggle Play/Pause
playPauseButton.addEventListener("click", () => {
  if (isPlaying) {
    audioElement.pause();
  } else {
    audioElement.play();
  }
});

// Update UI on play
audioElement.addEventListener("play", () => {
  isPlaying = true;
  playPauseButton.classList.add("is-playing");
  playIcon.style.display = "none";
  pauseIcon.style.display = "block";
});

// Update UI on pause
audioElement.addEventListener("pause", () => {
  isPlaying = false;
  playPauseButton.classList.remove("is-playing");
  playIcon.style.display = "block";
  pauseIcon.style.display = "none";
});

// Set duration when metadata is loaded
audioElement.addEventListener("loadedmetadata", () => {
  progressBar.max = Math.floor(audioElement.duration).toString();
  durationDisplay.textContent = formatTime(audioElement.duration);
});

// Update progress bar and time as audio plays
audioElement.addEventListener("timeupdate", () => {
  // Only update value if user isn't currently dragging the slider
  if (document.activeElement !== progressBar) {
    progressBar.value = Math.floor(audioElement.currentTime).toString();
  }
  currentTimeDisplay.textContent = formatTime(audioElement.currentTime);
});

// Handle seeking when user interacts with the progress bar
progressBar.addEventListener("input", () => {
  currentTimeDisplay.textContent = formatTime(Number(progressBar.value));
});

progressBar.addEventListener("change", () => {
  audioElement.currentTime = Number(progressBar.value);
});

// Initialize on load
init();

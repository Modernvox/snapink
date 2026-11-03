const videos = [...document.querySelectorAll("[data-fit-video]")];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const visibleVideos = new Set();

const loadVideo = (video) => {
  if (video.dataset.loaded === "true") return;
  video.src = video.dataset.videoSrc;
  video.dataset.loaded = "true";
  video.load();
};

const setToggleState = (video, button, playing) => {
  button.setAttribute("aria-pressed", String(playing));
  const playIcon = button.querySelector("[data-play-icon]");
  const pauseIcon = button.querySelector("[data-pause-icon]");
  playIcon.hidden = playing;
  pauseIcon.hidden = !playing;
  const playLabel = button.getAttribute("data-play-label");
  const pauseLabel = button.getAttribute("data-pause-label");
  button.setAttribute("aria-label", playing ? pauseLabel : playLabel);
};

const playVideo = (video, button, automatic = false) => {
  loadVideo(video);
  video.muted = true;
  video.loop = true;
  if (automatic && !reducedMotion.matches) {
    video.autoplay = true;
    video.setAttribute("autoplay", "");
  }
  video.play().then(() => {
    video.closest("[data-fit-video-wrap]").classList.remove("fit-guide-install-media--playback-blocked");
    setToggleState(video, button, true);
  }).catch(() => {
    video.autoplay = false;
    video.removeAttribute("autoplay");
    video.closest("[data-fit-video-wrap]").classList.add("fit-guide-install-media--playback-blocked");
  });
};

for (const video of videos) {
  const button = video.closest("[data-fit-video-wrap]").querySelector("[data-fit-video-toggle]");
  const label = button.getAttribute("aria-label");
  button.setAttribute("data-play-label", label);
  button.setAttribute("data-pause-label", label.replace(/^Play/, "Pause"));
  button.addEventListener("click", () => {
    if (video.paused) playVideo(video, button);
    else video.pause();
  });
  video.addEventListener("play", () => setToggleState(video, button, true));
  video.addEventListener("pause", () => setToggleState(video, button, false));
  video.addEventListener("error", () => {
    video.closest("[data-fit-video-wrap]").classList.add("fit-guide-install-media--playback-blocked");
  });
}

if ("IntersectionObserver" in window) {
  const sourceObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        loadVideo(entry.target);
        sourceObserver.unobserve(entry.target);
      }
    }
  }, { rootMargin: "240px 0px" });

  const playbackObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target;
      const button = video.closest("[data-fit-video-wrap]").querySelector("[data-fit-video-toggle]");
      if (entry.isIntersecting) {
        visibleVideos.add(video);
        if (!reducedMotion.matches) playVideo(video, button, true);
      } else {
        visibleVideos.delete(video);
        video.autoplay = false;
        video.removeAttribute("autoplay");
        video.pause();
      }
    }
  }, { threshold: 0.15 });

  videos.forEach((video) => {
    sourceObserver.observe(video);
    playbackObserver.observe(video);
  });
} else {
  // Keep posters in place until a user requests playback on older browsers.
  videos.forEach((video) => {
    video.closest("[data-fit-video-wrap]").querySelector("[data-fit-video-toggle]").hidden = false;
  });
}

reducedMotion.addEventListener?.("change", (event) => {
  videos.forEach((video) => {
    const button = video.closest("[data-fit-video-wrap]").querySelector("[data-fit-video-toggle]");
    if (event.matches) {
      video.autoplay = false;
      video.removeAttribute("autoplay");
      video.pause();
    } else if (visibleVideos.has(video)) {
      playVideo(video, button, true);
    }
  });
});

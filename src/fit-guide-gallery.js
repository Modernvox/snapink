import siteImageRenditions from "./config/siteImageRenditions.json";

const gallery = document.querySelector("[data-fit-guide-gallery]");
if (gallery) {
  const image = gallery.querySelector("[data-gallery-image]");
  const stage = gallery.querySelector("[data-gallery-stage]");
  const sizeButtons = [...gallery.querySelectorAll("[data-gallery-size]")];
  const previous = gallery.querySelector("[data-gallery-prev]");
  const next = gallery.querySelector("[data-gallery-next]");
  let current = 0;

  const setSize = (size) => {
    current = (size + 6) % 6;
    const pegLabel = current === 1 ? "1 exposed peg" : `${current} exposed pegs`;
    const rendition = siteImageRenditions[`/images/product_images/snapink-size-${current}.png`];
    image.src = rendition.src;
    image.srcset = rendition.srcset;
    image.sizes = "(max-width: 767px) 88vw, (max-width: 1100px) 60vw, 650px";
    image.width = rendition.width;
    image.height = rendition.height;
    image.alt = `Snapback closure showing Size ${current} with ${pegLabel}; the matching SIZE ${current} label is printed in the photograph`;
    image.fetchPriority = "high";
    image.loading = "eager";
    sizeButtons.forEach((button) => {
      button.setAttribute("aria-current", String(Number(button.dataset.gallerySize) === current));
    });
  };

  sizeButtons.forEach((button) => {
    button.addEventListener("click", () => setSize(Number(button.dataset.gallerySize)));
  });
  previous.addEventListener("click", () => setSize(current - 1));
  next.addEventListener("click", () => setSize(current + 1));
  gallery.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSize(current - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSize(current + 1);
    }
  });

  let touchStartX = 0;
  let touchStartY = 0;
  stage.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });
  stage.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    if (Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      setSize(current + (deltaX < 0 ? 1 : -1));
    }
  }, { passive: true });
}

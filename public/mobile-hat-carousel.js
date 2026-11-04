(() => {
  if (!window.matchMedia("(max-width: 800px)").matches) return;
  const carousel = document.querySelector(".mobile-hat-carousel");
  if (!carousel) return;

  const stage = carousel.querySelector(".mobile-hat-carousel-stage");
  const cards = [...carousel.querySelectorAll("[data-hat-index]")];
  const dots = [...carousel.querySelectorAll("[data-hat-dot]")];
  const label = carousel.querySelector(".mobile-hat-carousel-label");
  const designs = [
    { name: "LIFT", file: "1c9a98ed-aa77-4a0f-ae8a-f072e7505bd4.png" },
    { name: "DAD", file: "5fe103e8-feee-4ba3-9d39-3c0687f9b4db.png" },
    { name: "THREE STAR", file: "6a6b51d6-fa0b-456b-9c6c-582652754df2.png" },
    { name: "APEX", file: "b72f760c-2a8b-41c2-aa95-6c1f7dc640e8.png" },
    { name: "APEX RED", file: "df052df7-3b17-481e-ad8f-6239e1d5f87e.png" },
    { name: "UNC", file: "fe7dd404-197a-4fcc-94c6-d55cc2fe27c5.png" },
  ];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = 0;
  let timer = 0;
  let visible = !("IntersectionObserver" in window);
  let pointerStart = null;
  let suppressClickUntil = 0;

  cards.forEach((card, index) => {
    const design = designs[index];
    const image = document.createElement("img");
    image.src = `/images/carousel/${design.file}`;
    image.alt = `${design.name} SnapInk sleeve on a black snapback hat`;
    image.width = 1333;
    image.height = 1024;
    image.decoding = "async";
    image.loading = index === 0 ? "eager" : "lazy";
    if (index === 0) image.fetchPriority = "high";
    card.append(image);
  });

  function clearTimer() {
    window.clearTimeout(timer);
    timer = 0;
  }

  function scheduleAuto(delay = 3500) {
    clearTimer();
    if (reducedMotion.matches || !visible || document.hidden) return;
    timer = window.setTimeout(() => goTo(active + 1, true), delay);
  }

  function render() {
    cards.forEach((card, index) => {
      const offset = ((index - active + designs.length + designs.length / 2) % designs.length) - designs.length / 2;
      const distance = Math.abs(offset);
      const direction = Math.sign(offset);
      let x = "0vw", y = "0px", z = "-280px", scale = ".34", tilt = "0deg", brightness = ".5", opacity = ".48";
      if (distance === 0) {
        z = "70px"; scale = "1"; brightness = "1"; opacity = "1";
      } else if (distance === 1) {
        x = `${direction * 35}vw`; y = "7px"; z = "-14px"; scale = ".69"; tilt = `${direction * -14}deg`; brightness = ".84"; opacity = ".94";
      } else if (distance === 2) {
        x = `${direction * 51}vw`; y = "10px"; z = "-155px"; scale = ".48"; tilt = `${direction * -27}deg`; brightness = ".66"; opacity = ".78";
      }
      card.style.setProperty("--carousel-x", x);
      card.style.setProperty("--carousel-y", y);
      card.style.setProperty("--carousel-z", z);
      card.style.setProperty("--carousel-scale", scale);
      card.style.setProperty("--carousel-tilt", tilt);
      card.style.setProperty("--carousel-brightness", brightness);
      card.style.setProperty("--carousel-opacity", opacity);
      card.style.zIndex = String(5 - distance);
      card.setAttribute("aria-current", index === active ? "true" : "false");
      card.setAttribute("aria-hidden", distance > 1 ? "true" : "false");
      card.tabIndex = distance > 1 ? -1 : 0;
      card.style.pointerEvents = distance > 1 ? "none" : "auto";
    });

    dots.forEach((dot, index) => {
      dot.setAttribute("aria-current", index === active ? "true" : "false");
      dot.setAttribute("aria-pressed", index === active ? "true" : "false");
    });
  }

  function goTo(index, automatic = false) {
    const next = (index + designs.length) % designs.length;
    if (next !== active) {
      active = next;
      label.classList.add("is-changing");
      window.setTimeout(() => {
        label.textContent = designs[active].name;
        label.classList.remove("is-changing");
      }, 110);
      render();
    }
    if (automatic) scheduleAuto(900 + 3500);
  }

  function pauseForInteraction(index = active) {
    goTo(index);
    scheduleAuto(5000);
  }

  cards.forEach((card, index) => card.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    pauseForInteraction(index);
  }));
  dots.forEach((dot, index) => dot.addEventListener("click", () => pauseForInteraction(index)));

  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  stage.addEventListener("pointerup", (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    suppressClickUntil = performance.now() + 500;
    pauseForInteraction(active + (dx < 0 ? 1 : -1));
  });
  stage.addEventListener("pointercancel", () => { pointerStart = null; });
  carousel.addEventListener("focusin", () => scheduleAuto(5000));

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) scheduleAuto(3500);
      else clearTimer();
    }, { threshold: 0.25 });
    observer.observe(carousel);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimer();
    else scheduleAuto(3500);
  });
  reducedMotion.addEventListener?.("change", () => scheduleAuto(3500));

  render();
  scheduleAuto(3500);
})();

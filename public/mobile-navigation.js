(() => {
  const announcementOnly = document.currentScript?.dataset.announcementOnly === "true";
  const addLaunchAnnouncement = () => {
    if (document.querySelector(".snapink-launch-announcement")) return;
    const path = window.location.pathname.toLowerCase();
    if (["/admin.html", "/partner-portal.html", "/wholesale-studio.html"].includes(path)) return;

    const announcement = document.createElement("div");
    announcement.className = "snapink-launch-announcement";
    announcement.setAttribute("role", "note");
    announcement.textContent = "🚀 LAUNCH SPECIAL — FREE SHIPPING ON ORDERS $36+";

    const shopHeader = document.querySelector(".shop-header");
    if (shopHeader) shopHeader.insertBefore(announcement, shopHeader.firstChild);
    else document.body.insertBefore(announcement, document.body.firstChild);
  };

  const init = () => {
    addLaunchAnnouncement();
    if (announcementOnly) return;
    if (document.querySelector(".snapink-mobile-shell")) return;

    document.querySelectorAll("body > header, .snap-shell > header").forEach((header) => {
      header.classList.add("snapink-desktop-header");
    });

    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const isHome = path === "/" || path.toLowerCase() === "/index.html";
    const isStudio = path.toLowerCase() === "/customize.html";
    const pageKey = isHome ? "home" : path.toLowerCase();
    const rootPrefix = isHome ? "" : "/";
    const links = [
      { label: "Home", href: "/", key: "home" },
      { label: "How It Works", href: `${rootPrefix}#how` },
      { label: "Customization", href: `${rootPrefix}#customization` },
      { label: "Studio", href: "/customize.html", key: "/customize.html" },
      { label: "Fit Guide", href: "/fit-guide.html", key: "/fit-guide.html" },
      { label: "Drop 001", href: "/drop001.html", key: "/drop001.html" },
      { label: "Press", href: "/press.html", key: "/press.html" },
      { label: "Pilot Partners", href: "/pilot.html", key: "/pilot.html" },
      { label: "Wholesale / Partners", href: "/wholesale", key: "/wholesale" },
      { label: "Contact", href: "/contact.html", key: "/contact.html" },
    ];
    const activeKey = pageKey === "/" ? "home" : pageKey;
    const linkMarkup = links.map(({ label, href, key }) => {
      const active = key && key === activeKey;
      return `<a href="${href}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
    }).join("");
    const ctaHref = isStudio ? "#customizer-root" : "/customize.html#customizer-root";

    const shell = document.createElement("div");
    shell.className = "snapink-mobile-shell";
    shell.dataset.open = "false";
    shell.innerHTML = `
      <header class="snapink-mobile-header">
        <div class="snapink-mobile-header__row">
          <a href="/" aria-label="SnapInk home">
            <img class="snapink-mobile-header__logo" src="/images/logos/Futuristic%20White%20SNAPINK%20Logo.png" alt="SnapInk" width="300" height="100" />
          </a>
          <button class="snapink-mobile-header__toggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="snapink-mobile-panel">
            <span></span><span></span><span></span>
          </button>
        </div>
      </header>
      <nav class="snapink-mobile-panel" id="snapink-mobile-panel" aria-label="Mobile navigation" aria-hidden="true" inert>
        ${linkMarkup}
        <a class="snapink-mobile-panel__cta" href="${ctaHref}"${isStudio ? ' aria-current="page"' : ""}>Start Designing</a>
      </nav>`;

    const routeClass = path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    document.body.classList.add(`snapink-page--${routeClass || "home"}`);
    if (path.toLowerCase() === "/partner-portal.html") document.body.classList.add("snapink-page--partner-portal");
    document.body.insertBefore(shell, document.body.firstChild);
    const announcement = document.querySelector(".snapink-launch-announcement");
    if (announcement && !announcement.closest(".shop-header")) document.body.insertBefore(announcement, shell);

    document.querySelectorAll('.snapink-mobile-header__logo, img[alt="SnapInk"], img[alt="SnapInk Logo"]')
      .forEach((logo) => {
        if (logo.closest("footer")) return;
        const lockup = logo.closest("a");
        if (!lockup) return;
        lockup.classList.add("snapink-logo-lockup");
        lockup.setAttribute("aria-label", "SnapInk — Snapback Strap Sleeves home");
        if (!lockup.querySelector(".snapink-brand-tagline")) {
          const tagline = document.createElement("span");
          tagline.className = "snapink-brand-tagline";
          tagline.textContent = "Snapback Strap Sleeves";
          lockup.append(tagline);
        }
        const tagline = lockup.querySelector(".snapink-brand-tagline");
        const syncLogoLockup = () => {
          const logoWidth = logo.getBoundingClientRect().width;
          if (!logoWidth) return;
          lockup.style.width = `${logoWidth}px`;
          tagline.style.width = `${logoWidth * .93}px`;
          tagline.style.fontSize = "9px";
          const availableWidth = tagline.clientWidth;
          const textWidth = tagline.scrollWidth;
          if (textWidth > availableWidth && availableWidth > 0) {
            tagline.style.fontSize = `${Math.max(6, 9 * availableWidth / textWidth)}px`;
          }
        };
        syncLogoLockup();
        logo.addEventListener("load", syncLogoLockup);
        if ("ResizeObserver" in window) new ResizeObserver(syncLogoLockup).observe(logo);
        else window.addEventListener("resize", syncLogoLockup);
      });

    const toggle = shell.querySelector(".snapink-mobile-header__toggle");
    const panel = shell.querySelector(".snapink-mobile-panel");
    const setOpen = (open) => {
      shell.dataset.open = String(open);
      document.body.classList.toggle("snapink-mobile-menu-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
      panel.setAttribute("aria-hidden", String(!open));
      if (open) panel.removeAttribute("inert");
      else panel.setAttribute("inert", "");
    };

    toggle.addEventListener("click", () => setOpen(shell.dataset.open !== "true"));
    panel.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("pointerdown", (event) => {
      if (shell.dataset.open === "true" && !shell.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && shell.dataset.open === "true") {
        setOpen(false);
        toggle.focus();
      }
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 768 && shell.dataset.open === "true") setOpen(false);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();

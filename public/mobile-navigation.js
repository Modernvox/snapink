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

  const syncHeaderLogoLockups = () => {
    document.querySelectorAll('.snapink-mobile-header__logo, img[alt="SnapInk"], img[alt="SnapInk Logo"]')
      .forEach((logo) => {
        if (logo.closest("footer")) return;
        const lockup = logo.closest("a");
        if (!lockup) return;
        lockup.classList.add("snapink-logo-lockup");
        lockup.setAttribute("aria-label", "SnapInk — Snapback Strap Sleeves home");

      });
  };

  const init = () => {
    addLaunchAnnouncement();
    if (announcementOnly) {
      syncHeaderLogoLockups();
      return;
    }
    if (document.querySelector(".snapink-mobile-shell")) return;

    document.querySelectorAll("body > header, .snap-shell > header").forEach((header) => {
      header.classList.add("snapink-desktop-header");
    });

    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const isHome = path === "/" || path.toLowerCase() === "/index.html";
    const isShop = path.toLowerCase() === "/shop" || path.toLowerCase().startsWith("/shop/");
    const isStudio = path.toLowerCase() === "/customize.html";
    const pageKey = isHome ? "home" : isShop ? "/shop" : path.toLowerCase();
    const rootPrefix = isHome ? "" : "/";
    const links = [
      { label: "Home", href: "/", key: "home" },
      { label: "Shop Designs", href: "/shop", key: "/shop" },
      { label: "How It Works", href: `${rootPrefix}#how` },
      { label: "Find Your Fit", href: `${rootPrefix}#fit`, key: "/fit-guide.html" },
      { label: "Create Your Own", href: "/customize.html", key: "/customize.html" },
      { label: "Contact", href: "/contact.html", key: "/contact.html" },
    ];
    const activeKey = pageKey === "/" ? "home" : pageKey;
    const linkMarkup = links.map(({ label, href, key }) => {
      const active = key && key === activeKey;
      const shopClass = key === "/shop" ? ' class="snapink-mobile-panel__shop"' : "";
      return `<a href="${href}"${shopClass}${active ? ' aria-current="page"' : ""}>${label}</a>`;
    }).join("");
    const ctaHref = isStudio ? "#customizer-root" : "/customize.html#customizer-root";

    const shell = document.createElement("div");
    shell.className = "snapink-mobile-shell";
    shell.dataset.open = "false";
    shell.innerHTML = `
      <header class="snapink-mobile-header">
        <div class="snapink-mobile-header__row">
          <button class="snapink-mobile-header__toggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="snapink-mobile-panel">
            <span></span><span></span><span></span>
          </button>
          <a href="/" aria-label="SnapInk home">
            <img class="snapink-mobile-header__logo" src="/images/logos/svg/wordmark_white.svg" alt="SnapInk" width="610" height="992" />
          </a>
          <a class="snapink-mobile-header__bag" href="/shop?bag=open" aria-label="Open shopping bag"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg><span class="snapink-mobile-header__bag-count" aria-live="polite">0</span></a>
        </div>
      </header>
      <nav class="snapink-mobile-panel" id="snapink-mobile-panel" aria-label="Mobile navigation" aria-hidden="true" inert>
        ${linkMarkup}
        <a class="snapink-mobile-panel__cta" href="${ctaHref}"${isStudio ? ' aria-current="page"' : ""}>Design Your Sleeve</a>
      </nav>`;

    const routeClass = path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    document.body.classList.add(`snapink-page--${routeClass || "home"}`);
    if (path.toLowerCase() === "/partner-portal.html") document.body.classList.add("snapink-page--partner-portal");
    document.body.insertBefore(shell, document.body.firstChild);
    const announcement = document.querySelector(".snapink-launch-announcement");
    if (announcement && !announcement.closest(".shop-header")) document.body.insertBefore(announcement, shell);

    syncHeaderLogoLockups();

    const toggle = shell.querySelector(".snapink-mobile-header__toggle");
    const bagCount = shell.querySelector(".snapink-mobile-header__bag-count");
    const syncBagCount = () => {
      try {
        const cart = JSON.parse(localStorage.getItem("snapink-exclusive-shop-cart") || "[]");
        const count = Array.isArray(cart) ? cart.reduce((sum, item) => sum + (Number.isInteger(Number(item?.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : 0), 0) : 0;
        bagCount.textContent = count > 99 ? "99+" : String(count);
        bagCount.hidden = count < 1;
      } catch { bagCount.hidden = true; }
    };
    syncBagCount();
    window.addEventListener("storage", (event) => { if (event.key === "snapink-exclusive-shop-cart") syncBagCount(); });
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

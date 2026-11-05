(() => {
  const shopLink = () => {
    const link = document.createElement("a");
    link.href = "/shop";
    link.textContent = "SHOP";
    link.className = "si-shop-nav-link";
    link.setAttribute("aria-label", "Shop exclusive SnapInk sleeves");
    if (location.pathname.startsWith("/shop")) link.setAttribute("aria-current", "page");
    return link;
  };
  const init = () => {
    document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="/shop-nav.css">');
    const header = document.querySelector("header");
    const navs = [...document.querySelectorAll("header nav")];
    for (const nav of navs) {
      if (nav.querySelector('a[href="/shop"]')) continue;
      const link = shopLink();
      nav.insertBefore(link, nav.firstElementChild);
    }
    if (!navs.length && header && !header.querySelector('a[href="/shop"]')) {
      const link = shopLink();
      link.classList.add("si-shop-nav-standalone");
      header.append(link);
    }
    const footer = document.querySelector("footer");
    if (footer && !footer.querySelector('a[href="/shop"]')) {
      const link = shopLink();
      link.classList.add("si-shop-footer-link");
      const links = footer.querySelector(".footer-inner span:last-child,.footer-inner,.wrap");
      if (links) links.append(document.createTextNode(" · "), link);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();

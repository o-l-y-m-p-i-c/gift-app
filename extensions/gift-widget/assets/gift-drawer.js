/**
 * Gift Drawer Widget — Compact gift budget widget for the theme's cart drawer.
 *
 * Uses the shared gift-core.js runtime (window.giftApp) for:
 *   - cart fetching
 *   - tier/budget calculations
 *   - gift products and cart update events
 *
 * This file handles:
 *   - Finding the theme's cart drawer (block setting, or common markup)
 *   - Mounting a compact widget at the top of the drawer or above its footer
 *   - Progress scale, budget summary, CTA link to the cart page
 *   - Optional 3-4 product preview
 *   - Re-mounting after the theme re-renders the drawer
 */

(function () {
  if (window.giftDrawerInitialized) return;
  window.giftDrawerInitialized = true;

  const G = window.giftApp;
  if (!G) {
    console.error("[Gift Drawer] gift-core.js must be loaded before gift-drawer.js");
    return;
  }

  const esc = G.escapeHtml;

  // Cart drawers in common themes, tried in order when no selector is set.
  const DRAWER_CANDIDATES = [
    "cart-drawer",
    "cart-drawer-component",
    "#CartDrawer",
    "#cart-drawer",
    "#sidebar-cart",
    "#mini-cart",
    "[data-cart-drawer]",
    ".cart-drawer",
    ".drawer--cart",
    ".mini-cart",
  ];
  const CONTENT_CANDIDATES = [
    "cart-drawer-items",
    ".cart-drawer__items",
    ".drawer__content",
    ".drawer__body",
    ".cart-drawer__body",
    ".cart-drawer__content",
    "[data-cart-items]",
  ];
  const FOOTER_CANDIDATES = [
    ".drawer__footer",
    '[slot="footer"]',
    ".cart-drawer__footer",
    ".mini-cart__footer",
    "footer",
  ];

  // ─── State ──────────────────────────────────────────────────

  let sourceContainer = null;
  let mountContainer = null;
  let observer = null;
  let renderDebounce = null;
  let isRendering = false;
  let listening = false;

  // ─── Translations ──────────────────────────────────────────

  let _translations = null;
  function getTranslations() {
    if (!_translations) _translations = G.readTranslations(document.querySelector("[data-gift-drawer-translations]"));
    return _translations;
  }

  function t(key, vars) {
    const tr = getTranslations();
    let str = tr[key];
    if (str == null) return key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
      }
    }
    return str;
  }

  // ─── Settings ──────────────────────────────────────────────

  // Labels from the locale file arrive HTML-escaped by Liquid's `t` filter.
  function getSetting(key, fallback) {
    if (!sourceContainer) return fallback;
    const value = sourceContainer.dataset[key];
    return value ? G.decodeHtml(value) : fallback;
  }

  function getBoolSetting(key, fallback) {
    const val = getSetting(key, "");
    if (val === "true") return true;
    if (val === "false") return false;
    return fallback;
  }

  // ─── Finding the drawer ────────────────────────────────────

  function findSourceContainer() {
    // Prefer the block (inside the drawer section) over the app embed
    return document.querySelector("[data-gift-drawer-widget]:not([data-gift-embed-mode])") ||
      document.querySelector("[data-gift-drawer-widget]");
  }

  function firstMatch(root, selectors) {
    for (const selector of selectors) {
      try {
        const el = root.querySelector(selector);
        if (el) return el;
      } catch {
        // Invalid merchant selector — skip it
      }
    }
    return null;
  }

  function findDrawer() {
    const custom = getSetting("drawerSelector", "");
    return firstMatch(document, custom ? [custom] : DRAWER_CANDIDATES);
  }

  // ─── Checkout redirect ─────────────────────────────────────
  // Optional: the drawer's checkout button opens the cart page instead, so
  // customers see the gift selector before checking out.
  function handleCheckoutClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const container = sourceContainer || findSourceContainer();
    if (!container || container.dataset.redirectCheckout !== "true") return;

    const drawer = findDrawer();
    const checkoutButton = target.closest('[name="checkout"], a[href*="/checkout"]');
    if (!drawer || !checkoutButton || !drawer.contains(checkoutButton)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.href = G.storefrontUrl("cart");
  }

  // ─── Mounting ──────────────────────────────────────────────

  function ensureMounted() {
    if (mountContainer && document.contains(mountContainer)) return true;

    sourceContainer = findSourceContainer();
    if (!sourceContainer) return false;

    const drawer = findDrawer();
    if (!drawer) return false;

    // A drawer block rendered inside the drawer is used in place.
    if (!sourceContainer.hasAttribute("data-gift-embed-mode") && drawer.contains(sourceContainer)) {
      mountContainer = sourceContainer;
      mountContainer.classList.add("gift-drawer-widget");
      mountContainer.style.display = "";
      return true;
    }

    mountContainer = document.createElement("div");
    mountContainer.className = "gift-drawer-widget";
    mountContainer.setAttribute("data-gift-drawer-mounted", "");
    for (const attr of sourceContainer.attributes) {
      if (attr.name.startsWith("data-") && attr.name !== "data-gift-embed-mode") {
        mountContainer.setAttribute(attr.name, attr.value);
      }
    }
    mountContainer.removeAttribute("data-gift-drawer-widget");
    mountContainer.setAttribute("style", sourceContainer.getAttribute("style") || "");
    mountContainer.style.display = "";

    const content = firstMatch(drawer, CONTENT_CANDIDATES);
    const footer = firstMatch(drawer, FOOTER_CANDIDATES);
    const position = getSetting("drawerPosition", "top");

    if (position === "bottom" && footer) {
      footer.before(mountContainer);
    } else if (content) {
      content.prepend(mountContainer);
    } else if (footer) {
      footer.before(mountContainer);
    } else {
      drawer.appendChild(mountContainer);
    }

    return true;
  }

  function setupDrawerObserver() {
    if (observer) observer.disconnect();
    const drawer = findDrawer();
    if (!drawer || typeof MutationObserver === "undefined") return;

    observer = new MutationObserver(() => {
      if (mountContainer && document.contains(mountContainer)) return;
      scheduleRender(200);
    });
    observer.observe(drawer, { childList: true, subtree: true });
  }

  // ─── Rendering ─────────────────────────────────────────────

  function formatLabel(template, replacements) {
    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
      // Support both [key] (merchant-entered) and {{ key }} (locale file) formats
      result = result.replace(new RegExp(`\\[${key}\\]`, "g"), value);
      result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value);
    }
    return result;
  }

  function scrollScaleToCurrent(container, tiers, thresholdBase, stepWidth) {
    const scrollEl = container.querySelector("[data-gift-scale-scroll]");
    if (!scrollEl) return;

    let currentIdx = 0;
    for (let i = 0; i < tiers.length; i++) {
      if (thresholdBase >= tiers[i].minAmount) {
        currentIdx = i;
      } else {
        break;
      }
    }

    const targetX = currentIdx * stepWidth - scrollEl.clientWidth / 2 + stepWidth / 2;
    scrollEl.scrollTo({ left: Math.max(0, targetX), behavior: "smooth" });
  }

  async function render() {
    if (isRendering) return;
    if (!ensureMounted()) return;
    isRendering = true;
    setupDrawerObserver();

    try {
      await G.ensureConfig();
      const cart = await G.fetchCart();

      const state = G.computeCartState(cart);
      const { activeTier, thresholdBase, remainingBudget, totalGiftValue, giftSelectionCount } = state;
      const tiers = G.getTiers();

      if (!tiers || tiers.length === 0) {
        mountContainer.innerHTML = "";
        return;
      }

      // ── Scrollable scale: each tier is a fixed-width column ──
      const STEP_WIDTH = 88; // px per tier column
      const totalWidth = tiers.length * STEP_WIDTH;
      const usableStart = STEP_WIDTH / 2;
      const usableRange = totalWidth - STEP_WIDTH;
      const activeIdx = activeTier ? tiers.findIndex((tier) => tier.id === activeTier.id) : -1;
      const fillPx = Math.max(0, activeIdx * STEP_WIDTH);

      const tierSteps = tiers.map((tier, i) => {
        const isUnlocked = thresholdBase >= tier.minAmount;
        const isCurrent = activeTier && activeTier.id === tier.id;
        const stepClass = isCurrent
          ? "gift-drawer-widget__scale-step--current"
          : isUnlocked
            ? "gift-drawer-widget__scale-step--unlocked"
            : "";
        return `
          <div class="gift-drawer-widget__scale-step ${stepClass}" data-tier-idx="${i}">
            <div class="gift-drawer-widget__scale-dot"></div>
            <div class="gift-drawer-widget__scale-amount">${esc(G.formatPrice(tier.minAmount))}</div>
            <div class="gift-drawer-widget__scale-bonus">${esc(G.formatPrice(tier.giftAmount))}</div>
          </div>
        `;
      }).join("");

      let html = '<div class="gift-drawer-widget__inner">';
      html += `<p class="gift-drawer-widget__promo-title">${esc(t("promo_title"))}</p>`;

      const summary = activeTier
        ? formatLabel(getSetting("labelUnlocked", t("label_unlocked")), { budget: G.formatPrice(activeTier.giftAmount) })
        : formatLabel(getSetting("labelUnlock", t("label_unlock")), {
          amount: G.formatPrice(Math.max(0, tiers[0].minAmount - thresholdBase)),
        });
      html += `
        <div class="gift-drawer-widget__summary">
          <p class="gift-drawer-widget__text">${esc(summary)}</p>
        </div>
      `;

      html += `
        <div class="gift-drawer-widget__scale-scroll" data-gift-scale-scroll>
          <div class="gift-drawer-widget__scale-track" style="min-width:${totalWidth}px">
            <div class="gift-drawer-widget__scale-steps">
              <div class="gift-drawer-widget__scale-line" style="left:${usableStart}px;width:${usableRange}px">
                <div class="gift-drawer-widget__scale-line-fill" style="width:${fillPx}px"></div>
              </div>
              ${tierSteps}
            </div>
          </div>
        </div>
      `;

      if (activeTier) {
        if (totalGiftValue > 0 && remainingBudget > 0) {
          const usedLabel = formatLabel(getSetting("labelUsed", t("label_used")), {
            amount: G.formatPrice(totalGiftValue),
            remaining: G.formatPrice(remainingBudget),
          });
          html += `<p class="gift-drawer-widget__budget">${esc(usedLabel)}</p>`;
        } else if (totalGiftValue > 0 && remainingBudget <= 0) {
          html += `<h2 class="gift-drawer-widget__budget--full">${esc(getSetting("labelFull", t("label_full")))}</h2>`;
        } else if (getBoolSetting("showRemaining", true)) {
          html += `<p class="gift-drawer-widget__budget">${esc(t("remaining", { amount: G.formatPrice(remainingBudget) }))}</p>`;
        }

        let ctaLabel;
        if (remainingBudget > 0 && giftSelectionCount === 0) {
          ctaLabel = getSetting("ctaChoose", t("cta_choose"));
        } else if (remainingBudget > 0 && giftSelectionCount > 0) {
          ctaLabel = getSetting("ctaMore", t("cta_more"));
        } else {
          ctaLabel = getSetting("ctaManage", t("cta_manage"));
        }
        html += `<a href="${esc(G.storefrontUrl("cart"))}" class="gift-drawer-widget__cta">${esc(ctaLabel)}</a>`;

        const previewCount = parseInt(getSetting("productPreview", "disabled"), 10);
        if (previewCount > 0 && remainingBudget > 0) {
          html += await renderProductPreview(cart, remainingBudget, previewCount);
        }
      }

      html += `<p class="gift-drawer-widget__footnote">${esc(t("footnote"))}</p>`;
      html += "</div>";
      mountContainer.innerHTML = html;

      scrollScaleToCurrent(mountContainer, tiers, thresholdBase, STEP_WIDTH);
    } catch (e) {
      console.error("[Gift Drawer] Render failed:", e);
      if (mountContainer) mountContainer.innerHTML = "";
    } finally {
      isRendering = false;
    }
  }

  async function renderProductPreview(cart, remainingBudget, maxCount) {
    const excludeIds = new Set(
      cart.items
        .filter((item) => !item.properties?.[G.GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id)),
    );

    let products = [];
    try {
      products = (await G.fetchGiftProducts(remainingBudget, excludeIds, maxCount)).slice(0, maxCount);
    } catch (e) {
      console.warn("[Gift Drawer] Product preview fetch failed:", e);
      return "";
    }
    if (products.length === 0) return "";

    const cartUrl = esc(G.storefrontUrl("cart"));
    const cards = products.map((p) => `
      <a href="${cartUrl}" class="gift-drawer-widget__product" data-variant-id="${esc(p.variantId)}">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" class="gift-drawer-widget__product-image" loading="lazy" />` : ""}
        <div class="gift-drawer-widget__product-info">
          <p class="gift-drawer-widget__product-name">${esc(p.title)}</p>
          <p class="gift-drawer-widget__product-price">${esc(G.formatPrice(p.price))}</p>
        </div>
      </a>
    `).join("");

    return `
      <div class="gift-drawer-widget__products">
        <p class="gift-drawer-widget__products-label">${esc(t("available_gifts"))}</p>
        <div class="gift-drawer-widget__products-grid">${cards}</div>
      </div>
    `;
  }

  // ─── Cart update listener ──────────────────────────────────

  function scheduleRender(delay = 300) {
    if (renderDebounce) clearTimeout(renderDebounce);
    renderDebounce = setTimeout(() => {
      renderDebounce = null;
      render();
    }, delay);
  }

  function listenForCartUpdates() {
    if (listening) return;
    listening = true;
    G.onCartUpdate(() => scheduleRender(150));
    G.onCartMutation(() => scheduleRender(300));
    ["cart:updated", "cart:refresh", "cart:change", "cart-update", "cart-drawer:open", "cart:open"].forEach(
      (eventName) => {
        document.addEventListener(eventName, () => {
          if (!G.isRefreshing()) scheduleRender(300);
        });
      },
    );
  }

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    sourceContainer = findSourceContainer();
    if (!sourceContainer) return;

    try {
      await G.ensureConfig();
    } catch (error) {
      console.warn("[Gift Drawer] Config load failed:", error);
    }

    if (!G.getSettings().active) {
      sourceContainer.remove();
      mountContainer?.remove();
      return;
    }

    listenForCartUpdates();
    if (ensureMounted()) {
      render();
      return;
    }

    // Some themes add the drawer to the page later (on first open).
    if (typeof MutationObserver !== "undefined") {
      const bodyObserver = new MutationObserver(() => {
        if (ensureMounted()) {
          bodyObserver.disconnect();
          render();
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => bodyObserver.disconnect(), 30000);
    }
  }

  window.giftDrawer = { render, init };

  // Delegated, capture-phase listener so it survives drawer re-renders.
  document.addEventListener("click", handleCheckoutClick, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

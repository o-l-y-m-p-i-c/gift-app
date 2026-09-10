/**
 * Gift Drawer Widget — Compact gift budget widget for the Dawn cart drawer.
 *
 * Uses the shared gift-core.js runtime (window.giftApp) for:
 *   - cart fetching
 *   - tier/budget calculations
 *   - cart update events
 *
 * This file handles:
 *   - Mounting a compact widget before .drawer__footer
 *   - Progress bar to first/next tier
 *   - Budget summary (used / remaining)
 *   - CTA link to /cart
 *   - Optional 3-4 product preview
 *   - Re-mounting after Dawn section replacement
 */

(function () {
  if (window.giftDrawerInitialized) return;
  window.giftDrawerInitialized = true;

  const G = window.giftApp;
  if (!G) {
    console.error("[Gift Drawer] gift-core.js must be loaded before gift-drawer.js");
    return;
  }

  // ─── State ──────────────────────────────────────────────────

  let sourceContainer = null;
  let mountContainer = null;
  let observer = null;
  let renderDebounce = null;
  let isRendering = false;
  let lastCart = null;

  // ─── Translations ──────────────────────────────────────────

  let _translations = null;
  function getTranslations() {
    if (_translations) return _translations;
    try {
      const el = document.querySelector("[data-gift-drawer-translations]");
      if (el) _translations = JSON.parse(el.textContent);
    } catch (e) {
      console.warn("[Gift Drawer] Failed to parse translations:", e);
    }
    if (!_translations) _translations = {};
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

  function getSetting(key, fallback) {
    if (!sourceContainer) return fallback;
    return sourceContainer.dataset[key] ?? fallback;
  }

  function getBoolSetting(key, fallback) {
    const val = getSetting(key, "");
    if (val === "true") return true;
    if (val === "false") return false;
    return fallback;
  }

  // ─── Checkout redirect ─────────────────────────────────────
  // Delegated capture-phase listener: survives Prestige drawer DOM replacement.
  // When the merchant toggle "redirect_checkout" is enabled, clicking the
  // cart-drawer checkout button navigates to /cart instead of submitting.
  function handleCheckoutClick(event) {
    const target = event.target;
    if (!target || !target.closest) return;

    const checkoutButton = target.closest('cart-drawer button[name="checkout"], cart-drawer [name="checkout"]');
    if (!checkoutButton) return;

    const container = sourceContainer || findSourceContainer();
    if (!container) return;

    const enabled = container.dataset.redirectCheckout;
    if (enabled !== "true") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.href = "/cart";
  }

  // ─── Mounting ──────────────────────────────────────────────

  function findSourceContainer() {
    // Prefer the block container (inside cart drawer section) over embed
    const blockContainer = document.querySelector("[data-gift-drawer-widget]:not([data-gift-embed-mode])");
    if (blockContainer) return blockContainer;
    // Fall back to embed container (hidden, injected globally)
    return document.querySelector("[data-gift-drawer-widget]");
  }

  function findDrawerFooter() {
    // Dawn: cart-drawer .drawer__footer
    // Prestige: cart-drawer [slot="footer"]
    return document.querySelector("cart-drawer .drawer__footer") ||
           document.querySelector('cart-drawer [slot="footer"]');
  }

  function ensureMounted() {
    // If the mount container already exists in the DOM, keep it
    if (mountContainer && document.contains(mountContainer)) return true;

    sourceContainer = findSourceContainer();
    if (!sourceContainer) return false;

    const footer = findDrawerFooter();
    if (!footer) {
      // Drawer not present on this page
      return false;
    }

    // Create the mount container
    mountContainer = document.createElement("div");
    mountContainer.className = "gift-drawer-widget";
    mountContainer.setAttribute("data-gift-drawer-mounted", "");

    // Insert before the footer
    footer.before(mountContainer);

    // Copy settings from source container
    for (const attr of sourceContainer.attributes) {
      if (attr.name.startsWith("data-")) {
        mountContainer.setAttribute(attr.name, attr.value);
      }
    }

    return true;
  }

  function setupSectionObserver() {
    if (observer) observer.disconnect();

    const drawer = document.querySelector("cart-drawer");
    if (!drawer) return;

    observer = new MutationObserver(() => {
      if (renderDebounce) clearTimeout(renderDebounce);
      renderDebounce = setTimeout(async () => {
        renderDebounce = null;
        // Re-mount if the container was removed by section replacement
        if (!mountContainer || !document.contains(mountContainer)) {
          if (ensureMounted()) {
            await render();
          }
        }
      }, 200);
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

  function renderLoading() {
    if (!mountContainer) return;
    mountContainer.innerHTML = `
      <div class="gift-drawer-widget__loading">
        <div class="gift-drawer-widget__spinner"></div>
      </div>
    `;
  }

  function renderEmpty() {
    if (!mountContainer) return;
    mountContainer.innerHTML = "";
  }

  // ─── Scale auto-scroll ──────────────────────────────────────
  function scrollScaleToCurrent(container, tiers, thresholdBase, stepWidth) {
    const scrollEl = container.querySelector("[data-gift-scale-scroll]");
    if (!scrollEl) return;

    // Find the index of the current or next tier
    let currentIdx = 0;
    for (let i = 0; i < tiers.length; i++) {
      if (thresholdBase >= tiers[i].minAmount) {
        currentIdx = i;
      } else {
        break;
      }
    }

    // Center the current tier in the scroll viewport
    const targetX = currentIdx * stepWidth - scrollEl.clientWidth / 2 + stepWidth / 2;
    scrollEl.scrollTo({
      left: Math.max(0, targetX),
      behavior: "smooth",
    });
  }

  async function render() {
    if (isRendering) return;
    if (!ensureMounted()) return;
    isRendering = true;

    try {
      await G.ensureConfig();
      const cart = await G.fetchCart();
      lastCart = cart;

      const state = G.computeCartState(cart);
      const { activeTier, nextTier, thresholdBase, remainingBudget, totalGiftValue, giftSelectionCount } = state;
      const tiers = G.getTiers();

      // No tiers configured → hide widget
      if (!tiers || tiers.length === 0) {
        renderEmpty();
        return;
      }

      // ── Scrollable scale: each tier is a fixed-width column ──
      const scaleMax = tiers[tiers.length - 1].minAmount;
      const STEP_WIDTH = 88; // px per tier column
      const totalWidth = tiers.length * STEP_WIDTH;
      const currentPct = Math.min(100, Math.max(0, (thresholdBase / scaleMax) * 100));

      // Build tier columns
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
            <div class="gift-drawer-widget__scale-amount">${G.formatPrice(tier.minAmount)}</div>
            <div class="gift-drawer-widget__scale-bonus">${G.formatPrice(tier.giftAmount)}</div>
          </div>
        `;
      }).join("");

      // ── Build HTML ──
      let html = '<div class="gift-drawer-widget__inner">';

      // Summary text
      if (!activeTier) {
        const firstTier = tiers[0];
        const amountToFirst = Math.max(0, firstTier.minAmount - thresholdBase);
        const unlockLabel = formatLabel(
          getSetting("labelUnlock", "Add [amount] more to unlock bonus balance"),
          { amount: G.formatPrice(amountToFirst) },
        );
        html += `
          <div class="gift-drawer-widget__summary">
            <p class="gift-drawer-widget__text">${unlockLabel}</p>
          </div>
        `;
      } else {
        const unlockedLabel = formatLabel(
          getSetting("labelUnlocked", "You unlocked [budget] in bonus balance"),
          { budget: G.formatPrice(activeTier.giftAmount) },
        );
        html += `
          <div class="gift-drawer-widget__summary">
            <p class="gift-drawer-widget__text">${unlockedLabel}</p>
          </div>
        `;
      }

      // Scrollable scale
      html += `
        <div class="gift-drawer-widget__scale-scroll" data-gift-scale-scroll>
          <div class="gift-drawer-widget__scale-track" style="min-width:${totalWidth}px">
            <div class="gift-drawer-widget__scale-line">
              <div class="gift-drawer-widget__scale-line-fill" style="width:${currentPct}%"></div>
            </div>
            <div class="gift-drawer-widget__scale-steps">${tierSteps}</div>
          </div>
        </div>
      `;

      // Budget usage (only when a tier is active)
      if (activeTier) {
        const showRemaining = getBoolSetting("showRemaining", true);
        if (totalGiftValue > 0 && remainingBudget > 0) {
          const usedLabel = formatLabel(
            getSetting("labelUsed", "Used [amount] · Remaining [remaining]"),
            {
              amount: G.formatPrice(totalGiftValue),
              remaining: G.formatPrice(remainingBudget),
            },
          );
          html += `<p class="gift-drawer-widget__budget">${usedLabel}</p>`;
        } else if (totalGiftValue > 0 && remainingBudget <= 0) {
          const fullLabel = getSetting("labelFull", "Your bonus balance is fully used");
          html += `<p class="gift-drawer-widget__budget gift-drawer-widget__budget--full">${fullLabel}</p>`;
        } else if (showRemaining) {
          html += `<p class="gift-drawer-widget__budget">${t("remaining", { amount: G.formatPrice(remainingBudget) })}</p>`;
        }

        // CTA
        let ctaLabel;
        if (remainingBudget > 0 && giftSelectionCount === 0) {
          ctaLabel = getSetting("ctaChoose", "Choose your products");
        } else if (remainingBudget > 0 && giftSelectionCount > 0) {
          ctaLabel = getSetting("ctaMore", "Choose more products");
        } else {
          ctaLabel = getSetting("ctaManage", "Manage selections");
        }

        html += `
          <a href="/cart" class="gift-drawer-widget__cta">
            ${ctaLabel}
          </a>
        `;

        // Optional product preview
        const previewSetting = getSetting("productPreview", "disabled");
        const previewCount = parseInt(previewSetting, 10);
        if (previewCount > 0 && remainingBudget > 0) {
          html += await renderProductPreview(cart, remainingBudget, previewCount);
        }
      }

      html += "</div>";
      mountContainer.innerHTML = html;

      // Auto-scroll scale to current position
      scrollScaleToCurrent(mountContainer, tiers, thresholdBase, STEP_WIDTH);
    } catch (e) {
      console.error("[Gift Drawer] Render failed:", e);
      if (mountContainer) {
        mountContainer.innerHTML = "";
      }
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
      const allProducts = await fetchGiftProducts(remainingBudget, excludeIds);
      products = allProducts.slice(0, maxCount);
    } catch (e) {
      console.warn("[Gift Drawer] Product preview fetch failed:", e);
      return "";
    }

    if (products.length === 0) return "";

    const cards = products
      .map(
        (p) => `
        <a href="/cart" class="gift-drawer-widget__product" data-variant-id="${p.variantId}">
          <img src="${p.image}" alt="${p.title}" class="gift-drawer-widget__product-image" loading="lazy" />
          <div class="gift-drawer-widget__product-info">
            <p class="gift-drawer-widget__product-name">${p.title}</p>
            <p class="gift-drawer-widget__product-price">${G.formatPrice(p.price)}</p>
          </div>
        </a>
      `,
      )
      .join("");

    return `
      <div class="gift-drawer-widget__products">
        <p class="gift-drawer-widget__products-label">${t("available_gifts")}</p>
        <div class="gift-drawer-widget__products-grid">${cards}</div>
      </div>
    `;
  }

  // ─── Product fetch (shared logic) ──────────────────────────

  async function fetchGiftProducts(maxPrice, excludeVariantIds = new Set()) {
    const appUrl = "/apps/gift-threshold";
    try {
      const res = await fetch(
        `${appUrl}/products?maxPrice=${maxPrice}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.products || []).filter(
        (p) => !excludeVariantIds.has(String(p.variantId)),
      );
    } catch (e) {
      console.warn("[Gift Drawer] API products fetch failed, falling back to /products.json:", e);
      // Fallback to storefront endpoint (no exclusion filtering)
      const allProducts = [];
      let page = 1;
      const perPage = 250;
      while (page <= 4) {
        const res = await fetch(`/products.json?limit=${perPage}&page=${page}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) break;
        const data = await res.json();
        const products = data.products || [];
        if (products.length === 0) break;
        allProducts.push(...products);
        if (products.length < perPage) break;
        page++;
      }

      const result = [];
      for (const product of allProducts) {
        for (const variant of product.variants || []) {
          if (!variant.available) continue;
          if (excludeVariantIds.has(String(variant.id))) continue;
          if (variant.price > maxPrice) continue;
          result.push({
            variantId: String(variant.id),
            title: product.title,
            price: variant.price,
            image: product.image?.src || "",
          });
        }
      }
      return result;
    }
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
    // Subscribe to gift-core cart updates
    G.onCartUpdate(() => scheduleRender(300));

    // Listen for Dawn and custom cart events
    [
      "cart:updated", "cart:refresh", "cart:change",
      "cart-update", "quantity-update",
    ].forEach((eventName) => {
      window.addEventListener(eventName, () => scheduleRender(300));
    });
  }

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    sourceContainer = findSourceContainer();
    if (!sourceContainer) return;

    // Wait for the drawer to be available
    if (!ensureMounted()) {
      // Drawer might not be in the DOM yet — retry on first cart interaction
      // or when the drawer opens
      const retryInit = () => {
        if (ensureMounted()) {
          setupSectionObserver();
          listenForCartUpdates();
          render();
          document.removeEventListener("cart:updated", retryInit);
        }
      };
      window.addEventListener("cart:updated", retryInit);
      // Also try on DOMContentLoaded if it hasn't fired yet
      if (document.readyState !== "loading") {
        setTimeout(() => {
          if (ensureMounted()) {
            setupSectionObserver();
            listenForCartUpdates();
            render();
          }
        }, 500);
      }
      return;
    }

    setupSectionObserver();
    listenForCartUpdates();
    render();
  }

  // Public API for re-init after section replacement
  window.giftDrawer = { render, init };

  // Delegated checkout interception — registered once on document (capture phase)
  // so it survives Prestige replacing cart-drawer innerHTML on cart updates.
  document.addEventListener("click", handleCheckoutClick, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

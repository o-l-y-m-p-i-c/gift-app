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

  // ─── Mounting ──────────────────────────────────────────────

  function findSourceContainer() {
    return document.querySelector("[data-gift-drawer-widget]");
  }

  function findDrawerFooter() {
    return document.querySelector("cart-drawer .drawer__footer");
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
      result = result.replace(`[${key}]`, value);
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

      // ── Progress bar ──
      let progressPct = 0;
      let progressMax = 0;

      if (!activeTier) {
        const firstTier = tiers[0];
        progressMax = firstTier.minAmount;
        progressPct = Math.min(100, Math.max(0, (thresholdBase / firstTier.minAmount) * 100));
      } else if (nextTier) {
        progressMax = nextTier.minAmount;
        progressPct = Math.min(100, Math.max(0, (thresholdBase / nextTier.minAmount) * 100));
      } else {
        progressPct = 100;
      }

      // ── Build HTML ──
      let html = '<div class="gift-drawer-widget__inner">';

      // Progress section
      if (!activeTier) {
        const firstTier = tiers[0];
        const amountToFirst = Math.max(0, firstTier.minAmount - thresholdBase);
        const unlockLabel = formatLabel(
          getSetting("labelUnlock", "Add [amount] more to unlock free gifts"),
          { amount: G.formatPrice(amountToFirst) },
        );
        html += `
          <div class="gift-drawer-widget__summary">
            <p class="gift-drawer-widget__text">${unlockLabel}</p>
          </div>
          <div class="gift-drawer-widget__progress" role="progressbar"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progressPct)}">
            <div class="gift-drawer-widget__progress-fill" style="width:${progressPct}%"></div>
          </div>
        `;
      } else {
        const unlockedLabel = formatLabel(
          getSetting("labelUnlocked", "You unlocked [budget] in free gifts"),
          { budget: G.formatPrice(activeTier.giftAmount) },
        );

        html += `
          <div class="gift-drawer-widget__summary">
            <p class="gift-drawer-widget__text">${unlockedLabel}</p>
          </div>
          <div class="gift-drawer-widget__progress" role="progressbar"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progressPct)}">
            <div class="gift-drawer-widget__progress-fill" style="width:${progressPct}%"></div>
          </div>
        `;

        // Budget usage
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
          const fullLabel = getSetting("labelFull", "Your gift budget is fully used");
          html += `<p class="gift-drawer-widget__budget gift-drawer-widget__budget--full">${fullLabel}</p>`;
        } else if (showRemaining) {
          html += `<p class="gift-drawer-widget__budget">${G.formatPrice(remainingBudget)} remaining</p>`;
        }

        // CTA
        let ctaLabel;
        if (remainingBudget > 0 && giftSelectionCount === 0) {
          ctaLabel = getSetting("ctaChoose", "Choose your gifts");
        } else if (remainingBudget > 0 && giftSelectionCount > 0) {
          ctaLabel = getSetting("ctaMore", "Choose more gifts");
        } else {
          ctaLabel = getSetting("ctaManage", "Manage gifts");
        }

        html += `
          <a href="/cart" class="gift-drawer-widget__cta button button--secondary button--full-width">
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
        <p class="gift-drawer-widget__products-label">Available gifts</p>
        <div class="gift-drawer-widget__products-grid">${cards}</div>
      </div>
    `;
  }

  // ─── Product fetch (shared logic) ──────────────────────────

  async function fetchGiftProducts(maxPrice, excludeVariantIds = new Set()) {
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

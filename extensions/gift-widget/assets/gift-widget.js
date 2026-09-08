/**
 * Gift Widget — Cart page logic.
 *
 * 1. Reads cart total from the page
 * 2. Fetches active tiers from app backend
 * 3. Determines the active threshold
 * 4. Fetches eligible gift products via Storefront API
 * 5. Renders gift carousel
 * 6. Handles gift selection (add to cart with _gift property)
 * 7. Listens for cart updates (promo codes, item changes)
 * 8. Auto-removes gift if threshold drops
 */

(function () {
  if (window.giftWidgetInitialized) return;
  window.giftWidgetInitialized = true;

  const GIFT_PROPERTY_KEY = "_gift";
  const GIFT_PROPERTY_VALUE = "true";

  let tiers = [];
  let settings = {
    useTotalAfterDiscounts: true,
    showLevelUpNotification: true,
    showRemovalNotification: true,
  };
  let lastThresholdBase = 0;
  let lastActiveTierId = null;
  let giftProducts = [];

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    const container = document.getElementById("gift-widget-container");
    if (!container) return;

    const shopDomain = container.dataset.shop;
    const appUrl = getAppUrl();

    // Fetch tiers and settings from app backend
    try {
      const [tiersData, settingsData] = await Promise.all([
        fetchJson(`${appUrl}/tiers?shop=${shopDomain}`),
        fetchJson(`${appUrl}/settings?shop=${shopDomain}`),
      ]);

      tiers = tiersData.tiers || [];
      settings = settingsData.settings || settings;
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch config:", e);
      container.innerHTML = `<div class="gift-widget"><p class="gift-widget__subtitle">Gift configuration is temporarily unavailable.</p></div>`;
      return;
    }

    // Initial render
    const cart = await fetchCart();
    await onCartUpdate(cart);

    // Listen for cart updates
    listenForCartUpdates();
  }

  // ─── Cart logic ────────────────────────────────────────────

  async function fetchCart() {
    const res = await fetch("/cart.js");
    return res.json();
  }

  function getThresholdBase(cart) {
    const giftItem = cart.items.find(
      (item) => item.properties && item.properties[GIFT_PROPERTY_KEY],
    );
    const giftPrice = giftItem ? giftItem.final_line_price : 0;

    const base = settings.useTotalAfterDiscounts
      ? cart.total_price // after discounts/promo codes
      : cart.items_subtotal_price; // before discounts

    return base - giftPrice; // always exclude gift from calculation
  }

  function findActiveTier(thresholdBase) {
    const active = tiers
      .filter((t) => t.minAmount <= thresholdBase)
      .sort((a, b) => b.minAmount - a.minAmount);
    return active[0] || null;
  }

  function hasGiftInCart(cart) {
    return cart.items.some(
      (item) => item.properties && item.properties[GIFT_PROPERTY_KEY],
    );
  }

  function getGiftItem(cart) {
    return cart.items.find(
      (item) => item.properties && item.properties[GIFT_PROPERTY_KEY],
    );
  }

  // ─── Cart update handler ───────────────────────────────────

  async function onCartUpdate(cart) {
    const thresholdBase = getThresholdBase(cart);
    const activeTier = findActiveTier(thresholdBase);
    const maxGiftPrice = activeTier ? activeTier.giftAmount : 0;

    // Check for threshold changes
    const tierChanged = activeTier?.id !== lastActiveTierId;
    const thresholdChanged = thresholdBase !== lastThresholdBase;

    if (thresholdChanged || tierChanged) {
      lastThresholdBase = thresholdBase;
      lastActiveTierId = activeTier?.id ?? null;
    }

    // No active tier → remove gift if present, hide widget
    if (!activeTier) {
      if (hasGiftInCart(cart)) {
        await removeGiftFromCart(cart);
        if (settings.showRemovalNotification) {
          showNotification("Your cart no longer qualifies for a free gift.", "warning");
        }
      }
      renderEmpty();
      return;
    }

    // Gift in cart but exceeds new max → remove and re-render
    if (hasGiftInCart(cart)) {
      const giftItem = getGiftItem(cart);
      if (giftItem && giftItem.price > maxGiftPrice) {
        await removeGiftFromCart(cart);
        if (settings.showRemovalNotification) {
          showNotification("Your gift was removed. Please choose a new gift.", "info");
        }
        const freshCart = await fetchCart();
        await renderWidget(freshCart, activeTier, maxGiftPrice);
        return;
      }
      // Gift still valid → just show "gift selected" state
      renderGiftSelected(giftItem, activeTier);
      return;
    }

    // Tier upgraded → notification
    if (tierChanged && lastActiveTierId !== null && settings.showLevelUpNotification) {
      showNotification(
        `🎉 New gift tier unlocked! Choose a gift up to ${formatPrice(maxGiftPrice)}`,
        "success",
      );
    }

    // Render gift selection
    await renderWidget(cart, activeTier, maxGiftPrice);
  }

  // ─── Rendering ─────────────────────────────────────────────

  async function renderWidget(cart, tier, maxGiftPrice) {
    const container = document.getElementById("gift-widget-container");
    if (!container) return;

    // Fetch eligible products
    const products = await fetchGiftProducts(maxGiftPrice);
    giftProducts = products;

    if (products.length === 0) {
      container.innerHTML = `
        <div class="gift-widget">
          <div class="gift-widget__header">
            <span class="gift-widget__icon">🎁</span>
            <h3 class="gift-widget__title">Free Gift Available!</h3>
          </div>
          <p class="gift-widget__subtitle">
            You qualify for a free gift up to ${formatPrice(maxGiftPrice)},
            but no eligible products were found.
          </p>
        </div>
      `;
      return;
    }

    const productCards = products
      .map(
        (p) => `
        <div class="gift-widget__card" data-variant-id="${p.variantId}" data-product-title="${p.title}">
          <img src="${p.image}" alt="${p.title}" class="gift-widget__image" loading="lazy" />
          <div class="gift-widget__info">
            <p class="gift-widget__name">${p.title}</p>
            <p class="gift-widget__price">${formatPrice(p.price)}</p>
          </div>
          <button class="gift-widget__select" onclick="window.giftWidget.selectGift('${p.variantId}', '${p.title.replace(/'/g, "\\'")}')">
            Select
          </button>
        </div>
      `,
      )
      .join("");

    container.innerHTML = `
      <div class="gift-widget">
        <div class="gift-widget__header">
          <span class="gift-widget__icon">🎁</span>
          <div>
            <h3 class="gift-widget__title">Free Gift Available!</h3>
            <p class="gift-widget__subtitle">
              You can choose a free gift up to ${formatPrice(maxGiftPrice)}
            </p>
          </div>
        </div>
        <div class="gift-widget__carousel">
          ${productCards}
        </div>
      </div>
    `;
  }

  function renderGiftSelected(giftItem, tier) {
    const container = document.getElementById("gift-widget-container");
    if (!container) return;

    container.innerHTML = `
      <div class="gift-widget gift-widget--selected">
        <div class="gift-widget__header">
          <span class="gift-widget__icon">🎁</span>
          <div>
            <h3 class="gift-widget__title">Gift Selected!</h3>
            <p class="gift-widget__subtitle">${giftItem.product_title}</p>
          </div>
        </div>
        <button class="gift-widget__remove" onclick="window.giftWidget.removeGift()">
          Remove gift
        </button>
      </div>
    `;
  }

  function renderEmpty() {
    const container = document.getElementById("gift-widget-container");
    if (container) container.innerHTML = "";
  }

  // ─── Gift products fetch ───────────────────────────────────

  async function fetchGiftProducts(maxPrice) {
    const shopDomain = document.getElementById("gift-widget-container").dataset.shop;
    const appUrl = getAppUrl();

    try {
      const data = await fetchJson(
        `${appUrl}/products?shop=${shopDomain}&maxPrice=${maxPrice}`,
      );
      return data.products || [];
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch products:", e);
      return [];
    }
  }

  // ─── Cart actions ──────────────────────────────────────────

  async function selectGift(variantId, productTitle) {
    const formData = new FormData();
    formData.append("id", variantId);
    formData.append("quantity", "1");
    formData.append(`properties[${GIFT_PROPERTY_KEY}]`, GIFT_PROPERTY_VALUE);

    try {
      const res = await fetch("/cart/add.js", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const cart = await fetchCart();
        await onCartUpdate(cart);
        // Trigger theme cart refresh
        document.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart } }));
      }
    } catch (e) {
      console.error("[Gift Widget] Failed to add gift:", e);
    }
  }

  async function removeGiftFromCart(cart) {
    const giftItem = getGiftItem(cart);
    if (!giftItem) return;

    try {
      await fetch("/cart/change.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line: giftItem.line + 1,
          quantity: 0,
        }),
      });
    } catch (e) {
      console.error("[Gift Widget] Failed to remove gift:", e);
    }
  }

  async function removeGift() {
    const cart = await fetchCart();
    await removeGiftFromCart(cart);
    const freshCart = await fetchCart();
    await onCartUpdate(freshCart);
    document.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart: freshCart } }));
  }

  // ─── Cart update listener ──────────────────────────────────

  function listenForCartUpdates() {
    // Listen for theme cart events
    document.addEventListener("cart:updated", async (event) => {
      const cart = event.detail?.cart || (await fetchCart());
      await onCartUpdate(cart);
    });

    // Fallback: poll cart every 3 seconds
    let lastTotal = null;
    setInterval(async () => {
      try {
        const cart = await fetchCart();
        const currentTotal = cart.total_price;
        if (currentTotal !== lastTotal) {
          lastTotal = currentTotal;
          await onCartUpdate(cart);
        }
      } catch (e) {
        // ignore
      }
    }, 3000);
  }

  // ─── Utils ─────────────────────────────────────────────────

  function getAppUrl() {
    // Use the Shopify app proxy — same-origin, no CORS, no tunnel URL needed.
    // Shopify forwards /apps/gift-threshold/* to our app's /api/* endpoint.
    return "/apps/gift-threshold";
  }

  function getFetchHeaders() {
    return { Accept: "application/json" };
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: getFetchHeaders(),
    });
    const contentType = response.headers.get("content-type") || "unknown";
    const body = await response.text();
    const normalizedBody = body.replace(/^\uFEFF/, "").trim();

    if (!response.ok || normalizedBody.startsWith("<")) {
      throw new Error(
        `Expected JSON from ${url}, received ${response.status} ${contentType} at ${response.url}`,
      );
    }

    try {
      return JSON.parse(normalizedBody);
    } catch {
      const preview = JSON.stringify(normalizedBody.slice(0, 160));
      throw new Error(
        `Invalid JSON from ${url}, received ${response.status} ${contentType} at ${response.url}; body starts with ${preview}`,
      );
    }
  }

  function formatPrice(cents) {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  }

  function showNotification(message, type) {
    const container = document.getElementById("gift-widget-container");
    if (!container) return;

    const notif = document.createElement("div");
    notif.className = `gift-widget__notification gift-widget__notification--${type}`;
    notif.textContent = message;
    container.prepend(notif);

    setTimeout(() => notif.remove(), 5000);
  }

  // ─── Public API ────────────────────────────────────────────

  window.giftWidget = {
    selectGift,
    removeGift,
  };

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

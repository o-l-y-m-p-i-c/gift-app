/**
 * Gift Widget — Cart page logic.
 *
 * Architecture:
 * - The widget script lives inside the cart section as an app block.
 * - When Dawn re-renders the cart section (add/remove/update), the script
 *   tag runs again. On first run we set up state + event listeners. On
 *   subsequent runs (after section re-render) we only re-render into the
 *   new container — listeners on window/document persist.
 * - After our own AJAX cart mutations we refresh the cart section via the
 *   Shopify Section Rendering API so Dawn shows the updated line items.
 */

(function () {
  const container = document.getElementById("gift-widget-container");
  if (!container) return;

  // ─── Re-initialization after section re-render ─────────────
  if (window.giftWidgetInitialized) {
    // Section was re-rendered by Dawn — just render into the new container.
    if (window.giftWidget && typeof window.giftWidget._init === "function") {
      window.giftWidget._init();
    }
    return;
  }
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
  let cartRequest = null;
  let cartUpdateDebounce = null;

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    const el = document.getElementById("gift-widget-container");
    if (!el) return;

    const shopDomain = el.dataset.shop;
    const appUrl = getAppUrl();

    // Fetch tiers and settings (only needed once, but safe to re-fetch)
    try {
      const [tiersData, settingsData] = await Promise.all([
        fetchJson(`${appUrl}/tiers?shop=${shopDomain}`),
        fetchJson(`${appUrl}/settings?shop=${shopDomain}`),
      ]);
      tiers = tiersData.tiers || [];
      settings = settingsData.settings || settings;
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch config:", e);
      el.innerHTML = `<div class="gift-widget"><p class="gift-widget__subtitle">Gift configuration is temporarily unavailable.</p></div>`;
      return;
    }

    const cart = await fetchCart();
    await onCartUpdate(cart);
  }

  // ─── Cart logic ────────────────────────────────────────────

  async function fetchCart() {
    if (cartRequest) return cartRequest;

    cartRequest = fetch("/cart.js").then(async (response) => {
      if (!response.ok) {
        throw new Error(`Unable to load cart (${response.status}).`);
      }
      return response.json();
    });

    try {
      return await cartRequest;
    } finally {
      cartRequest = null;
    }
  }

  /**
   * Refresh the cart section via Shopify Section Rendering API.
   * This makes Dawn re-render the cart line items (and the widget block).
   * After the section is replaced, the widget script runs again and
   * re-initializes via _init().
   */
  async function refreshCartSection() {
    const cartForm = document.querySelector('form[action="/cart"]');
    if (!cartForm) return;

    const section = cartForm.closest("[id^='shopify-section-']");
    if (!section) return;

    const sectionId = section.id.replace("shopify-section-", "");

    try {
      const res = await fetch(`${window.location.pathname}?section_id=${sectionId}`, {
        headers: { Accept: "text/html" },
      });
      if (!res.ok) return;

      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const newSection = doc.getElementById(section.id);

      if (newSection) {
        section.innerHTML = newSection.innerHTML;
      }
    } catch (e) {
      console.error("[Gift Widget] Failed to refresh cart section:", e);
    }
  }

  function getThresholdBase(cart) {
    const giftItem = cart.items.find(
      (item) => item.properties && item.properties[GIFT_PROPERTY_KEY],
    );
    const giftPrice = giftItem ? giftItem.final_line_price : 0;

    const base = settings.useTotalAfterDiscounts
      ? cart.total_price
      : cart.items_subtotal_price;

    return base - giftPrice;
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
    if (!cart || typeof cart.total_price !== "number") {
      cart = await fetchCart();
    }

    const thresholdBase = getThresholdBase(cart);
    const activeTier = findActiveTier(thresholdBase);
    const maxGiftPrice = activeTier ? activeTier.giftAmount : 0;

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
        await refreshCartSection();
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
        await refreshCartSection();
        if (settings.showRemovalNotification) {
          showNotification("Your gift was removed. Please choose a new gift.", "info");
        }
        const freshCart = await fetchCart();
        await renderWidget(freshCart, activeTier, maxGiftPrice);
        return;
      }
      // Gift still valid → show "gift selected" state
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
    const el = document.getElementById("gift-widget-container");
    if (!el) return;

    const cartVariantIds = new Set(
      cart.items.map((item) => String(item.variant_id)),
    );

    const products = await fetchGiftProducts(maxGiftPrice, cartVariantIds);
    giftProducts = products;

    if (products.length === 0) {
      el.innerHTML = `
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
          <button type="button" class="gift-widget__select" onclick="window.giftWidget.selectGift('${p.variantId}', '${tier.id}')">
            Select
          </button>
        </div>
      `,
      )
      .join("");

    el.innerHTML = `
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
    const el = document.getElementById("gift-widget-container");
    if (!el) return;

    el.innerHTML = `
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
    const el = document.getElementById("gift-widget-container");
    if (el) el.innerHTML = "";
  }

  // ─── Gift products fetch ───────────────────────────────────

  async function fetchGiftProducts(maxPrice, excludeVariantIds = new Set()) {
    try {
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

      const eligible = [];
      for (const product of allProducts) {
        const image = product.images?.[0]?.src || "";
        for (const variant of product.variants || []) {
          const priceCents = Math.round(parseFloat(variant.price || "0") * 100);
          if (
            priceCents > 0 &&
            priceCents <= maxPrice &&
            variant.available !== false &&
            !excludeVariantIds.has(String(variant.id))
          ) {
            eligible.push({
              productId: String(product.id),
              variantId: String(variant.id),
              title:
                variant.title === "Default Title"
                  ? product.title
                  : `${product.title} — ${variant.title}`,
              price: priceCents,
              image,
            });
          }
        }
      }

      console.log(`[Gift Widget] Found ${eligible.length} eligible gifts (maxPrice=${maxPrice} cents) from ${allProducts.length} products`);
      return eligible;
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch products:", e);
      return [];
    }
  }

  // ─── Cart actions ──────────────────────────────────────────

  async function selectGift(variantId, tierId) {
    const buttons = document.querySelectorAll(".gift-widget__select");
    let giftAdded = false;
    buttons.forEach((button) => {
      button.disabled = true;
    });

    const shopDomain =
      document.getElementById("gift-widget-container")?.dataset.shop || "";

    try {
      const initialCart = await fetchCart();
      const qualifyingVariantIds = initialCart.items
        .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id));

      // 1. Request a one-use discount code
      const codeResponse = await fetch(`${getAppUrl()}/gift-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId,
          tierId,
          qualifyingVariantIds,
          shop: shopDomain,
        }),
      });
      const codeData = await codeResponse.json().catch(() => ({}));
      if (!codeResponse.ok || !codeData.code) {
        throw new Error(codeData.error || "Unable to create gift discount.");
      }

      // 2. Add the gift variant to the cart
      const addResponse = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: Number(variantId),
              quantity: 1,
              properties: { [GIFT_PROPERTY_KEY]: GIFT_PROPERTY_VALUE },
            },
          ],
        }),
      });

      if (!addResponse.ok) {
        const error = await addResponse.json().catch(() => ({}));
        throw new Error(error.description || "Unable to add this gift.");
      }
      giftAdded = true;

      // 3. Apply the discount code
      const cart = await fetchCart();
      const discountCodes = (cart.discount_codes || [])
        .filter((discount) => discount.applicable !== false && discount.code)
        .map((discount) => discount.code);
      const updateResponse = await fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discount: [...new Set([...discountCodes, codeData.code])].join(","),
        }),
      });

      if (!updateResponse.ok) {
        throw new Error("Unable to apply the gift discount.");
      }

      // 4. Refresh the cart section so Dawn shows the new item + discount.
      //    This replaces the section HTML (including the widget block),
      //    and the widget script re-runs and re-initializes via _init().
      await refreshCartSection();
    } catch (e) {
      if (giftAdded) {
        const cart = await fetchCart().catch(() => null);
        if (cart) {
          await removeGiftFromCart(cart);
          await refreshCartSection();
        }
      }
      console.error("[Gift Widget] Failed to add gift:", e);
      showNotification(e.message || "Unable to add this gift.", "warning");
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  async function removeGiftFromCart(cart) {
    const giftItem = getGiftItem(cart);
    if (!giftItem) return null;

    try {
      const response = await fetch("/cart/change.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: giftItem.key,
          quantity: 0,
        }),
      });
      if (!response.ok) {
        throw new Error(`Unable to remove gift (${response.status}).`);
      }
      return response.json();
    } catch (e) {
      console.error("[Gift Widget] Failed to remove gift:", e);
      return null;
    }
  }

  async function removeGift() {
    const cart = await fetchCart();
    await removeGiftFromCart(cart);
    // Refresh cart section — widget will re-initialize and show gift selection
    await refreshCartSection();
  }

  // ─── Cart update listener ──────────────────────────────────

  /**
   * Listen for cart changes from Dawn and other sources.
   * These listeners are set up ONCE (on first script execution) and
   * persist across section re-renders because they're on window/document.
   */
  function listenForCartUpdates() {
    function scheduleCartRefresh() {
      if (cartUpdateDebounce) clearTimeout(cartUpdateDebounce);
      cartUpdateDebounce = setTimeout(async () => {
        cartUpdateDebounce = null;
        const cart = await fetchCart();
        await onCartUpdate(cart);
      }, 300);
    }

    // Dawn dispatches cart events on window after AJAX operations
    ["cart:updated", "cart:refresh", "cart:change"].forEach((eventName) => {
      window.addEventListener(eventName, async (event) => {
        const eventCart = event?.detail?.cart || event?.detail?.baseCart;
        if (eventCart && typeof eventCart.total_price === "number") {
          if (cartUpdateDebounce) clearTimeout(cartUpdateDebounce);
          cartUpdateDebounce = null;
          await onCartUpdate(eventCart);
        } else {
          scheduleCartRefresh();
        }
      });
    });
  }

  // ─── Utils ─────────────────────────────────────────────────

  function getAppUrl() {
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
    const el = document.getElementById("gift-widget-container");
    if (!el) return;

    const notif = document.createElement("div");
    notif.className = `gift-widget__notification gift-widget__notification--${type}`;
    notif.textContent = message;
    el.prepend(notif);

    setTimeout(() => notif.remove(), 5000);
  }

  // ─── Public API ────────────────────────────────────────────

  window.giftWidget = {
    selectGift,
    removeGift,
    _init: init, // exposed for re-initialization after section re-render
  };

  // Set up event listeners once
  listenForCartUpdates();

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/**
 * Gift Widget — Cart page logic.
 *
 * Architecture:
 * - The widget script lives inside the cart section as an app block.
 * - When Dawn re-renders the cart section, the script tag runs again.
 *   On first run we set up state + event listeners. On subsequent runs
 *   we only re-render into the new container.
 * - After our own AJAX cart mutations we refresh the cart section via
 *   the Shopify Section Rendering API so Dawn shows updated line items.
 *
 * Loading states:
 * - init() shows a spinner immediately
 * - selectGift() disables all buttons + shows spinner on clicked button
 * - removeGift() disables remove button + shows spinner
 * - Error states show inline with a retry option
 */

(function () {
  const container = document.getElementById("gift-widget-container");
  if (!container) return;

  // ─── Re-initialization after section re-render ─────────────
  if (window.giftWidgetInitialized) {
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
  let isRefreshingSection = false;
  let isSelectingGift = false;
  let isRemovingGift = false;

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    const el = document.getElementById("gift-widget-container");
    if (!el) return;

    // Show loading indicator immediately
    renderLoading(el);

    const shopDomain = el.dataset.shop;
    const appUrl = getAppUrl();

    // Fetch tiers and settings
    try {
      const [tiersData, settingsData] = await Promise.all([
        fetchJson(`${appUrl}/tiers?shop=${shopDomain}`),
        fetchJson(`${appUrl}/settings?shop=${shopDomain}`),
      ]);
      tiers = tiersData.tiers || [];
      settings = settingsData.settings || settings;
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch config:", e);
      renderError(el, "Gift configuration is temporarily unavailable.", () => init());
      return;
    }

    // Fetch cart
    let cart;
    try {
      cart = await fetchCart();
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch cart:", e);
      renderError(el, "Unable to load your cart. Please refresh the page.", () => init());
      return;
    }

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
   * Refresh the cart UI after AJAX operations.
   * Works with Dawn theme (cart page + cart drawer + header cart icon).
   */
  async function refreshCartSection() {
    isRefreshingSection = true;

    const cart = await fetchCart().catch(() => null);

    try {
      document.dispatchEvent(new CustomEvent("cart:refresh", { detail: { cart } }));
      document.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart } }));
    } catch (e) {
      console.warn("[Gift Widget] Event dispatch failed:", e);
    }

    // Refresh cart page section
    const cartItemsDiv = document.querySelector("[data-id^='template--'][data-id*='cart-items']");
    const sectionId = cartItemsDiv?.getAttribute("data-id");

    if (sectionId) {
      try {
        const res = await fetch(`${window.location.pathname}?section_id=${sectionId}`, {
          headers: { Accept: "text/html" },
        });
        if (res.ok) {
          const html = await res.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          const newCartItems = doc.querySelector(`[data-id="${sectionId}"]`);
          const oldCartItems = document.querySelector(`[data-id="${sectionId}"]`);
          if (newCartItems && oldCartItems) {
            oldCartItems.innerHTML = newCartItems.innerHTML;
            const scripts = oldCartItems.querySelectorAll("script");
            scripts.forEach((oldScript) => {
              const newScript = document.createElement("script");
              for (const attr of oldScript.attributes || []) {
                newScript.setAttribute(attr.name, attr.value);
              }
              newScript.textContent = oldScript.textContent;
              oldScript.parentNode.replaceChild(newScript, oldScript);
            });
          }
        }
      } catch (e) {
        console.warn("[Gift Widget] Section fetch failed:", e);
      }
    }

    // Refresh cart drawer
    const cartDrawerItems = document.querySelector("cart-drawer-items");
    if (cartDrawerItems) {
      try {
        const res = await fetch(`/cart?section_id=cart-drawer`, {
          headers: { Accept: "text/html" },
        });
        if (res.ok) {
          const html = await res.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          const newDrawerItems = doc.querySelector("cart-drawer-items");
          if (newDrawerItems) {
            cartDrawerItems.innerHTML = newDrawerItems.innerHTML;
          }
        }
      } catch (e) {
        console.warn("[Gift Widget] Cart drawer refresh failed:", e);
      }
    }

    // Update header cart icon count
    if (cart) updateCartCountBubble(cart);

    // Re-initialize the gift widget
    if (window.giftWidget && typeof window.giftWidget._init === "function") {
      await window.giftWidget._init();
    }

    isRefreshingSection = false;
  }

  function updateCartCountBubble(cart) {
    const bubble = document.querySelector("#cart-icon-bubble .cart-count-bubble");
    if (!bubble) return;

    const itemCount = cart.item_count || 0;

    if (itemCount > 0) {
      bubble.style.display = "";
      const countSpan = bubble.querySelector("span:not(.visually-hidden)");
      const labelSpan = bubble.querySelector(".visually-hidden:last-child");
      if (countSpan) countSpan.textContent = itemCount;
      if (labelSpan) {
        labelSpan.textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
      }
    } else {
      bubble.style.display = "none";
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

  function renderLoading(el) {
    el.innerHTML = `
      <div class="gift-widget gift-widget--loading">
        <div class="gift-widget__spinner"></div>
        <p class="gift-widget__subtitle">Loading gifts…</p>
      </div>
    `;
  }

  function renderError(el, message, retryFn) {
    el.innerHTML = `
      <div class="gift-widget gift-widget--error">
        <div class="gift-widget__header">
          <span class="gift-widget__icon">⚠️</span>
          <div>
            <h3 class="gift-widget__title">Something went wrong</h3>
            <p class="gift-widget__subtitle">${message}</p>
          </div>
        </div>
        <button type="button" class="gift-widget__retry" id="gift-widget-retry">
          Try again
        </button>
      </div>
    `;
    const retryBtn = el.querySelector("#gift-widget-retry");
    if (retryBtn && retryFn) {
      retryBtn.addEventListener("click", retryFn);
    }
  }

  async function renderWidget(cart, tier, maxGiftPrice) {
    const el = document.getElementById("gift-widget-container");
    if (!el) return;

    // Show loading while fetching products
    renderLoading(el);

    const cartVariantIds = new Set(
      cart.items.map((item) => String(item.variant_id)),
    );

    let products;
    try {
      products = await fetchGiftProducts(maxGiftPrice, cartVariantIds);
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch products:", e);
      renderError(el, "Unable to load gift products.", () =>
        renderWidget(cart, tier, maxGiftPrice),
      );
      return;
    }
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
            <span class="gift-widget__select-label">Select</span>
            <span class="gift-widget__select-spinner" style="display:none"></span>
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
        <button class="gift-widget__remove" id="gift-widget-remove-btn" onclick="window.giftWidget.removeGift()">
          <span class="gift-widget__remove-label">Remove gift</span>
          <span class="gift-widget__remove-spinner" style="display:none"></span>
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

    console.log(`[Gift Widget] Found ${eligible.length} eligible gifts from ${allProducts.length} products`);
    return eligible;
  }

  // ─── Cart actions ──────────────────────────────────────────

  async function selectGift(variantId, tierId) {
    if (isSelectingGift) return;
    isSelectingGift = true;

    // Disable all select buttons + show spinner on the clicked one
    const allButtons = document.querySelectorAll(".gift-widget__select");
    allButtons.forEach((btn) => { btn.disabled = true; });

    const clickedCard = document.querySelector(`[data-variant-id="${variantId}"]`);
    const clickedBtn = clickedCard?.querySelector(".gift-widget__select");
    const clickedLabel = clickedBtn?.querySelector(".gift-widget__select-label");
    const clickedSpinner = clickedBtn?.querySelector(".gift-widget__select-spinner");
    if (clickedLabel) clickedLabel.style.display = "none";
    if (clickedSpinner) clickedSpinner.style.display = "inline-block";

    let giftAdded = false;
    const shopDomain =
      document.getElementById("gift-widget-container")?.dataset.shop || "";

    try {
      const initialCart = await fetchCart();
      const qualifyingVariantIds = initialCart.items
        .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id));

      // 1. Request discount code
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

      // 2. Add gift to cart
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

      // 3. Apply discount code
      const cart = await fetchCart();
      const discountCodes = (cart.discount_codes || [])
        .filter((d) => d.applicable !== false && d.code)
        .map((d) => d.code);
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

      // 4. Refresh cart section
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

      // Re-enable buttons
      allButtons.forEach((btn) => { btn.disabled = false; });
      if (clickedLabel) clickedLabel.style.display = "";
      if (clickedSpinner) clickedSpinner.style.display = "none";
    } finally {
      isSelectingGift = false;
    }
  }

  async function removeGiftFromCart(cart) {
    const giftItem = getGiftItem(cart);
    if (!giftItem) return null;

    const response = await fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: giftItem.key, quantity: 0 }),
    });
    if (!response.ok) {
      throw new Error(`Unable to remove gift (${response.status}).`);
    }
    return response.json();
  }

  async function removeGift() {
    if (isRemovingGift) return;
    isRemovingGift = true;

    // Disable remove button + show spinner
    const removeBtn = document.getElementById("gift-widget-remove-btn");
    if (removeBtn) {
      removeBtn.disabled = true;
      const label = removeBtn.querySelector(".gift-widget__remove-label");
      const spinner = removeBtn.querySelector(".gift-widget__remove-spinner");
      if (label) label.style.display = "none";
      if (spinner) spinner.style.display = "inline-block";
    }

    try {
      const cart = await fetchCart();
      await removeGiftFromCart(cart);
      await refreshCartSection();
    } catch (e) {
      console.error("[Gift Widget] Failed to remove gift:", e);
      showNotification("Unable to remove gift. Please try again.", "warning");
      if (removeBtn) {
        removeBtn.disabled = false;
        const label = removeBtn.querySelector(".gift-widget__remove-label");
        const spinner = removeBtn.querySelector(".gift-widget__remove-spinner");
        if (label) label.style.display = "";
        if (spinner) spinner.style.display = "none";
      }
    } finally {
      isRemovingGift = false;
    }
  }

  // ─── Cart update listener ──────────────────────────────────

  function listenForCartUpdates() {
    function scheduleCartRefresh() {
      if (cartUpdateDebounce) clearTimeout(cartUpdateDebounce);
      cartUpdateDebounce = setTimeout(async () => {
        cartUpdateDebounce = null;
        const cart = await fetchCart();
        await onCartUpdate(cart);
      }, 300);
    }

    ["cart:updated", "cart:refresh", "cart:change"].forEach((eventName) => {
      window.addEventListener(eventName, async (event) => {
        if (isSelectingGift || isRemovingGift) return;
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

    // MutationObserver for Dawn's section re-renders
    const cartItemsContainer =
      document.querySelector("[data-id^='template--'][data-id*='cart-items']") ||
      document.querySelector("#cart") ||
      document.querySelector("form[action='/cart']") ||
      document.querySelector("cart-drawer-items");

    if (cartItemsContainer && typeof MutationObserver !== "undefined") {
      let observerDebounce = null;
      const observer = new MutationObserver(() => {
        if (isRefreshingSection || isSelectingGift || isRemovingGift) return;
        if (observerDebounce) clearTimeout(observerDebounce);
        observerDebounce = setTimeout(async () => {
          observerDebounce = null;
          const el = document.getElementById("gift-widget-container");
          if (!el || el.children.length === 0) {
            if (window.giftWidget && typeof window.giftWidget._init === "function") {
              await window.giftWidget._init();
            }
          } else {
            const cart = await fetchCart();
            await onCartUpdate(cart);
          }
        }, 300);
      });
      observer.observe(cartItemsContainer, { childList: true, subtree: true });
    }
  }

  // ─── Utils ─────────────────────────────────────────────────

  function getAppUrl() {
    return "/apps/gift-threshold";
  }

  function getFetchHeaders() {
    return { Accept: "application/json" };
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: getFetchHeaders() });
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
    _init: init,
  };

  listenForCartUpdates();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/**
 * Gift Widget — Cart page logic.
 *
 * Features:
 * - Always visible: shows current tier, progress to next tier, available budget
 * - Multi-gift: select multiple gifts until budget is exhausted
 * - Remaining budget: after each selection, shows remaining and filters products
 * - Loading/error states with retry
 * - Cart sync with Dawn theme (cart page + drawer + header icon)
 */

(function () {
  const container = document.getElementById("gift-widget-container");
  if (!container) return;

  if (window.giftWidgetInitialized) {
    if (window.giftWidget && typeof window.giftWidget._init === "function") {
      window.giftWidget._init();
    }
    return;
  }
  window.giftWidgetInitialized = true;

  const GIFT_PROPERTY_KEY = "_gift";
  const GIFT_PROPERTY_VALUE = "true";
  const GIFT_SELECTION_PROPERTY_KEY = "_gift_selection";

  let tiers = [];
  let settings = {
    useTotalAfterDiscounts: true,
    showLevelUpNotification: true,
    showRemovalNotification: true,
  };
  let lastActiveTierId = null;
  let giftProducts = [];
  let cartRequest = null;
  let cartUpdateDebounce = null;
  let isRefreshingSection = false;
  let isSelectingGift = false;
  let removingGiftKey = null;

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    const el = document.getElementById("gift-widget-container");
    if (!el) return;

    renderLoading(el);

    const shopDomain = el.dataset.shop;
    const appUrl = getAppUrl();

    try {
      const [tiersData, settingsData] = await Promise.all([
        fetchJson(`${appUrl}/tiers?shop=${shopDomain}`),
        fetchJson(`${appUrl}/settings?shop=${shopDomain}`),
      ]);
      tiers = (tiersData.tiers || []).sort((a, b) => a.minAmount - b.minAmount);
      settings = settingsData.settings || settings;
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch config:", e);
      renderError(el, "Gift configuration is temporarily unavailable.", () => init());
      return;
    }

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
      if (!response.ok) throw new Error(`Unable to load cart (${response.status}).`);
      return response.json();
    });
    try {
      return await cartRequest;
    } finally {
      cartRequest = null;
    }
  }

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
          const doc = new DOMParser().parseFromString(html, "text/html");
          const newItems = doc.querySelector(`[data-id="${sectionId}"]`);
          const oldItems = document.querySelector(`[data-id="${sectionId}"]`);
          if (newItems && oldItems) {
            oldItems.innerHTML = newItems.innerHTML;
            oldItems.querySelectorAll("script").forEach((oldScript) => {
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
    const drawer = document.querySelector("cart-drawer-items");
    if (drawer) {
      try {
        const res = await fetch(`/cart?section_id=cart-drawer`, { headers: { Accept: "text/html" } });
        if (res.ok) {
          const doc = new DOMParser().parseFromString(await res.text(), "text/html");
          const newDrawer = doc.querySelector("cart-drawer-items");
          if (newDrawer) drawer.innerHTML = newDrawer.innerHTML;
        }
      } catch (e) {
        console.warn("[Gift Widget] Cart drawer refresh failed:", e);
      }
    }

    if (cart) updateCartCountBubble(cart);

    if (window.giftWidget && typeof window.giftWidget._init === "function") {
      await window.giftWidget._init();
    }

    isRefreshingSection = false;
  }

  function updateCartCountBubble(cart) {
    const bubble = document.querySelector("#cart-icon-bubble .cart-count-bubble");
    if (!bubble) return;
    const count = cart.item_count || 0;
    if (count > 0) {
      bubble.style.display = "";
      const countSpan = bubble.querySelector("span:not(.visually-hidden)");
      const labelSpan = bubble.querySelector(".visually-hidden:last-child");
      if (countSpan) countSpan.textContent = count;
      if (labelSpan) labelSpan.textContent = `${count} ${count === 1 ? "item" : "items"}`;
    } else {
      bubble.style.display = "none";
    }
  }

  // ─── Gift helpers ──────────────────────────────────────────

  function getGiftItems(cart) {
    return cart.items.filter(
      (item) => item.properties && item.properties[GIFT_PROPERTY_KEY] === GIFT_PROPERTY_VALUE,
    );
  }

  function getGiftSelections(cart) {
    const selections = new Map();
    for (const item of getGiftItems(cart)) {
      const selectionId = item.properties?.[GIFT_SELECTION_PROPERTY_KEY] || item.key;
      if (!selections.has(selectionId)) selections.set(selectionId, item);
    }
    return [...selections.values()];
  }

  function getPriceValue(value) {
    const price = Number(value);
    return Number.isFinite(price) ? price : null;
  }

  function getOriginalLinePrice(item) {
    const originalLinePrice = getPriceValue(item.original_line_price);
    if (originalLinePrice !== null) return originalLinePrice;
    const originalPrice = getPriceValue(item.original_price);
    if (originalPrice !== null) return originalPrice * item.quantity;
    const price = getPriceValue(item.price);
    if (price !== null) return price * item.quantity;
    return getPriceValue(item.line_price) || 0;
  }

  function getOriginalUnitPrice(item) {
    const originalPrice = getPriceValue(item.original_price);
    if (originalPrice !== null) return originalPrice;
    return Math.round(getOriginalLinePrice(item) / Math.max(1, item.quantity));
  }

  function getFinalLinePrice(item) {
    const finalLinePrice = getPriceValue(item.final_line_price);
    if (finalLinePrice !== null) return finalLinePrice;
    const finalPrice = getPriceValue(item.final_price);
    if (finalPrice !== null) return finalPrice * item.quantity;
    return getPriceValue(item.line_price) || 0;
  }

  function getTotalGiftValue(cart) {
    return getGiftSelections(cart).reduce((sum, item) => sum + getOriginalUnitPrice(item), 0);
  }

  function getFreeGiftQuantity(cart) {
    return getGiftItems(cart).reduce((sum, item) => {
      const unitPrice = getOriginalUnitPrice(item);
      if (unitPrice <= 0) return sum;
      const discountValue = getOriginalLinePrice(item) - getFinalLinePrice(item);
      return sum + Math.min(item.quantity, Math.floor(discountValue / unitPrice));
    }, 0);
  }

  function getThresholdBase(cart) {
    return cart.items
      .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
      .reduce(
        (sum, item) => sum + (
          settings.useTotalAfterDiscounts
            ? getFinalLinePrice(item)
            : getOriginalLinePrice(item)
        ),
        0,
      );
  }

  function findActiveTier(thresholdBase) {
    const active = tiers
      .filter((t) => t.minAmount <= thresholdBase)
      .sort((a, b) => b.minAmount - a.minAmount);
    return active[0] || null;
  }

  function findNextTier(thresholdBase) {
    const next = tiers
      .filter((t) => t.minAmount > thresholdBase)
      .sort((a, b) => a.minAmount - b.minAmount);
    return next[0] || null;
  }

  // ─── Cart update handler ───────────────────────────────────

  async function onCartUpdate(cart) {
    if (!cart || typeof cart.total_price !== "number") {
      cart = await fetchCart();
    }

    const thresholdBase = getThresholdBase(cart);
    const activeTier = findActiveTier(thresholdBase);
    const nextTier = findNextTier(thresholdBase);
    const giftItems = getGiftItems(cart);
    const giftSelectionCount = getGiftSelections(cart).length;
    const freeGiftQuantity = getFreeGiftQuantity(cart);
    const totalGiftValue = getTotalGiftValue(cart);
    const remainingBudget = activeTier ? Math.max(0, activeTier.giftAmount - totalGiftValue) : 0;

    if (giftSelectionCount > 0 && freeGiftQuantity !== giftSelectionCount) {
      await removeAllGifts(cart);
      if (settings.showRemovalNotification) {
        showNotification("Your gifts were removed because the full gift discount was not applied.", "warning");
      }
      await refreshCartSection();
      return;
    }

    const tierChanged = activeTier?.id !== lastActiveTierId;
    if (tierChanged) {
      if (lastActiveTierId !== null && activeTier && settings.showLevelUpNotification) {
        showNotification(
          `🎉 New gift tier unlocked! Choose gifts up to ${formatPrice(activeTier.giftAmount)}`,
          "success",
        );
      }
      lastActiveTierId = activeTier?.id ?? null;
    }

    // If no active tier but gifts in cart → remove them
    if (!activeTier && giftItems.length > 0) {
      await removeAllGifts(cart);
      await refreshCartSection();
      if (settings.showRemovalNotification) {
        showNotification("Your cart no longer qualifies for a free gift.", "warning");
      }
      // Re-fetch after removal
      cart = await fetchCart();
    }

    // If gifts exceed budget (tier changed down) → remove excess
    if (activeTier && totalGiftValue > activeTier.giftAmount) {
      await removeAllGifts(cart);
      await refreshCartSection();
      if (settings.showRemovalNotification) {
        showNotification("Your gifts were removed. Please choose again.", "info");
      }
      cart = await fetchCart();
    }

    await renderWidget(cart, activeTier, nextTier, thresholdBase);
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
        <button type="button" class="gift-widget__retry" id="gift-widget-retry">Try again</button>
      </div>
    `;
    const retryBtn = el.querySelector("#gift-widget-retry");
    if (retryBtn && retryFn) retryBtn.addEventListener("click", retryFn);
  }

  async function renderWidget(cart, activeTier, nextTier, thresholdBase) {
    const el = document.getElementById("gift-widget-container");
    if (!el) return;

    const giftItems = getGiftSelections(cart);
    const totalGiftValue = getTotalGiftValue(cart);
    const remainingBudget = activeTier ? Math.max(0, activeTier.giftAmount - totalGiftValue) : 0;

    // ── Progress bar section ──
    let progressHtml = "";

    if (activeTier && nextTier) {
      // Between current and next tier
      const progressPct = Math.min(
        100,
        Math.max(0, (thresholdBase / nextTier.minAmount) * 100),
      );
      const amountToNext = nextTier.minAmount - thresholdBase;

      progressHtml = `
        <div class="gift-widget__progress">
          <div class="gift-widget__progress-info">
            <span class="gift-widget__progress-current">
              ${formatPrice(activeTier.giftAmount)} gift budget
            </span>
            <span class="gift-widget__progress-next">
              ${formatPrice(amountToNext)} to unlock ${formatPrice(nextTier.giftAmount)}
            </span>
          </div>
          <div class="gift-widget__progress-bar">
            <div class="gift-widget__progress-fill" style="width:${progressPct}%"></div>
          </div>
        </div>
      `;
    } else if (activeTier && !nextTier) {
      // Highest tier reached
      progressHtml = `
        <div class="gift-widget__progress">
          <div class="gift-widget__progress-info">
            <span class="gift-widget__progress-current">
              ${formatPrice(activeTier.giftAmount)} gift budget — max tier!
            </span>
          </div>
          <div class="gift-widget__progress-bar">
            <div class="gift-widget__progress-fill" style="width:100%"></div>
          </div>
        </div>
      `;
    } else if (!activeTier && tiers.length > 0) {
      // No tier yet — show progress to first tier
      const firstTier = tiers[0];
      const progressPct = Math.min(
        100,
        Math.max(0, (thresholdBase / firstTier.minAmount) * 100),
      );
      const amountToFirst = firstTier.minAmount - thresholdBase;

      progressHtml = `
        <div class="gift-widget__progress">
          <div class="gift-widget__progress-info">
            <span class="gift-widget__progress-current">
              ${formatPrice(amountToFirst)} to unlock your first gift
            </span>
          </div>
          <div class="gift-widget__progress-bar">
            <div class="gift-widget__progress-fill" style="width:${progressPct}%"></div>
          </div>
        </div>
      `;
    }

    // ── Selected gifts section ──
    let selectedHtml = "";
    if (giftItems.length > 0) {
      const giftCards = giftItems
        .map(
          (item) => `
          <div class="gift-widget__selected-item" data-gift-key="${item.key}">
            <img src="${item.image || ""}" alt="${item.product_title}" class="gift-widget__selected-image" loading="lazy" />
            <div class="gift-widget__selected-info">
              <p class="gift-widget__selected-name">${item.product_title}</p>
              <p class="gift-widget__selected-price">${formatPrice(getOriginalUnitPrice(item))}</p>
            </div>
            <button type="button"
              class="gift-widget__selected-remove"
              onclick="window.giftWidget.removeGift('${item.key}')"
              ${removingGiftKey === item.key ? "disabled" : ""}>
              <span class="gift-widget__remove-label">✕</span>
              ${removingGiftKey === item.key ? '<span class="gift-widget__remove-spinner"></span>' : ""}
            </button>
          </div>
        `,
        )
        .join("");

      selectedHtml = `
        <div class="gift-widget__selected-list">
          ${giftCards}
        </div>
      `;
    }

    // ── Gift selection section ──
    let selectionHtml = "";

    if (!activeTier) {
      // No active tier
      selectionHtml = `
        <div class="gift-widget__no-tier">
          <p class="gift-widget__subtitle">
            Add more items to your cart to unlock free gifts!
          </p>
        </div>
      `;
    } else if (remainingBudget <= 0) {
      // Budget fully used
      selectionHtml = `
        <div class="gift-widget__budget-used">
          <p class="gift-widget__subtitle">
            🎁 Your gift budget of ${formatPrice(activeTier.giftAmount)} is fully used!
          </p>
        </div>
      `;
    } else {
      // Show eligible products for remaining budget
      // Show loading while fetching
      const budgetLabel = giftItems.length > 0
        ? `${formatPrice(remainingBudget)} remaining`
        : `Choose gifts up to ${formatPrice(activeTier.giftAmount)}`;

      selectionHtml = `
        <div class="gift-widget__selection-loading">
          <div class="gift-widget__spinner"></div>
          <p class="gift-widget__subtitle">Loading gifts…</p>
        </div>
      `;

      // Render the full widget first (with progress + selected + loading)
      el.innerHTML = `
        <div class="gift-widget">
          <div class="gift-widget__header">
            <span class="gift-widget__icon">🎁</span>
            <div>
              <h3 class="gift-widget__title">Free Gifts</h3>
              <p class="gift-widget__subtitle">${budgetLabel}</p>
            </div>
          </div>
          ${progressHtml}
          ${selectedHtml}
          ${selectionHtml}
        </div>
      `;

      // Now fetch products for remaining budget
      // Exclude regular cart items (non-gift), but allow selecting the same
      // gift product multiple times until budget is exhausted.
      const excludeIds = new Set(
        cart.items
          .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
          .map((item) => String(item.variant_id)),
      );

      let products;
      try {
        products = await fetchGiftProducts(remainingBudget, excludeIds);
      } catch (e) {
        console.error("[Gift Widget] Failed to fetch products:", e);
        const selectionEl = el.querySelector(".gift-widget__selection-loading");
        if (selectionEl) {
          selectionEl.innerHTML = `
            <p class="gift-widget__subtitle">Unable to load gift products.</p>
            <button type="button" class="gift-widget__retry" id="gift-widget-retry-products">Try again</button>
          `;
          const retryBtn = el.querySelector("#gift-widget-retry-products");
          if (retryBtn) {
            retryBtn.addEventListener("click", () => renderWidget(cart, activeTier, nextTier, thresholdBase));
          }
        }
        return;
      }
      giftProducts = products;

      // Replace loading with product cards or empty message
      const selectionContainer = el.querySelector(".gift-widget__selection-loading");
      if (!selectionContainer) return;

      if (products.length === 0) {
        selectionContainer.outerHTML = `
          <div class="gift-widget__no-products">
            <p class="gift-widget__subtitle">
              No eligible products found under ${formatPrice(remainingBudget)}.
            </p>
          </div>
        `;
      } else {
        const productCards = products
          .map(
            (p) => `
            <div class="gift-widget__card" data-variant-id="${p.variantId}">
              <img src="${p.image}" alt="${p.title}" class="gift-widget__image" loading="lazy" />
              <div class="gift-widget__info">
                <p class="gift-widget__name">${p.title}</p>
                <p class="gift-widget__price">${formatPrice(p.price)}</p>
              </div>
              <button type="button" class="gift-widget__select" onclick="window.giftWidget.selectGift('${p.variantId}', '${activeTier.id}')">
                <span class="gift-widget__select-label">Select</span>
                <span class="gift-widget__select-spinner" style="display:none"></span>
              </button>
            </div>
          `,
          )
          .join("");

        selectionContainer.outerHTML = `
          <div class="gift-widget__carousel">${productCards}</div>
        `;
      }

      return; // Already rendered
    }

    // Render full widget (no product selection needed)
    el.innerHTML = `
      <div class="gift-widget">
        <div class="gift-widget__header">
          <span class="gift-widget__icon">🎁</span>
          <div>
            <h3 class="gift-widget__title">Free Gifts</h3>
            <p class="gift-widget__subtitle">
              ${activeTier ? `Budget: ${formatPrice(activeTier.giftAmount)}` : "Unlock free gifts"}
            </p>
          </div>
        </div>
        ${progressHtml}
        ${selectedHtml}
        ${selectionHtml}
      </div>
    `;
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

    console.log(`[Gift Widget] Found ${eligible.length} eligible gifts (maxPrice=${maxPrice} cents) from ${allProducts.length} products`);
    return eligible;
  }

  // ─── Cart actions ──────────────────────────────────────────

  async function selectGift(variantId, tierId) {
    if (isSelectingGift) return;
    isSelectingGift = true;

    const allButtons = document.querySelectorAll(".gift-widget__select");
    allButtons.forEach((btn) => { btn.disabled = true; });

    const clickedCard = document.querySelector(`.gift-widget__card[data-variant-id="${variantId}"]`);
    const clickedBtn = clickedCard?.querySelector(".gift-widget__select");
    const clickedLabel = clickedBtn?.querySelector(".gift-widget__select-label");
    const clickedSpinner = clickedBtn?.querySelector(".gift-widget__select-spinner");
    if (clickedLabel) clickedLabel.style.display = "none";
    if (clickedSpinner) clickedSpinner.style.display = "inline-block";

    let giftAdded = false;
    let addedGiftSelectionId = null;
    const shopDomain =
      document.getElementById("gift-widget-container")?.dataset.shop || "";

    try {
      const initialCart = await fetchCart();
      const qualifyingVariantIds = initialCart.items
        .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id));

      // Collect one variant ID per gift-widget selection plus the new selection.
      // Manual quantity increases remain paid and don't increase the BXGY benefit.
      const existingGiftVariantIds = getGiftSelections(initialCart)
        .map((item) => String(item.variant_id));
      const allGiftVariantIds = [...existingGiftVariantIds, variantId];

      // 1. Request a single discount code covering ALL gifts
      const codeResponse = await fetch(`${getAppUrl()}/gift-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          giftVariantIds: allGiftVariantIds,
          tierId,
          qualifyingVariantIds,
          shop: shopDomain,
        }),
      });
      const codeData = await codeResponse.json().catch(() => ({}));
      if (!codeResponse.ok || !codeData.code) {
        throw new Error(codeData.error || "Unable to create gift discount.");
      }
      if (Number(codeData.giftQuantity) !== allGiftVariantIds.length) {
        throw new Error("The gift discount quantity is out of sync. Please try again.");
      }

      // 2. Add gift to cart
      addedGiftSelectionId = typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const addResponse = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{
            id: Number(variantId),
            quantity: 1,
            properties: {
              [GIFT_PROPERTY_KEY]: GIFT_PROPERTY_VALUE,
              [GIFT_SELECTION_PROPERTY_KEY]: addedGiftSelectionId,
            },
          }],
        }),
      });
      const addData = await addResponse.json().catch(() => ({}));
      if (!addResponse.ok) {
        throw new Error(addData.description || "Unable to add this gift.");
      }
      giftAdded = true;

      // 3. Apply discount code — replace old GIFT-* codes with the new one
      const cart = await fetchCart();
      const nonGiftCodes = (cart.discount_codes || [])
        .filter((d) => d.applicable !== false && d.code && !d.code.startsWith("GIFT-"))
        .map((d) => d.code);
      const discountStr = [...nonGiftCodes, codeData.code].join(",");
      console.log("[Gift Widget] Applying discount:", discountStr);
      const updateResponse = await fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discount: discountStr,
        }),
      });
      const updateData = await updateResponse.json().catch(() => ({}));
      console.log("[Gift Widget] Update response status:", updateResponse.status);
      console.log("[Gift Widget] Cart discount_codes after update:", updateData.discount_codes);
      if (!updateResponse.ok) {
        console.error("[Gift Widget] Cart update failed:", updateData);
        throw new Error(updateData.description || "Unable to apply the gift discount.");
      }

      const giftCode = (updateData.discount_codes || []).find((discount) => discount.code === codeData.code);
      const updatedGiftQuantity = getGiftItems(updateData)
        .reduce((sum, item) => sum + item.quantity, 0);
      const freeGiftQuantity = getFreeGiftQuantity(updateData);
      if (
        !giftCode?.applicable ||
        freeGiftQuantity !== allGiftVariantIds.length
      ) {
        console.error("[Gift Widget] Gift discount was only partially applied:", {
          code: codeData.code,
          expectedGiftQuantity: allGiftVariantIds.length,
          updatedGiftQuantity,
          freeGiftQuantity,
          discountCodes: updateData.discount_codes,
        });
        throw new Error("The selected gift could not be made fully free.");
      }

      // 4. Refresh cart section
      await refreshCartSection();
    } catch (e) {
      if (giftAdded) {
        const cart = await fetchCart().catch(() => null);
        const addedGift = cart?.items.find(
          (item) => item.properties?.[GIFT_SELECTION_PROPERTY_KEY] === addedGiftSelectionId,
        );
        if (addedGift) {
          await removeGift(addedGift.key);
        }
      }
      console.error("[Gift Widget] Failed to add gift:", e);
      showNotification(e.message || "Unable to add this gift.", "warning");

      allButtons.forEach((btn) => { btn.disabled = false; });
      if (clickedLabel) clickedLabel.style.display = "";
      if (clickedSpinner) clickedSpinner.style.display = "none";
    } finally {
      isSelectingGift = false;
    }
  }

  async function removeGiftByKey(key) {
    const response = await fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: key, quantity: 0 }),
    });
    if (!response.ok) {
      throw new Error(`Unable to remove gift (${response.status}).`);
    }
    return response.json();
  }

  async function removeGift(key) {
    if (removingGiftKey) return;
    removingGiftKey = key;

    // Show spinner on the remove button
    const removeBtn = document.querySelector(`[data-gift-key="${key}"] .gift-widget__selected-remove`);
    if (removeBtn) {
      removeBtn.disabled = true;
      const label = removeBtn.querySelector(".gift-widget__remove-label");
      if (label) label.style.display = "none";
      // Add spinner if not already present
      if (!removeBtn.querySelector(".gift-widget__remove-spinner")) {
        const spinner = document.createElement("span");
        spinner.className = "gift-widget__remove-spinner";
        spinner.style.display = "inline-block";
        removeBtn.appendChild(spinner);
      }
    }

    try {
      await removeGiftByKey(key);

      // After removing, check if there are remaining gifts.
      // If so, create a new combined discount code for them.
      const updatedCart = await fetchCart();
      const remainingGifts = getGiftItems(updatedCart);

      if (remainingGifts.length > 0) {
        // Recreate the discount for the remaining gift-widget selections.
        const remainingGiftVariantIds = getGiftSelections(updatedCart)
          .map((item) => String(item.variant_id));
        const qualifyingVariantIds = updatedCart.items
          .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
          .map((item) => String(item.variant_id));

        const shopDomain =
          document.getElementById("gift-widget-container")?.dataset.shop || "";

        const codeResponse = await fetch(`${getAppUrl()}/gift-code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            giftVariantIds: remainingGiftVariantIds,
            tierId: lastActiveTierId,
            qualifyingVariantIds,
            shop: shopDomain,
          }),
        });
        const codeData = await codeResponse.json().catch(() => ({}));

        if (codeResponse.ok && codeData.code) {
          // Replace old GIFT-* codes with the new one
          const nonGiftCodes = (updatedCart.discount_codes || [])
            .filter((d) => d.applicable !== false && d.code && !d.code.startsWith("GIFT-"))
            .map((d) => d.code);
          await fetch("/cart/update.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              discount: [...nonGiftCodes, codeData.code].join(","),
            }),
          });
        }
      } else {
        // No gifts left — remove all GIFT-* codes
        const nonGiftCodes = (updatedCart.discount_codes || [])
          .filter((d) => d.applicable !== false && d.code && !d.code.startsWith("GIFT-"))
          .map((d) => d.code);
        if (nonGiftCodes.length > 0) {
          await fetch("/cart/update.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ discount: nonGiftCodes.join(",") }),
          });
        } else {
          // Clear all discount codes
          await fetch("/cart/update.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ discount: "" }),
          });
        }
      }

      await refreshCartSection();
    } catch (e) {
      console.error("[Gift Widget] Failed to remove gift:", e);
      showNotification("Unable to remove gift. Please try again.", "warning");
      if (removeBtn) {
        removeBtn.disabled = false;
        const label = removeBtn.querySelector(".gift-widget__remove-label");
        if (label) label.style.display = "";
        const spinner = removeBtn.querySelector(".gift-widget__remove-spinner");
        if (spinner) spinner.remove();
      }
    } finally {
      removingGiftKey = null;
    }
  }

  async function removeAllGifts(cart) {
    const gifts = getGiftItems(cart);
    for (const gift of gifts) {
      try {
        await removeGiftByKey(gift.key);
      } catch (e) {
        console.error("[Gift Widget] Failed to remove gift:", e);
      }
    }

    const updatedCart = await fetchCart();
    const nonGiftCodes = (updatedCart.discount_codes || [])
      .filter((discount) => discount.applicable !== false && discount.code && !discount.code.startsWith("GIFT-"))
      .map((discount) => discount.code);
    await fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discount: nonGiftCodes.join(",") }),
    });
  }

  // ─── Cart update listener ──────────────────────────────────

  /**
   * Intercept cart change requests to prevent quantity INCREASES on gift items.
   * Legitimate duplicates (same gift added twice → qty=2) are allowed.
   * Abuse (increasing qty from cart table) is blocked.
   * BXGY discountOnQuantity already limits free items server-side.
   */
  function interceptCartChanges() {
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      const body = init?.body;

      if (url.includes("/cart/change.js") || url.includes("/cart/update.js") || url.includes("/cart/add.js")) {
        const parsed = parseBody(body);
        if (parsed) {
          const cart = await fetchCart().catch(() => null);
          if (cart) {
            const giftKeys = new Set(getGiftItems(cart).map((item) => item.key));
            const giftVariantIds = new Set(getGiftItems(cart).map((item) => String(item.variant_id)));
            const giftQtyByKey = new Map(getGiftItems(cart).map((item) => [item.key, item.quantity]));

            // /cart/change.js with id (key) or line (1-based index)
            if (url.includes("/cart/change.js")) {
              // Block qty INCREASE on gift items (new qty > current qty)
              if (parsed.id && giftKeys.has(parsed.id)) {
                const currentQty = giftQtyByKey.get(parsed.id) || 0;
                if (parsed.quantity > currentQty) {
                  console.warn("[Gift Widget] Blocked qty increase on gift item");
                  showNotification("Gift quantity cannot be increased from cart. Use the gift selector to add more.", "warning");
                  return new Response(JSON.stringify(cart), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                  });
                }
              }
              // Dawn uses line (1-based index) + quantity
              if (parsed.line) {
                const lineIndex = parsed.line - 1;
                const item = cart.items[lineIndex];
                if (item && giftKeys.has(item.key)) {
                  const currentQty = giftQtyByKey.get(item.key) || 0;
                  if (parsed.quantity > currentQty) {
                    console.warn("[Gift Widget] Blocked qty increase (line)");
                    showNotification("Gift quantity cannot be increased from cart. Use the gift selector to add more.", "warning");
                    return new Response(JSON.stringify(cart), {
                      status: 200,
                      headers: { "Content-Type": "application/json" },
                    });
                  }
                }
              }
            }

            // /cart/update.js with updates array or object
            if (url.includes("/cart/update.js") && parsed.updates) {
              let modified = false;
              if (Array.isArray(parsed.updates)) {
                const newUpdates = [...parsed.updates];
                cart.items.forEach((item, index) => {
                  if (giftKeys.has(item.key) && newUpdates[index] > item.quantity) {
                    newUpdates[index] = item.quantity;
                    modified = true;
                  }
                });
                if (modified) {
                  showNotification("Gift quantity cannot be increased from cart.", "warning");
                  return originalFetch(input, { ...init, body: JSON.stringify({ ...parsed, updates: newUpdates }) });
                }
              } else if (typeof parsed.updates === "object") {
                const newUpdates = { ...parsed.updates };
                for (const key of Object.keys(newUpdates)) {
                  if (giftKeys.has(key)) {
                    const currentQty = giftQtyByKey.get(key) || 0;
                    if (newUpdates[key] > currentQty) {
                      newUpdates[key] = currentQty;
                      modified = true;
                    }
                  }
                }
                if (modified) {
                  showNotification("Gift quantity cannot be increased from cart.", "warning");
                  return originalFetch(input, { ...init, body: JSON.stringify({ ...parsed, updates: newUpdates }) });
                }
              }
            }

            // /cart/add.js — block adding with qty > 1 for existing gift variants
            if (url.includes("/cart/add.js") && parsed.items) {
              let modified = false;
              const newItems = parsed.items.map((item) => {
                if (giftVariantIds.has(String(item.id)) && item.quantity > 1) {
                  modified = true;
                  return { ...item, quantity: 1 };
                }
                return item;
              });
              if (modified) {
                showNotification("Gift items are limited to 1 quantity per add.", "warning");
                return originalFetch(input, { ...init, body: JSON.stringify({ ...parsed, items: newItems }) });
              }
            }
          }
        }
      }

      return originalFetch(input, init);
    };

    // ── 2. Intercept XMLHttpRequest ──
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._giftWidgetUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
      const url = this._giftWidgetUrl || "";
      if (url.includes("/cart/change.js") || url.includes("/cart/update.js")) {
        const parsed = parseBody(body);
        if (parsed) {
          // We need to check synchronously since XHR send is not async-friendly here
          // Store for async check
          this._giftWidgetBody = parsed;
          // Do a quick synchronous check using a cached cart if available
          // The real enforcement happens in onCartUpdate anyway
        }
      }
      return originalSend.call(this, body);
    };

    // ── 3. Intercept form submissions to /cart ──
    document.addEventListener("submit", async (e) => {
      const form = e.target;
      if (!form || !form.action) return;
      const action = form.getAttribute("action") || "";
      if (!action.includes("/cart")) return;

      // Check if this is a quantity update form
      const formData = new FormData(form);
      const updates = formData.get("updates[]") || formData.get("updates");
      if (!updates) return;

      const cart = await fetchCart().catch(() => null);
      if (!cart) return;

      const giftKeys = new Set(getGiftItems(cart).map((item) => item.key));
      const giftQtyByKey = new Map(getGiftItems(cart).map((item) => [item.key, item.quantity]));
      if (giftKeys.size === 0) return;

      // Check if any gift item quantity is being increased beyond current
      const updatesEntries = formData.getAll("updates[]");
      let hasAbuse = false;
      cart.items.forEach((item, index) => {
        if (giftKeys.has(item.key) && updatesEntries[index]) {
          const currentQty = giftQtyByKey.get(item.key) || 0;
          if (Number(updatesEntries[index]) > currentQty) {
            hasAbuse = true;
          }
        }
      });

      if (hasAbuse) {
        e.preventDefault();
        e.stopPropagation();
        showNotification("Gift quantity cannot be increased from cart.", "warning");
      }
    }, true);
  }

  function parseBody(body) {
    if (!body) return null;
    if (typeof body === "string") {
      try { return JSON.parse(body); } catch { return null; }
    }
    if (body instanceof FormData) {
      const obj = {};
      for (const [key, value] of body.entries()) {
        if (key.endsWith("[]")) {
          if (!obj[key]) obj[key] = [];
          obj[key].push(value);
        } else {
          obj[key] = value;
        }
      }
      return obj;
    }
    return null;
  }

  /**
   * Disable quantity inputs on gift line items in the cart DOM.
   * This prevents the user from even trying to increase the quantity.
   */
  function disableGiftQuantityInputs(cart) {
    const gifts = getGiftItems(cart);
    if (gifts.length === 0) return;

    const giftKeys = new Set(gifts.map((g) => g.key));
    const giftQtyByKey = new Map(gifts.map((g) => [g.key, g.quantity]));

    // Dawn cart page: quantity inputs inside cart-items
    const cartItems = document.querySelectorAll(
      "[data-id^='template--'][data-id*='cart-items'] .cart-item, " +
      "cart-drawer-items .cart-item, " +
      "form[action='/cart'] .cart-item"
    );

    cartItems.forEach((item) => {
      const removeLink = item.querySelector('cart-remove-button a[href*="/cart/change"]');
      let key = item.getAttribute("data-key") || item.getAttribute("data-line-key");
      if (!key && removeLink) {
        try {
          key = new URL(removeLink.href, window.location.origin).searchParams.get("id");
        } catch {}
      }

      if (key && giftKeys.has(key)) {
        const currentQty = (key && giftQtyByKey.get(key)) || 1;
        // Lock quantity inputs to current value — prevent increases
        const inputs = item.querySelectorAll("input[name='quantity'], input[name='updates[]'], .quantity__input, [data-quantity-input]");
        inputs.forEach((input) => {
          input.max = String(currentQty);
          input.min = "1";
          input.value = String(currentQty);
          input.setAttribute("readonly", "readonly");
        });
        // Disable only the + button, keep - button for removal
        const buttons = item.querySelectorAll(".quantity__button, [data-quantity-button]");
        buttons.forEach((btn) => {
          const isPlus = btn.name === "plus" ||
                         btn.classList.contains("quantity__button--plus") ||
                         btn.getAttribute("data-action") === "increment" ||
                         (btn.getAttribute("aria-label") || "").includes("Increase") ||
                         btn.querySelector(".icon-plus, [data-icon='plus']");
          if (isPlus) {
            btn.disabled = true;
            btn.style.pointerEvents = "none";
            btn.style.opacity = "0.5";
          }
        });
      }
    });
  }

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
        if (isSelectingGift || removingGiftKey) return;
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

    const cartItemsContainer =
      document.querySelector("[data-id^='template--'][data-id*='cart-items']") ||
      document.querySelector("#cart") ||
      document.querySelector("form[action='/cart']") ||
      document.querySelector("cart-drawer-items");

    if (cartItemsContainer && typeof MutationObserver !== "undefined") {
      let observerDebounce = null;
      const observer = new MutationObserver(() => {
        if (isRefreshingSection || isSelectingGift || removingGiftKey) return;
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

  function getAppUrl() { return "/apps/gift-threshold"; }
  function getFetchHeaders() { return { Accept: "application/json" }; }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: getFetchHeaders() });
    const contentType = response.headers.get("content-type") || "unknown";
    const body = await response.text();
    const normalizedBody = body.replace(/^\uFEFF/, "").trim();
    if (!response.ok || normalizedBody.startsWith("<")) {
      throw new Error(`Expected JSON from ${url}, received ${response.status} ${contentType} at ${response.url}`);
    }
    try {
      return JSON.parse(normalizedBody);
    } catch {
      throw new Error(`Invalid JSON from ${url}, received ${response.status} ${contentType} at ${response.url}`);
    }
  }

  function formatPrice(cents) {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
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

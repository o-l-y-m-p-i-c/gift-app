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

  function getTotalGiftValue(cart) {
    return getGiftItems(cart).reduce((sum, item) => sum + item.final_line_price, 0);
  }

  function getThresholdBase(cart) {
    const giftTotal = getTotalGiftValue(cart);
    const base = settings.useTotalAfterDiscounts
      ? cart.total_price
      : cart.items_subtotal_price;
    return base - giftTotal;
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
    const totalGiftValue = giftItems.reduce((sum, item) => sum + item.final_line_price, 0);
    const remainingBudget = activeTier ? activeTier.giftAmount - totalGiftValue : 0;

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

    const giftItems = getGiftItems(cart);
    const totalGiftValue = giftItems.reduce((sum, item) => sum + item.final_line_price, 0);
    const remainingBudget = activeTier ? activeTier.giftAmount - totalGiftValue : 0;

    // ── Progress bar section ──
    let progressHtml = "";

    if (activeTier && nextTier) {
      // Between current and next tier
      const rangeStart = activeTier.minAmount;
      const rangeEnd = nextTier.minAmount;
      const progressPct = Math.min(
        100,
        Math.max(0,
          ((thresholdBase - rangeStart) / (rangeEnd - rangeStart)) * 100,
        ),
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
              <p class="gift-widget__selected-price">${formatPrice(item.final_line_price)}</p>
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
    const shopDomain =
      document.getElementById("gift-widget-container")?.dataset.shop || "";

    try {
      const initialCart = await fetchCart();
      const qualifyingVariantIds = initialCart.items
        .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id));

      // Collect ALL gift variant IDs: existing gifts + the new one
      const existingGiftVariantIds = initialCart.items
        .filter((item) => item.properties?.[GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id));
      const allGiftVariantIds = [...new Set([...existingGiftVariantIds, variantId])];

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

      // 2. Add gift to cart
      const addResponse = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{
            id: Number(variantId),
            quantity: 1,
            properties: { [GIFT_PROPERTY_KEY]: GIFT_PROPERTY_VALUE },
          }],
        }),
      });
      if (!addResponse.ok) {
        const error = await addResponse.json().catch(() => ({}));
        throw new Error(error.description || "Unable to add this gift.");
      }
      giftAdded = true;

      // 3. Apply discount code — replace old GIFT-* codes with the new combined one
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

      // 4. Refresh cart section
      await refreshCartSection();
    } catch (e) {
      if (giftAdded) {
        const cart = await fetchCart().catch(() => null);
        if (cart) {
          await removeGiftByKey(variantId);
          await refreshCartSection();
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
        // Recreate discount code for remaining gifts
        const remainingGiftVariantIds = remainingGifts.map((g) => String(g.variant_id));
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

/**
 * Gift Core — Shared runtime for gift eligibility, budget calculation,
 * and BXGY discount workflow.
 *
 * Used by:
 *   - gift-widget.js      (cart page)
 *   - product-gift-button.js (product page)
 *
 * Public API (window.giftApp):
 *   getCartState()              → { cart, thresholdBase, activeTier, nextTier, totalGiftValue, remainingBudget, giftSelections, freeGiftQuantity }
 *   getEligibility(variantId)   → { eligible, reason, tierId, giftBudget, usedBudget, remainingBudget, variantPrice, variantAvailable }
 *   addGift(variantId, tierId)  → { ok, selectionId, giftQuantity, totalGiftValue } | { ok:false, error }
 *   removeGift(selectionId)     → { ok } | { ok:false, error }
 *   refresh()                   → re-fetch config + cart and dispatch cart:updated
 *   onCartUpdate(cb)            → subscribe to cart updates
 *
 * The runtime is idempotent: loading it twice is a no-op.
 */
(function () {
  if (window.giftApp && window.giftApp._initialized) return;

  const GIFT_PROPERTY_KEY = "_gift";
  const GIFT_PROPERTY_VALUE = "true";
  const GIFT_SELECTION_PROPERTY_KEY = "_gift_selection";

  let tiers = [];
  let settings = {
    useTotalAfterDiscounts: true,
    showLevelUpNotification: true,
    showRemovalNotification: true,
  };
  let configLoaded = false;
  let configLoading = null;
  let cartRequest = null;
  let mutationLock = false;
  const cartUpdateSubscribers = [];

  // ─── Config loading ────────────────────────────────────────

  function getAppUrl() { return "/apps/gift-threshold"; }

  function getShopDomain() {
    const el =
      document.getElementById("gift-widget-container") ||
      document.getElementById("add-as-gift-container");
    return el?.dataset.shop || "";
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
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

  async function ensureConfig() {
    if (configLoaded) return;
    if (configLoading) return configLoading;

    configLoading = (async () => {
      const shopDomain = getShopDomain();
      const appUrl = getAppUrl();
      const [tiersData, settingsData] = await Promise.all([
        fetchJson(`${appUrl}/tiers?shop=${shopDomain}`),
        fetchJson(`${appUrl}/settings?shop=${shopDomain}`),
      ]);
      tiers = (tiersData.tiers || []).sort((a, b) => a.minAmount - b.minAmount);
      settings = settingsData.settings || settings;
      configLoaded = true;
    })();

    return configLoading;
  }

  // ─── Cart helpers ──────────────────────────────────────────

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

  // ─── Cart state ─────────────────────────────────────────────

  async function getCartState() {
    await ensureConfig().catch(() => {});
    const cart = await fetchCart();
    return computeCartState(cart);
  }

  function computeCartState(cart) {
    const thresholdBase = getThresholdBase(cart);
    const activeTier = findActiveTier(thresholdBase);
    const nextTier = findNextTier(thresholdBase);
    const giftSelections = getGiftSelections(cart);
    const totalGiftValue = getTotalGiftValue(cart);
    const remainingBudget = activeTier ? Math.max(0, activeTier.giftAmount - totalGiftValue) : 0;
    const freeGiftQuantity = getFreeGiftQuantity(cart);

    return {
      cart,
      thresholdBase,
      activeTier,
      nextTier,
      giftSelections,
      totalGiftValue,
      remainingBudget,
      freeGiftQuantity,
      giftSelectionCount: giftSelections.length,
    };
  }

  // ─── Eligibility ───────────────────────────────────────────

  async function getEligibility(variantId) {
    const state = await getCartState();
    const variantIdStr = String(variantId);

    if (!state.activeTier) {
      const firstTier = tiers[0];
      const amountToFirst = firstTier ? Math.max(0, firstTier.minAmount - state.thresholdBase) : 0;
      return {
        eligible: false,
        reason: "no_tier",
        amountToUnlock: amountToFirst,
        thresholdBase: state.thresholdBase,
      };
    }

    // Look up variant price/availability from /products.json
    let variantPrice = null;
    let variantAvailable = null;
    try {
      const variantInfo = await lookupVariant(variantIdStr);
      variantPrice = variantInfo?.price ?? null;
      variantAvailable = variantInfo?.available ?? null;
    } catch {
      // If lookup fails, leave null — backend will still validate
    }

    if (variantAvailable === false) {
      return {
        eligible: false,
        reason: "unavailable",
        tierId: state.activeTier.id,
        giftBudget: state.activeTier.giftAmount,
        usedBudget: state.totalGiftValue,
        remainingBudget: state.remainingBudget,
        variantPrice,
      };
    }

    if (variantPrice !== null && variantPrice > state.remainingBudget) {
      return {
        eligible: false,
        reason: "over_budget",
        tierId: state.activeTier.id,
        giftBudget: state.activeTier.giftAmount,
        usedBudget: state.totalGiftValue,
        remainingBudget: state.remainingBudget,
        variantPrice,
      };
    }

    if (mutationLock) {
      return {
        eligible: false,
        reason: "busy",
        tierId: state.activeTier.id,
        giftBudget: state.activeTier.giftAmount,
        usedBudget: state.totalGiftValue,
        remainingBudget: state.remainingBudget,
        variantPrice,
      };
    }

    // Local check passed — verify exclusions with backend
    try {
      const shopDomain = getShopDomain();
      const giftSelections = getGiftSelections(state.cart)
        .map((item) => item.variant_id)
        .join(",");
      const url = `${getAppUrl()}/gift-eligibility?shop=${encodeURIComponent(shopDomain)}&variantId=${variantIdStr}${giftSelections ? `&giftSelections=${giftSelections}` : ""}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const backendResult = await res.json();
        // Backend is authoritative for exclusions
        if (!backendResult.eligible && backendResult.reason === "excluded_collection") {
          return {
            eligible: false,
            reason: "excluded_collection",
            variantPrice: backendResult.variantPrice ?? variantPrice,
          };
        }
        if (!backendResult.eligible && backendResult.reason === "excluded_tag") {
          return {
            eligible: false,
            reason: "excluded_tag",
            variantPrice: backendResult.variantPrice ?? variantPrice,
          };
        }
        // Use backend values if more accurate
        if (backendResult.remainingBudget != null) {
          return backendResult;
        }
      }
    } catch (e) {
      console.warn("[gift-core] Backend eligibility check failed, using local result:", e);
    }

    return {
      eligible: true,
      reason: "ok",
      tierId: state.activeTier.id,
      giftBudget: state.activeTier.giftAmount,
      usedBudget: state.totalGiftValue,
      remainingBudget: state.remainingBudget,
      variantPrice,
    };
  }

  /**
   * Look up a single variant's price and availability via /products.json.
   * Returns { price: number (cents), available: boolean } or null.
   */
  async function lookupVariant(variantId) {
    const targetId = String(variantId);
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
      for (const product of products) {
        for (const variant of product.variants || []) {
          if (String(variant.id) === targetId) {
            const priceCents = Math.round(parseFloat(variant.price || "0") * 100);
            return {
              price: priceCents,
              available: variant.available !== false,
              title: variant.title === "Default Title" ? product.title : `${product.title} — ${variant.title}`,
              image: product.images?.[0]?.src || "",
            };
          }
        }
      }
      if (products.length < perPage) break;
      page++;
    }
    return null;
  }

  // ─── Gift add/remove workflow ───────────────────────────────

  function generateSelectionId() {
    if (typeof window.crypto?.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function addGift(variantId, tierId) {
    if (mutationLock) {
      return { ok: false, error: "A gift operation is already in progress." };
    }
    mutationLock = true;

    const variantIdStr = String(variantId);
    const shopDomain = getShopDomain();
    let giftAdded = false;
    let addedSelectionId = null;

    try {
      await ensureConfig();

      const initialCart = await fetchCart();
      const qualifyingVariantIds = initialCart.items
        .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id));

      // Collect one variant ID per authorized gift selection plus the new selection.
      const existingGiftVariantIds = getGiftSelections(initialCart)
        .map((item) => String(item.variant_id));
      const allGiftVariantIds = [...existingGiftVariantIds, variantIdStr];

      // 1. Request a single BXGY discount code covering ALL gifts
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
      addedSelectionId = generateSelectionId();
      const addResponse = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{
            id: Number(variantIdStr),
            quantity: 1,
            properties: {
              [GIFT_PROPERTY_KEY]: GIFT_PROPERTY_VALUE,
              [GIFT_SELECTION_PROPERTY_KEY]: addedSelectionId,
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
      const updateResponse = await fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discount: discountStr }),
      });
      const updateData = await updateResponse.json().catch(() => ({}));
      if (!updateResponse.ok) {
        throw new Error(updateData.description || "Unable to apply the gift discount.");
      }

      // 4. Verify the gift is fully free
      const giftCode = (updateData.discount_codes || []).find((d) => d.code === codeData.code);
      const freeGiftQuantity = getFreeGiftQuantity(updateData);
      if (!giftCode?.applicable || freeGiftQuantity !== allGiftVariantIds.length) {
        throw new Error("The selected gift could not be made fully free.");
      }

      // 5. Dispatch cart updated events
      dispatchCartUpdated(updateData);

      return {
        ok: true,
        selectionId: addedSelectionId,
        giftQuantity: codeData.giftQuantity,
        totalGiftValue: codeData.totalGiftValue,
        cart: updateData,
      };
    } catch (e) {
      // Rollback: remove the added gift line if it was added
      if (giftAdded && addedSelectionId) {
        const cart = await fetchCart().catch(() => null);
        const addedGift = cart?.items.find(
          (item) => item.properties?.[GIFT_SELECTION_PROPERTY_KEY] === addedSelectionId,
        );
        if (addedGift) {
          await removeGiftByKey(addedGift.key).catch(() => {});
          dispatchCartUpdated(await fetchCart().catch(() => ({})));
        }
      }
      return { ok: false, error: e.message || "Unable to add this gift." };
    } finally {
      mutationLock = false;
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

  /**
   * Remove a gift by its _gift_selection ID or cart line key.
   * After removal, recreates the BXGY code for remaining gifts
   * or clears GIFT-* codes if no gifts remain.
   */
  async function removeGift(selectionIdOrKey) {
    if (mutationLock) {
      return { ok: false, error: "A gift operation is already in progress." };
    }
    mutationLock = true;

    try {
      await ensureConfig();

      const cart = await fetchCart();
      const giftItems = getGiftItems(cart);

      // Find the gift line by selection ID or key
      let targetKey = null;
      for (const item of giftItems) {
        const sel = item.properties?.[GIFT_SELECTION_PROPERTY_KEY];
        if (sel === selectionIdOrKey || item.key === selectionIdOrKey) {
          targetKey = item.key;
          break;
        }
      }
      if (!targetKey) {
        return { ok: false, error: "Gift not found in cart." };
      }

      await removeGiftByKey(targetKey);

      // After removing, check remaining gifts and recreate the discount code
      const updatedCart = await fetchCart();
      const remainingGifts = getGiftItems(updatedCart);

      if (remainingGifts.length > 0) {
        const remainingGiftVariantIds = getGiftSelections(updatedCart)
          .map((item) => String(item.variant_id));
        const qualifyingVariantIds = updatedCart.items
          .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
          .map((item) => String(item.variant_id));
        const shopDomain = getShopDomain();

        // Determine current active tier for the code request
        const state = computeCartState(updatedCart);
        const tierId = state.activeTier?.id;

        if (tierId && qualifyingVariantIds.length > 0) {
          const codeResponse = await fetch(`${getAppUrl()}/gift-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              giftVariantIds: remainingGiftVariantIds,
              tierId,
              qualifyingVariantIds,
              shop: shopDomain,
            }),
          });
          const codeData = await codeResponse.json().catch(() => ({}));

          if (codeResponse.ok && codeData.code) {
            const nonGiftCodes = (updatedCart.discount_codes || [])
              .filter((d) => d.applicable !== false && d.code && !d.code.startsWith("GIFT-"))
              .map((d) => d.code);
            await fetch("/cart/update.js", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ discount: [...nonGiftCodes, codeData.code].join(",") }),
            });
          }
        }
      } else {
        // No gifts left — remove all GIFT-* codes
        const nonGiftCodes = (updatedCart.discount_codes || [])
          .filter((d) => d.applicable !== false && d.code && !d.code.startsWith("GIFT-"))
          .map((d) => d.code);
        await fetch("/cart/update.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discount: nonGiftCodes.join(",") }),
        });
      }

      const finalCart = await fetchCart();
      dispatchCartUpdated(finalCart);
      return { ok: true, cart: finalCart };
    } catch (e) {
      return { ok: false, error: e.message || "Unable to remove gift." };
    } finally {
      mutationLock = false;
    }
  }

  // ─── Cart update dispatch ───────────────────────────────────

  function dispatchCartUpdated(cart) {
    const detail = { cart };
    document.dispatchEvent(new CustomEvent("cart:refresh", { detail }));
    document.dispatchEvent(new CustomEvent("cart:updated", { detail }));
    document.dispatchEvent(new CustomEvent("cart:change", { detail }));
    for (const cb of cartUpdateSubscribers) {
      try { cb(cart); } catch (e) { console.warn("[gift-core] subscriber error:", e); }
    }
    // Refresh Dawn storefront sections (cart drawer + cart icon bubble)
    refreshDawnSections(cart);
  }

  /**
   * Refresh Dawn theme storefront sections after a cart mutation.
   * Dawn's cart drawer and cart-icon-bubble are rendered as sections
   * and don't react to cart:updated events — they need to be re-fetched
   * and swapped into the DOM.
   */
  async function refreshDawnSections(cart) {
    // Cart icon bubble (header cart count)
    try {
      const bubble = document.getElementById("cart-icon-bubble");
      if (bubble) {
        // Dawn uses the "sections" parameter which returns JSON with section HTML.
        // Fall back to "section_id" which returns raw HTML.
        let bubbleHtml = null;
        try {
          const res = await fetch("/cart?sections=cart-icon-bubble", {
            headers: { Accept: "application/json" },
          });
          if (res.ok) {
            const data = await res.json();
            bubbleHtml = data?.["cart-icon-bubble"] || null;
          }
        } catch {}

        if (!bubbleHtml) {
          const res = await fetch("/cart?section_id=cart-icon-bubble", {
            headers: { Accept: "text/html" },
          });
          if (res.ok) {
            bubbleHtml = await res.text();
          }
        }

        if (bubbleHtml) {
          const doc = new DOMParser().parseFromString(bubbleHtml, "text/html");
          const newBubble = doc.querySelector("#cart-icon-bubble");
          if (newBubble) {
            bubble.innerHTML = newBubble.innerHTML;
          } else {
            // Section HTML may be the inner content directly
            bubble.innerHTML = bubbleHtml;
          }
        }
      }
    } catch (e) {
      console.warn("[gift-core] Cart icon bubble refresh failed:", e);
    }

    // Cart drawer items
    try {
      const drawerItems = document.querySelector("cart-drawer-items");
      if (drawerItems) {
        let drawerHtml = null;
        try {
          const res = await fetch("/cart?sections=cart-drawer", {
            headers: { Accept: "application/json" },
          });
          if (res.ok) {
            const data = await res.json();
            drawerHtml = data?.["cart-drawer"] || null;
          }
        } catch {}

        if (!drawerHtml) {
          const res = await fetch("/cart?section_id=cart-drawer", {
            headers: { Accept: "text/html" },
          });
          if (res.ok) {
            drawerHtml = await res.text();
          }
        }

        if (drawerHtml) {
          const doc = new DOMParser().parseFromString(drawerHtml, "text/html");
          const newDrawer = doc.querySelector("cart-drawer-items");
          if (newDrawer) {
            drawerItems.innerHTML = newDrawer.innerHTML;
          } else {
            drawerItems.innerHTML = drawerHtml;
          }
        }
      }
    } catch (e) {
      console.warn("[gift-core] Cart drawer refresh failed:", e);
    }

    // Re-init gift widget in all containers after section swaps
    if (window.giftWidget && typeof window.giftWidget._init === "function") {
      try { await window.giftWidget._init(); } catch (e) {
        console.warn("[gift-core] Gift widget re-init failed:", e);
      }
    }

    // Cart page items (if on /cart)
    try {
      const cartItemsDiv = document.querySelector(
        "[data-id^='template--'][data-id*='cart-items']",
      );
      const sectionId = cartItemsDiv?.getAttribute("data-id");
      if (sectionId) {
        const res = await fetch(`${window.location.pathname}?section_id=${sectionId}`, {
          headers: { Accept: "text/html" },
        });
        if (res.ok) {
          const text = await res.text();
          const doc = new DOMParser().parseFromString(text, "text/html");
          const newItems = doc.querySelector(`[data-id="${sectionId}"]`);
          const oldItems = document.querySelector(`[data-id="${sectionId}"]`);
          if (newItems && oldItems) {
            oldItems.innerHTML = newItems.innerHTML;
          }
        }
      }
    } catch (e) {
      console.warn("[gift-core] Cart page section refresh failed:", e);
    }
  }

  function onCartUpdate(cb) {
    cartUpdateSubscribers.push(cb);
    return () => {
      const idx = cartUpdateSubscribers.indexOf(cb);
      if (idx >= 0) cartUpdateSubscribers.splice(idx, 1);
    };
  }

  async function refresh() {
    configLoaded = false;
    configLoading = null;
    await ensureConfig().catch(() => {});
    const cart = await fetchCart();
    dispatchCartUpdated(cart);
    return computeCartState(cart);
  }

  // ─── Public API ─────────────────────────────────────────────

  window.giftApp = {
    _initialized: true,
    // Constants exposed for UI scripts
    GIFT_PROPERTY_KEY,
    GIFT_PROPERTY_VALUE,
    GIFT_SELECTION_PROPERTY_KEY,
    // Config
    ensureConfig,
    getTiers: () => tiers,
    getSettings: () => settings,
    getShopDomain,
    // Cart helpers (also exposed for UI scripts that need them)
    fetchCart,
    getGiftItems,
    getGiftSelections,
    getOriginalUnitPrice,
    getOriginalLinePrice,
    getFinalLinePrice,
    getTotalGiftValue,
    getFreeGiftQuantity,
    getThresholdBase,
    findActiveTier,
    findNextTier,
    computeCartState,
    // Public API
    getCartState,
    getEligibility,
    addGift,
    removeGift,
    removeGiftByKey,
    refresh,
    onCartUpdate,
    // Utility
    formatPrice(cents) {
      return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
    },
    isMutationLocked: () => mutationLock,
  };
})();

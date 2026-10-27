/**
 * Gift Core — Shared runtime for gift eligibility, budget calculation,
 * the BXGY discount workflow and theme cart refreshes.
 *
 * Used by:
 *   - gift-widget.js         (cart page block)
 *   - gift-drawer.js         (cart drawer block / app embed)
 *   - product-gift-button.js (product page block)
 *
 * Theme independence:
 *   - URLs are built from window.Shopify.routes.root (locale/market folders).
 *   - Prices use the customer's currency (window.Shopify.currency), tier and
 *     product amounts from the app are converted with Shopify.currency.rate.
 *   - After a gift change, cart sections are re-rendered through the Section
 *     Rendering API using the section wrappers found on the page, so no
 *     theme-specific selectors are needed. Merchants can switch the refresh
 *     mode or add section IDs in the block settings.
 *   - window.fetch is wrapped once, chaining any previous wrapper.
 *
 * Public API (window.giftApp):
 *   getCartState()                     → { cart, thresholdBase, activeTier, nextTier, ... }
 *   getEligibility(variantId, variant) → { eligible, reason, tierId, giftBudget, remainingBudget, ... }
 *   addGift(variantId, tierId)         → { ok, selectionId, ... } | { ok:false, error }
 *   removeGift(selectionId)            → { ok } | { ok:false, error }
 *   refreshCart(cart)                  → re-render theme cart sections + dispatch events
 *   onCartUpdate(cb) / onCartMutation(cb)
 *
 * Events dispatched on document after every gift change:
 *   gift:cart-updated, cart:refresh, cart:updated, cart:change  (detail: { cart })
 *
 * The runtime is idempotent: loading it twice is a no-op.
 */
(function () {
  if (window.giftApp && window.giftApp._initialized) return;

  const GIFT_PROPERTY_KEY = "_gift";
  const GIFT_PROPERTY_VALUE = "true";
  const GIFT_SELECTION_PROPERTY_KEY = "_gift_selection";
  const GIFT_CODE_PREFIXES = ["BONUS-", "GIFT-"];
  const DEFAULT_PROXY_PATH = "/apps/gift-threshold";

  let tiers = [];
  let settings = {
    active: true,
    useTotalAfterDiscounts: true,
    showLevelUpNotification: true,
    showRemovalNotification: true,
  };
  let configLoaded = false;
  let configLoading = null;
  let cartRequest = null;
  let lastCart = null;
  let mutationLock = false;
  const promoCompatibilityCache = new Map();
  const cartUpdateSubscribers = [];
  const cartMutationSubscribers = [];

  // The fetch captured before any wrapping — used for the app's own
  // requests so they never trigger the cart watcher.
  const nativeFetch = window.fetch.bind(window);

  // ─── Block settings ────────────────────────────────────────

  /** Settings shared by all blocks, read from the first app block on the page. */
  function getConfig() {
    const el = document.querySelector("[data-gift-app]");
    const data = el?.dataset || {};
    return {
      shop: data.shop || "",
      proxyPath: (data.proxyPath || DEFAULT_PROXY_PATH).replace(/\/$/, ""),
      moneyFormat: data.moneyFormat || "",
      shopCurrency: data.shopCurrency || "",
      refreshMode: data.refreshMode || "auto",
      refreshSections: (data.refreshSections || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    };
  }

  function getShopDomain() {
    return getConfig().shop;
  }

  // ─── Routes ────────────────────────────────────────────────

  function routeRoot() {
    const root = window.Shopify?.routes?.root || "/";
    return root.endsWith("/") ? root : `${root}/`;
  }

  /** Storefront URL that respects locale and market subfolders, e.g. "/fr/cart". */
  function storefrontUrl(path) {
    return routeRoot() + path.replace(/^\//, "");
  }

  function appUrl(path) {
    return `${getConfig().proxyPath}/${path.replace(/^\//, "")}`;
  }

  function isCartPage() {
    return /\/cart\/?$/.test(window.location.pathname);
  }

  // ─── Currency ──────────────────────────────────────────────

  /** Shop currency → customer currency conversion rate. */
  function currencyRate() {
    const rate = parseFloat(window.Shopify?.currency?.rate || "1");
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }

  function activeCurrency() {
    return window.Shopify?.currency?.active || getConfig().shopCurrency || "USD";
  }

  /** Convert an amount in shop-currency cents to the customer's currency. */
  function toPresentment(cents) {
    return Math.round(cents * currencyRate());
  }

  /** Convert an amount in customer-currency cents back to the shop currency. */
  function toShopCurrency(cents) {
    return Math.floor(cents / currencyRate());
  }

  function formatWithDelimiters(cents, precision, thousands = ",", decimal = ".") {
    const value = (cents / 100).toFixed(precision);
    const [whole, fraction] = value.split(".");
    const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return fraction ? withThousands + decimal + fraction : withThousands;
  }

  /** Shopify money_format placeholders, e.g. "${{amount}}" or "{{amount_with_comma_separator}} €". */
  function formatShopMoney(cents, format) {
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, placeholder) => {
      switch (placeholder) {
        case "amount_no_decimals": return formatWithDelimiters(cents, 0);
        case "amount_with_comma_separator": return formatWithDelimiters(cents, 2, ".", ",");
        case "amount_no_decimals_with_comma_separator": return formatWithDelimiters(cents, 0, ".", ",");
        case "amount_with_apostrophe_separator": return formatWithDelimiters(cents, 2, "'", ".");
        case "amount_with_space_separator": return formatWithDelimiters(cents, 2, " ", ",");
        case "amount_no_decimals_with_space_separator": return formatWithDelimiters(cents, 0, " ", ",");
        default: return formatWithDelimiters(cents, 2);
      }
    });
  }

  /** Format customer-currency cents for display. */
  function formatPrice(cents) {
    const { moneyFormat, shopCurrency } = getConfig();
    const currency = activeCurrency();
    // The shop's money format is only valid for the shop currency.
    if (moneyFormat && (!shopCurrency || shopCurrency === currency)) {
      return formatShopMoney(cents, decodeHtml(moneyFormat).replace(/<[^>]*>/g, ""));
    }
    const locale = document.documentElement.lang || navigator.language || "en";
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  }

  // ─── Utils ─────────────────────────────────────────────────

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Liquid's `t` filter returns HTML-escaped text ("isn&#39;t"). Decode it
   * once so the widgets can escape it again safely when rendering.
   */
  function decodeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(value ?? "");
    return textarea.value;
  }

  /** Parse a translations JSON script tag into decoded strings. */
  function readTranslations(el) {
    try {
      const raw = JSON.parse(el?.textContent || "{}");
      return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, decodeHtml(value)]));
    } catch (e) {
      console.warn("[gift-core] Failed to parse translations:", e);
      return {};
    }
  }

  async function fetchJson(url) {
    const response = await nativeFetch(url, { headers: { Accept: "application/json" } });
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

  function cartPost(path, body) {
    return nativeFetch(storefrontUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ─── Config loading ────────────────────────────────────────

  async function ensureConfig() {
    if (configLoaded) return;
    if (configLoading) return configLoading;

    configLoading = (async () => {
      const [tiersData, settingsData] = await Promise.all([
        fetchJson(appUrl("tiers")),
        fetchJson(appUrl("settings")),
      ]);
      // Tiers come in the shop currency; work in the customer's currency.
      tiers = (tiersData.tiers || [])
        .map((tier) => ({
          ...tier,
          shopMinAmount: tier.minAmount,
          shopGiftAmount: tier.giftAmount,
          minAmount: toPresentment(tier.minAmount),
          giftAmount: toPresentment(tier.giftAmount),
        }))
        .sort((a, b) => a.minAmount - b.minAmount);
      settings = settingsData.settings || settings;
      configLoaded = true;
    })();

    try {
      return await configLoading;
    } catch (error) {
      configLoading = null;
      throw error;
    }
  }

  // ─── Cart helpers ──────────────────────────────────────────

  async function fetchCart() {
    if (cartRequest) return cartRequest;
    cartRequest = nativeFetch(storefrontUrl("cart.js"), { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load cart (${response.status}).`);
        lastCart = await response.json();
        return lastCart;
      });
    try {
      return await cartRequest;
    } finally {
      cartRequest = null;
    }
  }

  function isGiftCode(code) {
    return GIFT_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
  }

  function getExternalDiscountCodes(cart) {
    return (cart?.discount_codes || [])
      .filter((discount) => discount.applicable !== false && discount.code && !isGiftCode(discount.code))
      .map((discount) => discount.code);
  }

  async function externalDiscountsAreCompatible(codes) {
    const unresolved = codes.filter((code) => !promoCompatibilityCache.has(code));
    if (unresolved.length > 0) {
      try {
        const params = new URLSearchParams({ codes: unresolved.join(",") });
        const data = await fetchJson(`${appUrl("promo-compatibility")}?${params}`);
        for (const discount of data.discounts || []) {
          promoCompatibilityCache.set(
            discount.code,
            discount.found === true && discount.productDiscounts === true,
          );
        }
      } catch (error) {
        console.warn("[gift-core] Promo compatibility check failed:", error);
      }
    }
    return codes.every((code) => promoCompatibilityCache.get(code) === true);
  }

  function getGiftItems(cart) {
    return (cart?.items || []).filter(
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
    return (cart?.items || [])
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
    const activeTier = settings.active ? findActiveTier(thresholdBase) : null;
    const nextTier = settings.active ? findNextTier(thresholdBase) : null;
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

  // ─── Gift products ─────────────────────────────────────────

  const productCache = new Map();
  const PRODUCT_CACHE_TTL = 5 * 60 * 1000;

  /**
   * Gift products the customer can afford with `maxPrice` (customer-currency
   * cents). Prices in the result are converted to the customer's currency.
   */
  async function fetchGiftProducts(maxPrice, excludeVariantIds = new Set(), limit = 50) {
    const shopMaxPrice = toShopCurrency(maxPrice);
    if (shopMaxPrice <= 0) return [];
    const cacheKey = `${shopMaxPrice}:${limit}`;
    const cached = productCache.get(cacheKey);
    let products = cached && cached.expiresAt > Date.now() ? cached.products : null;

    if (!products) {
      const params = new URLSearchParams({ maxPrice: String(shopMaxPrice), limit: String(limit) });
      const data = await fetchJson(`${appUrl("products")}?${params}`);
      products = (data.products || []).map((product) => ({
        ...product,
        price: toPresentment(product.price),
      }));
      if (products.length > 0) {
        productCache.set(cacheKey, { expiresAt: Date.now() + PRODUCT_CACHE_TTL, products });
      }
    }

    return products.filter(
      (product) => product.price <= maxPrice && !excludeVariantIds.has(String(product.variantId)),
    );
  }

  // ─── Eligibility ───────────────────────────────────────────

  /**
   * @param variantId
   * @param variant optional { price (customer-currency cents), available } known
   *   from the page, e.g. the product block's variant JSON.
   */
  async function getEligibility(variantId, variant = null) {
    const state = await getCartState();
    const variantIdStr = String(variantId);

    if (!settings.active) {
      return { eligible: false, reason: "disabled", thresholdBase: state.thresholdBase };
    }

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

    const variantPrice = variant?.price ?? null;
    const base = {
      tierId: state.activeTier.id,
      giftBudget: state.activeTier.giftAmount,
      usedBudget: state.totalGiftValue,
      remainingBudget: state.remainingBudget,
      variantPrice,
    };

    if (variant?.available === false) return { ...base, eligible: false, reason: "unavailable" };
    if (variantPrice !== null && variantPrice > state.remainingBudget) {
      return { ...base, eligible: false, reason: "over_budget" };
    }
    if (mutationLock) return { ...base, eligible: false, reason: "busy" };

    // The backend is authoritative for availability, exclusions and price.
    try {
      const giftSelections = getGiftSelections(state.cart)
        .map((item) => item.variant_id)
        .join(",");
      const params = new URLSearchParams({ variantId: variantIdStr });
      if (giftSelections) params.set("giftSelections", giftSelections);
      const backend = await fetchJson(`${appUrl("gift-eligibility")}?${params}`);
      const backendPrice = backend.variantPrice != null ? toPresentment(backend.variantPrice) : variantPrice;

      if (!backend.eligible && ["excluded_collection", "excluded_tag", "unavailable", "disabled"].includes(backend.reason)) {
        return { ...base, eligible: false, reason: backend.reason, variantPrice: backendPrice };
      }
      // Budgets come from the cart total, which only the browser knows.
      if (backendPrice !== null && backendPrice > state.remainingBudget) {
        return { ...base, eligible: false, reason: "over_budget", variantPrice: backendPrice };
      }
      return { ...base, eligible: true, reason: "ok", variantPrice: backendPrice };
    } catch (e) {
      console.warn("[gift-core] Backend eligibility check failed, using local result:", e);
    }

    return { ...base, eligible: true, reason: "ok" };
  }

  // ─── Gift add/remove workflow ───────────────────────────────

  function generateSelectionId() {
    if (typeof window.crypto?.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function requestPromoChoice({ title, message, keepLabel, useGiftLabel }) {
    document.querySelector(".gift-promo-choice")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "gift-promo-choice";
    overlay.innerHTML = `
      <div class="gift-promo-choice__dialog" role="dialog" aria-modal="true" aria-labelledby="gift-promo-choice-title">
        <h2 class="gift-promo-choice__title" id="gift-promo-choice-title"></h2>
        <p class="gift-promo-choice__message"></p>
        <div class="gift-promo-choice__actions">
          <button type="button" class="gift-promo-choice__button gift-promo-choice__button--keep"></button>
          <button type="button" class="gift-promo-choice__button gift-promo-choice__button--gift"></button>
        </div>
      </div>
    `;
    overlay.querySelector(".gift-promo-choice__title").textContent = title;
    overlay.querySelector(".gift-promo-choice__message").textContent = message;
    const keepButton = overlay.querySelector(".gift-promo-choice__button--keep");
    const giftButton = overlay.querySelector(".gift-promo-choice__button--gift");
    keepButton.textContent = keepLabel;
    giftButton.textContent = useGiftLabel;
    document.body.appendChild(overlay);

    return new Promise((resolve) => {
      const finish = (useGift) => {
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
        resolve(useGift);
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") finish(false);
      };
      keepButton.addEventListener("click", () => finish(false));
      giftButton.addEventListener("click", () => finish(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener("keydown", onKeydown);
      keepButton.focus();
    });
  }

  async function requestGiftCode(giftVariantIds, tierId, qualifyingVariantIds) {
    const response = await nativeFetch(appUrl("gift-code"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ giftVariantIds, tierId, qualifyingVariantIds }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && Boolean(data.code), data };
  }

  async function addGift(variantId, tierId, options = {}) {
    if (mutationLock) {
      return { ok: false, error: "A gift operation is already in progress." };
    }
    mutationLock = true;

    const variantIdStr = String(variantId);
    let giftAdded = false;
    let addedSelectionId = null;

    try {
      await ensureConfig();

      const initialCart = await fetchCart();
      const externalDiscountCodes = getExternalDiscountCodes(initialCart);
      if (externalDiscountCodes.length > 0 && !options.replaceExternalDiscounts) {
        const compatible = await externalDiscountsAreCompatible(externalDiscountCodes);
        if (!compatible) {
          return {
            ok: false,
            code: "PROMO_CHOICE_REQUIRED",
            discountCodes: externalDiscountCodes,
          };
        }
      }
      const qualifyingVariantIds = initialCart.items
        .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id));

      // Collect one variant ID per authorized gift selection plus the new selection.
      const existingGiftVariantIds = getGiftSelections(initialCart)
        .map((item) => String(item.variant_id));
      const allGiftVariantIds = [...existingGiftVariantIds, variantIdStr];

      // 1. Request a single BXGY discount code covering ALL gifts
      const { ok: codeOk, data: codeData } = await requestGiftCode(
        allGiftVariantIds,
        tierId,
        qualifyingVariantIds,
      );
      if (!codeOk) {
        throw new Error(codeData.error || "Unable to create gift discount.");
      }
      if (Number(codeData.giftQuantity) !== allGiftVariantIds.length) {
        throw new Error("The gift discount quantity is out of sync. Please try again.");
      }

      // 2. Add gift to cart
      addedSelectionId = generateSelectionId();
      const addResponse = await cartPost("cart/add.js", {
        items: [{
          id: Number(variantIdStr),
          quantity: 1,
          properties: {
            [GIFT_PROPERTY_KEY]: GIFT_PROPERTY_VALUE,
            [GIFT_SELECTION_PROPERTY_KEY]: addedSelectionId,
          },
        }],
      });
      const addData = await addResponse.json().catch(() => ({}));
      if (!addResponse.ok) {
        throw new Error(addData.description || "Unable to add this gift.");
      }
      giftAdded = true;

      // 3. Apply discount code — replace old BONUS-*/GIFT-* codes with the new one
      const cart = await fetchCart();
      const nonGiftCodes = options.replaceExternalDiscounts
        ? []
        : getExternalDiscountCodes(cart);
      const discountStr = [...nonGiftCodes, codeData.code].join(",");
      const applyDiscount = async () => {
        const res = await cartPost("cart/update.js", { discount: discountStr });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, data };
      };

      const findGiftCode = (cartData) =>
        (cartData.discount_codes || []).find((d) => d.code === codeData.code);

      let { ok, data: updateData } = await applyDiscount();
      if (!ok) {
        throw new Error(updateData.description || "Unable to apply the gift discount.");
      }

      // A just-created discount code can lag a moment before it is
      // redeemable on the storefront — retry the application briefly.
      let giftCode = findGiftCode(updateData);
      for (let attempt = 0; !giftCode?.applicable && attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 1200));
        const retry = await applyDiscount();
        if (retry.ok) {
          updateData = retry.data;
          giftCode = findGiftCode(updateData);
        }
      }

      const missingExternalCodes = nonGiftCodes.filter((code) => {
        const applied = (updateData.discount_codes || []).find((discount) => discount.code === code);
        return !applied?.applicable;
      });
      if (missingExternalCodes.length > 0) {
        const error = new Error("The gift cannot be combined with a discount currently applied to this cart.");
        error.code = "DISCOUNT_COMBINATION_CONFLICT";
        error.discountCodes = missingExternalCodes;
        error.restoreDiscountCodes = nonGiftCodes;
        throw error;
      }

      // 4. Verify the gift is fully free
      if (!giftCode?.applicable) {
        const error = new Error("The gift cannot be combined with a discount currently applied to this cart.");
        if (nonGiftCodes.length > 0) {
          error.code = "DISCOUNT_COMBINATION_CONFLICT";
          error.discountCodes = nonGiftCodes;
          error.restoreDiscountCodes = nonGiftCodes;
        }
        throw error;
      }
      const freeGiftQuantity = getFreeGiftQuantity(updateData);
      if (freeGiftQuantity !== allGiftVariantIds.length) {
        throw new Error("The selected gift could not be made fully free.");
      }

      lastCart = updateData;
      // 5. Refresh the theme's cart UI and notify listeners
      await refreshCart(updateData);

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
        }
      }
      if (e.restoreDiscountCodes?.length > 0) {
        await cartPost("cart/update.js", { discount: e.restoreDiscountCodes.join(",") }).catch(() => {});
      }
      if (giftAdded) {
        await refreshCart(await fetchCart().catch(() => null));
      }
      return {
        ok: false,
        error: e.message || "Unable to add this gift.",
        code: e.code || null,
        discountCodes: e.discountCodes || [],
      };
    } finally {
      mutationLock = false;
    }
  }

  async function removeGiftByKey(key) {
    const response = await cartPost("cart/change.js", { id: key, quantity: 0 });
    if (!response.ok) {
      throw new Error(`Unable to remove gift (${response.status}).`);
    }
    lastCart = await response.json();
    return lastCart;
  }

  /** Re-issue the gift code for the gifts left in the cart, or clear it. */
  async function syncGiftCode(cart) {
    const nonGiftCodes = getExternalDiscountCodes(cart);
    const remainingGiftVariantIds = getGiftSelections(cart).map((item) => String(item.variant_id));
    const qualifyingVariantIds = cart.items
      .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
      .map((item) => String(item.variant_id));
    const tierId = computeCartState(cart).activeTier?.id;

    if (remainingGiftVariantIds.length > 0 && tierId && qualifyingVariantIds.length > 0) {
      const { ok, data } = await requestGiftCode(remainingGiftVariantIds, tierId, qualifyingVariantIds);
      if (ok) {
        await cartPost("cart/update.js", { discount: [...nonGiftCodes, data.code].join(",") });
        return;
      }
    }
    await cartPost("cart/update.js", { discount: nonGiftCodes.join(",") });
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
      const target = getGiftItems(cart).find(
        (item) =>
          item.properties?.[GIFT_SELECTION_PROPERTY_KEY] === selectionIdOrKey ||
          item.key === selectionIdOrKey,
      );
      if (!target) {
        return { ok: false, error: "Gift not found in cart." };
      }

      await removeGiftByKey(target.key);
      await syncGiftCode(await fetchCart());

      const finalCart = await fetchCart();
      await refreshCart(finalCart);
      return { ok: true, cart: finalCart };
    } catch (e) {
      return { ok: false, error: e.message || "Unable to remove gift." };
    } finally {
      mutationLock = false;
    }
  }

  /** Remove every gift line and the gift discount code. */
  async function removeAllGifts(cart) {
    for (const gift of getGiftItems(cart)) {
      try {
        await removeGiftByKey(gift.key);
      } catch (e) {
        console.error("[gift-core] Failed to remove gift:", e);
      }
    }
    const updatedCart = await fetchCart();
    await cartPost("cart/update.js", { discount: getExternalDiscountCodes(updatedCart).join(",") });
    return fetchCart();
  }

  // ─── Theme cart refresh ─────────────────────────────────────

  // Elements that show cart contents or the cart count in most themes.
  const CART_MARKERS = [
    'form[action$="/cart"]',
    'a[href*="/cart/change"]',
    'a[href$="/cart"]',
    "cart-items",
    "cart-drawer",
    "cart-drawer-items",
    "cart-notification",
    "[data-cart-count]",
    "[data-cart-items]",
    "[data-cart-drawer]",
  ].join(",");

  // State classes and attributes kept across a section swap so an open
  // drawer stays open.
  const STATE_CLASSES = ["active", "open", "is-open", "is-active", "is-visible", "drawer--open", "animate"];
  const STATE_ATTRIBUTES = ["open", "aria-expanded", "aria-hidden", "inert"];

  function getSectionWrappers() {
    return [...document.querySelectorAll('[id^="shopify-section-"]')];
  }

  /** IDs of the sections that show cart contents, plus any the merchant added. */
  function cartSectionIds() {
    const ids = new Set(getConfig().refreshSections);
    for (const wrapper of getSectionWrappers()) {
      const id = wrapper.id.replace("shopify-section-", "");
      if (/cart|drawer|icon-bubble/i.test(id) || wrapper.querySelector(CART_MARKERS)) {
        ids.add(id);
      }
    }
    return [...ids];
  }

  /** Fetch rendered section HTML through the Section Rendering API (5 per request). */
  async function fetchSections(ids) {
    const sections = {};
    for (let i = 0; i < ids.length; i += 5) {
      const batch = ids.slice(i, i + 5);
      try {
        const url = `${window.location.pathname}?sections=${encodeURIComponent(batch.join(","))}`;
        const response = await nativeFetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) continue;
        Object.assign(sections, await response.json());
      } catch (e) {
        console.warn("[gift-core] Section fetch failed:", batch, e);
      }
    }
    return sections;
  }

  function stateKey(el, root) {
    if (el.id) return `#${el.id}`;
    const sameTag = [...root.getElementsByTagName(el.tagName)];
    return `${el.tagName}:${sameTag.indexOf(el)}`;
  }

  function findByStateKey(key, root) {
    if (key.startsWith("#")) return root.querySelector(`#${CSS.escape(key.slice(1))}`);
    const [tag, index] = key.split(":");
    return root.getElementsByTagName(tag)[Number(index)] || null;
  }

  function captureOpenState(root) {
    const selector = [
      ...STATE_CLASSES.map((cls) => `.${cls}`),
      "[open]",
      '[aria-expanded="true"]',
      'dialog',
    ].join(",");
    return [...root.querySelectorAll(selector)].map((el) => ({
      key: stateKey(el, root),
      classes: STATE_CLASSES.filter((cls) => el.classList.contains(cls)),
      attributes: Object.fromEntries(
        STATE_ATTRIBUTES.filter((name) => el.hasAttribute(name)).map((name) => [name, el.getAttribute(name)]),
      ),
      modal: el instanceof HTMLDialogElement && el.open && el.matches(":modal"),
      dialogOpen: el instanceof HTMLDialogElement && el.open,
    }));
  }

  function restoreOpenState(root, states) {
    for (const state of states) {
      const el = findByStateKey(state.key, root);
      if (!el) continue;
      state.classes.forEach((cls) => el.classList.add(cls));
      for (const [name, value] of Object.entries(state.attributes)) {
        if (name !== "open" || !(el instanceof HTMLDialogElement)) el.setAttribute(name, value);
      }
      if (el instanceof HTMLDialogElement && state.dialogOpen && !el.open) {
        try {
          state.modal ? el.showModal() : el.show();
        } catch {
          el.setAttribute("open", "");
        }
      }
    }
  }

  function swapSection(id, html) {
    const wrapper = document.getElementById(`shopify-section-${id}`);
    if (!wrapper || typeof html !== "string" || !html) return false;

    const doc = new DOMParser().parseFromString(html, "text/html");
    const fresh = doc.getElementById(`shopify-section-${id}`) || doc.querySelector('[id^="shopify-section-"]') || doc.body;
    const openState = captureOpenState(wrapper);

    // Keep the live app blocks (and their state) instead of the fresh copies.
    fresh.querySelectorAll("[data-gift-app][id]").forEach((el) => {
      const live = document.getElementById(el.id);
      if (live && wrapper.contains(live)) el.replaceWith(live);
    });

    wrapper.replaceChildren(...fresh.childNodes);
    restoreOpenState(wrapper, openState);
    return true;
  }

  function dispatchCartEvents(cart) {
    const detail = { cart };
    ["gift:cart-updated", "cart:refresh", "cart:updated", "cart:change"].forEach((name) => {
      document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    });
  }

  let refreshing = false;

  /**
   * Bring the theme's cart UI up to date after a gift change.
   * Modes (block setting): "auto" re-renders cart sections, "events" only
   * dispatches cart events for themes that refresh themselves, "reload"
   * reloads the page.
   */
  async function refreshCart(cart) {
    const { refreshMode } = getConfig();
    if (refreshMode === "reload") {
      window.location.reload();
      return;
    }

    refreshing = true;
    try {
      cart = cart && typeof cart.item_count === "number" ? cart : await fetchCart().catch(() => null);
      let swapped = 0;
      let ids = [];

      if (refreshMode !== "events") {
        ids = cartSectionIds();
        const sections = ids.length > 0 ? await fetchSections(ids) : {};
        // Some themes read rendered sections from the cart event payload.
        if (cart) cart.sections = sections;
        for (const id of ids) {
          if (sections[id] && swapSection(id, sections[id])) swapped++;
        }
      }

      if (cart) dispatchCartEvents(cart);
      for (const cb of cartUpdateSubscribers) {
        try { cb(cart); } catch (e) { console.warn("[gift-core] subscriber error:", e); }
      }

      // Nothing could be refreshed in place — reload so the cart is never stale.
      if (refreshMode === "auto" && swapped === 0 && isCartPage()) {
        window.location.reload();
      }
    } finally {
      refreshing = false;
    }
  }

  function onCartUpdate(cb) {
    cartUpdateSubscribers.push(cb);
    return () => {
      const idx = cartUpdateSubscribers.indexOf(cb);
      if (idx >= 0) cartUpdateSubscribers.splice(idx, 1);
    };
  }

  // ─── Cart watcher ──────────────────────────────────────────
  // Notices cart changes made by the theme (quantity buttons, product forms)
  // and stops customers from raising a gift line's quantity. Installed once,
  // chaining whatever fetch wrapper the theme or other apps already set up.

  const CART_MUTATION_PATTERN = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;

  function notifyCartMutation(url) {
    if (refreshing || mutationLock) return;
    for (const cb of cartMutationSubscribers) {
      try { cb(url); } catch (e) { console.warn("[gift-core] cart mutation subscriber error:", e); }
    }
  }

  function onCartMutation(cb) {
    cartMutationSubscribers.push(cb);
    return () => {
      const idx = cartMutationSubscribers.indexOf(cb);
      if (idx >= 0) cartMutationSubscribers.splice(idx, 1);
    };
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

  /** Returns a replacement request body when it would raise a gift quantity, else null. */
  function capGiftQuantities(url, parsed) {
    const gifts = getGiftItems(lastCart);
    if (!parsed || gifts.length === 0) return null;
    const giftQtyByKey = new Map(gifts.map((item) => [item.key, item.quantity]));
    const giftVariantIds = new Set(gifts.map((item) => String(item.variant_id)));

    if (/\/cart\/change/.test(url)) {
      const key = parsed.id && giftQtyByKey.has(parsed.id)
        ? parsed.id
        : parsed.line ? lastCart.items[Number(parsed.line) - 1]?.key : null;
      if (key && giftQtyByKey.has(key) && Number(parsed.quantity) > giftQtyByKey.get(key)) {
        return { ...parsed, quantity: giftQtyByKey.get(key) };
      }
    }

    if (/\/cart\/update/.test(url) && parsed.updates) {
      let modified = false;
      const updates = Array.isArray(parsed.updates) ? [...parsed.updates] : { ...parsed.updates };
      if (Array.isArray(updates)) {
        lastCart.items.forEach((item, index) => {
          if (giftQtyByKey.has(item.key) && Number(updates[index]) > item.quantity) {
            updates[index] = item.quantity;
            modified = true;
          }
        });
      } else {
        for (const key of Object.keys(updates)) {
          if (giftQtyByKey.has(key) && Number(updates[key]) > giftQtyByKey.get(key)) {
            updates[key] = giftQtyByKey.get(key);
            modified = true;
          }
        }
      }
      if (modified) return { ...parsed, updates };
    }

    if (/\/cart\/add/.test(url) && Array.isArray(parsed.items)) {
      // A gift variant bought again is a normal paid line — only the gift
      // line itself (with the _gift property) is capped.
      let modified = false;
      const items = parsed.items.map((item) => {
        if (item.properties?.[GIFT_PROPERTY_KEY] && giftVariantIds.has(String(item.id)) && item.quantity > 1) {
          modified = true;
          return { ...item, quantity: 1 };
        }
        return item;
      });
      if (modified) return { ...parsed, items };
    }

    return null;
  }

  function installCartWatcher() {
    if (window.fetch.__giftCartWatcher) return;
    const previousFetch = window.fetch;

    const watchedFetch = async function (input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      if (!CART_MUTATION_PATTERN.test(url)) return previousFetch.call(this, input, init);

      const capped = typeof init?.body === "string" ? capGiftQuantities(url, parseBody(init.body)) : null;
      const response = await previousFetch.call(
        this,
        input,
        capped ? { ...init, body: JSON.stringify(capped) } : init,
      );
      if (response.ok) setTimeout(() => notifyCartMutation(url), 0);
      return response;
    };
    watchedFetch.__giftCartWatcher = true;
    window.fetch = watchedFetch;

    // XHR-based themes: observe finished requests without patching XHR.
    if (typeof PerformanceObserver !== "undefined") {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.initiatorType === "xmlhttprequest" && CART_MUTATION_PATTERN.test(entry.name)) {
              notifyCartMutation(entry.name);
            }
          }
        }).observe({ type: "resource", buffered: false });
      } catch {
        // Resource timing is unavailable — fetch-based detection still works.
      }
    }

    // Classic cart forms that post updates[] directly.
    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!/\/cart(\/update)?\/?$/.test(form.getAttribute("action") || "")) return;
      const gifts = getGiftItems(lastCart);
      if (gifts.length === 0) return;
      const updates = new FormData(form).getAll("updates[]");
      const raised = lastCart.items.some((item, index) =>
        gifts.some((gift) => gift.key === item.key) && Number(updates[index]) > item.quantity,
      );
      if (raised) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
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
    getConfig,
    getTiers: () => tiers,
    getSettings: () => settings,
    getShopDomain,
    // Routes & currency
    storefrontUrl,
    isCartPage,
    toPresentment,
    formatPrice,
    escapeHtml,
    decodeHtml,
    readTranslations,
    // Cart helpers (also exposed for UI scripts that need them)
    fetchCart,
    getLastCart: () => lastCart,
    isGiftCode,
    getExternalDiscountCodes,
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
    fetchGiftProducts,
    cartSectionIds,
    // Public API
    getCartState,
    getEligibility,
    requestPromoChoice,
    addGift,
    removeGift,
    removeGiftByKey,
    removeAllGifts,
    refreshCart,
    onCartUpdate,
    onCartMutation,
    isMutationLocked: () => mutationLock,
    isRefreshing: () => refreshing,
  };

  installCartWatcher();
})();

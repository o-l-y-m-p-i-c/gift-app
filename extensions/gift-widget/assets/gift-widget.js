/**
 * Gift Widget — Cart page logic.
 *
 * Uses the shared gift-core.js runtime (window.giftApp) for:
 *   - cart fetching
 *   - tier/budget calculations
 *   - gift add/remove workflow
 *   - BXGY discount code generation and application
 *
 * This file retains only:
 *   - Cart-page rendering (progress bar, selected gifts, product carousel)
 *   - Cart section refresh (Dawn cart page + drawer)
 *   - Cart abuse prevention (quantity increase interception)
 */

(function () {
  // Support multiple containers: cart page + cart drawer can both have
  // a gift-widget-container. We initialize once and render to all of them.
  function getContainers() {
    return document.querySelectorAll("#gift-widget-container");
  }

  if (getContainers().length === 0) return;

  if (window.giftWidgetInitialized) {
    if (window.giftWidget && typeof window.giftWidget._init === "function") {
      window.giftWidget._init();
    }
    return;
  }
  window.giftWidgetInitialized = true;

  // ─── gift-core shorthand ──────────────────────────────────
  const G = window.giftApp;
  if (!G) {
    console.error("[Gift Widget] gift-core.js must be loaded before gift-widget.js");
    return;
  }

  const GIFT_PROPERTY_KEY = G.GIFT_PROPERTY_KEY;
  const GIFT_SELECTION_PROPERTY_KEY = G.GIFT_SELECTION_PROPERTY_KEY;

  let lastActiveTierId = null;
  let giftProducts = [];
  let cartUpdateDebounce = null;
  let isRefreshingSection = false;
  let isSelectingGift = false;
  let removingGiftKey = null;

  // ─── Translations ──────────────────────────────────────────

  let _translations = null;
  function getTranslations() {
    if (_translations) return _translations;
    try {
      const el = document.querySelector("[data-gift-translations]");
      if (el) _translations = JSON.parse(el.textContent);
    } catch (e) {
      console.warn("[Gift Widget] Failed to parse translations:", e);
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

  // ─── Scale auto-scroll ──────────────────────────────────────
  function scrollScaleToCurrent(containers, tiers, thresholdBase, stepWidth) {
    let currentIdx = 0;
    for (let i = 0; i < tiers.length; i++) {
      if (thresholdBase >= tiers[i].minAmount) {
        currentIdx = i;
      } else {
        break;
      }
    }

    containers.forEach((container) => {
      const scrollEl = container.querySelector("[data-gift-scale-scroll]");
      if (!scrollEl) return;
      const targetX = currentIdx * stepWidth - scrollEl.clientWidth / 2 + stepWidth / 2;
      scrollEl.scrollTo({
        left: Math.max(0, targetX),
        behavior: "smooth",
      });
    });
  }

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    const containers = getContainers();
    if (containers.length === 0) return;

    containers.forEach((el) => renderLoading(el));

    try {
      await G.ensureConfig();
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch config:", e);
      containers.forEach((el) =>
        renderError(el, "Gift configuration is temporarily unavailable.", () => init()),
      );
      return;
    }

    let cart;
    try {
      cart = await G.fetchCart();
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch cart:", e);
      containers.forEach((el) =>
        renderError(el, "Unable to load your cart. Please refresh the page.", () => init()),
      );
      return;
    }

    await onCartUpdate(cart);
  }

  // ─── Cart section refresh ──────────────────────────────────

  async function refreshCartSection() {
    isRefreshingSection = true;
    const cart = await G.fetchCart().catch(() => null);

    try {
      document.dispatchEvent(new CustomEvent("cart:refresh", { detail: { cart } }));
      document.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart } }));
    } catch (e) {
      console.warn("[Gift Widget] Event dispatch failed:", e);
    }

    // ─── Dawn cart page ───
    const dawnCartItems = document.querySelector("[data-id^='template--'][data-id*='cart-items']");
    const dawnSectionId = dawnCartItems?.getAttribute("data-id");
    if (dawnSectionId) {
      try {
        const res = await fetch(`${window.location.pathname}?section_id=${dawnSectionId}`, {
          headers: { Accept: "text/html" },
        });
        if (res.ok) {
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          const newItems = doc.querySelector(`[data-id="${dawnSectionId}"]`);
          const oldItems = document.querySelector(`[data-id="${dawnSectionId}"]`);
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
        console.warn("[Gift Widget] Dawn section fetch failed:", e);
      }
    }

    // ─── Prestige cart page ───
    const prestigeCartForm = document.querySelector("form.cart-page");
    if (prestigeCartForm) {
      try {
        const res = await fetch(`${window.location.pathname}?section_id=main-cart`, {
          headers: { Accept: "text/html" },
        });
        if (res.ok) {
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          const newForm = doc.querySelector("form.cart-page");
          if (newForm && prestigeCartForm) {
            prestigeCartForm.innerHTML = newForm.innerHTML;
            // Re-attach any scripts
            prestigeCartForm.querySelectorAll("script").forEach((oldScript) => {
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
        console.warn("[Gift Widget] Prestige cart section fetch failed:", e);
      }
    }

    // ─── Dawn cart drawer ───
    const dawnDrawer = document.querySelector("cart-drawer-items");
    if (dawnDrawer) {
      try {
        const res = await fetch(`/cart?section_id=cart-drawer`, { headers: { Accept: "text/html" } });
        if (res.ok) {
          const doc = new DOMParser().parseFromString(await res.text(), "text/html");
          const newDrawer = doc.querySelector("cart-drawer-items");
          if (newDrawer) dawnDrawer.innerHTML = newDrawer.innerHTML;
        }
      } catch (e) {
        console.warn("[Gift Widget] Dawn cart drawer refresh failed:", e);
      }
    }

    // ─── Prestige cart drawer ───
    const prestigeDrawer = document.querySelector("cart-drawer");
    if (prestigeDrawer) {
      try {
        const res = await fetch(`/cart?section_id=cart-drawer`, { headers: { Accept: "text/html" } });
        if (res.ok) {
          const doc = new DOMParser().parseFromString(await res.text(), "text/html");
          const newDrawer = doc.querySelector("cart-drawer");
          if (newDrawer && prestigeDrawer) {
            // Preserve our gift widget if it's already mounted inside the drawer
            const giftWidget = prestigeDrawer.querySelector("[data-gift-drawer-mounted]");
            prestigeDrawer.innerHTML = newDrawer.innerHTML;
            // Re-mount gift widget if it existed
            if (giftWidget) {
              const newItemsContainer = prestigeDrawer.querySelector(".cart-drawer__items");
              const newFooter = prestigeDrawer.querySelector('[slot="footer"]');
              if (newFooter && giftWidget.parentNode === newFooter.parentNode) {
                newFooter.before(giftWidget);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[Gift Widget] Prestige cart drawer refresh failed:", e);
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

  // ─── Cart update handler ───────────────────────────────────

  async function onCartUpdate(cart) {
    if (!cart || typeof cart.total_price !== "number") {
      cart = await G.fetchCart();
    }

    const state = G.computeCartState(cart);
    const { activeTier, nextTier, thresholdBase, remainingBudget } = state;
    const settings = G.getSettings();

    if (state.giftSelectionCount > 0 && state.freeGiftQuantity !== state.giftSelectionCount) {
      await removeAllGifts(cart);
      if (settings.showRemovalNotification) {
        showNotification(t("notif_removed_discount"), "warning");
      }
      await refreshCartSection();
      return;
    }

    const tierChanged = activeTier?.id !== lastActiveTierId;
    if (tierChanged) {
      if (lastActiveTierId !== null && activeTier && settings.showLevelUpNotification) {
        showNotification(
          t("notif_tier_unlocked", { amount: G.formatPrice(activeTier.giftAmount) }),
          "success",
        );
      }
      lastActiveTierId = activeTier?.id ?? null;
    }

    // If no active tier but gifts in cart → remove them
    if (!activeTier && state.giftSelectionCount > 0) {
      await removeAllGifts(cart);
      await refreshCartSection();
      if (settings.showRemovalNotification) {
        showNotification(t("notif_removed_no_qualify"), "warning");
      }
      cart = await G.fetchCart();
    }

    // If gifts exceed budget (tier changed down) → remove excess
    if (activeTier && state.totalGiftValue > activeTier.giftAmount) {
      await removeAllGifts(cart);
      await refreshCartSection();
      if (settings.showRemovalNotification) {
        showNotification(t("notif_removed_choose_again"), "info");
      }
      cart = await G.fetchCart();
    }

    await renderWidget(cart, activeTier, nextTier, thresholdBase);
  }

  // ─── Rendering ─────────────────────────────────────────────

  function renderLoading(el) {
    el.innerHTML = `
      <div class="gift-widget gift-widget--loading">
        <div class="gift-widget__spinner"></div>
        <p class="gift-widget__subtitle">${t("loading")}</p>
      </div>
    `;
  }

  function renderError(el, message, retryFn) {
    el.innerHTML = `
      <div class="gift-widget gift-widget--error">
        <div class="gift-widget__header">
          <span class="gift-widget__icon">⚠️</span>
          <div>
            <h3 class="gift-widget__title">${t("error_title")}</h3>
            <p class="gift-widget__subtitle">${message}</p>
          </div>
        </div>
        <button type="button" class="gift-widget__retry" id="gift-widget-retry">${t("retry")}</button>
      </div>
    `;
    const retryBtn = el.querySelector("#gift-widget-retry");
    if (retryBtn && retryFn) retryBtn.addEventListener("click", retryFn);
  }

  async function renderWidget(cart, activeTier, nextTier, thresholdBase) {
    const containers = getContainers();
    if (containers.length === 0) return;

    const giftItems = G.getGiftSelections(cart);
    const totalGiftValue = G.getTotalGiftValue(cart);
    const remainingBudget = activeTier ? Math.max(0, activeTier.giftAmount - totalGiftValue) : 0;

    // ── Scrollable scale: each tier is a fixed-width column ──
    const allTiers = G.getTiers();
    const scaleMax = allTiers.length > 0 ? allTiers[allTiers.length - 1].minAmount : 0;
    const STEP_WIDTH = 96; // px per tier column
    const totalWidth = allTiers.length * STEP_WIDTH;
    // Dots are centered in columns: first dot at STEP_WIDTH/2, last at totalWidth - STEP_WIDTH/2
    const usableStart = STEP_WIDTH / 2;
    const usableRange = totalWidth - STEP_WIDTH;
    const ratio = scaleMax > 0 ? Math.min(1, Math.max(0, thresholdBase / scaleMax)) : 0;
    const fillPx = usableStart + ratio * usableRange;

    const tierSteps = allTiers.map((tier, i) => {
      const isUnlocked = thresholdBase >= tier.minAmount;
      const isCurrent = activeTier && activeTier.id === tier.id;
      const stepClass = isCurrent
        ? "gift-widget__scale-step--current"
        : isUnlocked
          ? "gift-widget__scale-step--unlocked"
          : "";
      return `
        <div class="gift-widget__scale-step ${stepClass}" data-tier-idx="${i}">
          <div class="gift-widget__scale-dot"></div>
          <div class="gift-widget__scale-amount">${G.formatPrice(tier.minAmount)}</div>
          <div class="gift-widget__scale-bonus">${G.formatPrice(tier.giftAmount)}</div>
        </div>
      `;
    }).join("");

    let progressHtml = "";

    if (allTiers.length > 0) {
      let infoText = "";
      if (activeTier && nextTier) {
        const amountToNext = nextTier.minAmount - thresholdBase;
        infoText = `
          <span class="gift-widget__progress-current">
            ${t("gift_budget", { amount: G.formatPrice(activeTier.giftAmount) })}
          </span>
          <span class="gift-widget__progress-next">
            ${t("to_unlock_next", { amount: G.formatPrice(amountToNext), budget: G.formatPrice(nextTier.giftAmount) })}
          </span>
        `;
      } else if (activeTier && !nextTier) {
        infoText = `
          <span class="gift-widget__progress-current">
            ${t("gift_budget_max", { amount: G.formatPrice(activeTier.giftAmount) })}
          </span>
        `;
      } else if (!activeTier) {
        const amountToFirst = allTiers[0].minAmount - thresholdBase;
        infoText = `
          <span class="gift-widget__progress-current">
            ${t("to_unlock_first", { amount: G.formatPrice(amountToFirst) })}
          </span>
        `;
      }

      progressHtml = `
        <div class="gift-widget__progress">
          <div class="gift-widget__progress-info">
            ${infoText}
          </div>
          <div class="gift-widget__scale-scroll" data-gift-scale-scroll>
            <div class="gift-widget__scale-track" style="min-width:${totalWidth}px">
              <div class="gift-widget__scale-steps">
                <div class="gift-widget__scale-line" style="width:${totalWidth}px">
                  <div class="gift-widget__scale-line-fill" style="width:${fillPx}px"></div>
                </div>
                ${tierSteps}
              </div>
            </div>
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
              <p class="gift-widget__selected-price">${G.formatPrice(G.getOriginalUnitPrice(item))}</p>
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
      selectionHtml = `
        <div class="gift-widget__no-tier">
          <p class="gift-widget__subtitle">
            ${t("unlock_more")}
          </p>
        </div>
      `;
    } else if (remainingBudget <= 0) {
      selectionHtml = `
        <div class="gift-widget__budget-used">
          <p class="gift-widget__subtitle">
            ${t("budget_full", { amount: G.formatPrice(activeTier.giftAmount) })}
          </p>
        </div>
      `;
    } else {
      const budgetLabel = giftItems.length > 0
        ? t("remaining", { amount: G.formatPrice(remainingBudget) })
        : t("choose_up_to", { amount: G.formatPrice(activeTier.giftAmount) });

      selectionHtml = `
        <div class="gift-widget__selection-loading">
          <div class="gift-widget__spinner"></div>
          <p class="gift-widget__subtitle">${t("loading")}</p>
        </div>
      `;

      const widgetHtml = `
        <div class="gift-widget">
          <div class="gift-widget__header">
            <span class="gift-widget__icon">💰</span>
            <div>
              <h3 class="gift-widget__title">${t("title")}</h3>
              <p class="gift-widget__subtitle">${budgetLabel}</p>
            </div>
          </div>
          ${progressHtml}
          ${selectedHtml}
          ${selectionHtml}
        </div>
      `;

      // Render to all containers
      containers.forEach((el) => { el.innerHTML = widgetHtml; });

      // Auto-scroll scale to current position
      scrollScaleToCurrent(containers, allTiers, thresholdBase, STEP_WIDTH);

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
        containers.forEach((el) => {
          const selectionEl = el.querySelector(".gift-widget__selection-loading");
          if (selectionEl) {
            selectionEl.innerHTML = `
              <p class="gift-widget__subtitle">${t("unable_load")}</p>
              <button type="button" class="gift-widget__retry">${t("retry")}</button>
            `;
            const retryBtn = selectionEl.querySelector(".gift-widget__retry");
            if (retryBtn) {
              retryBtn.addEventListener("click", () => renderWidget(cart, activeTier, nextTier, thresholdBase));
            }
          }
        });
        return;
      }
      giftProducts = products;

      // Update selection section in all containers
      let selectionReplacementHtml;
      if (products.length === 0) {
        selectionReplacementHtml = `
          <div class="gift-widget__no-products">
            <p class="gift-widget__subtitle">
              ${t("no_products", { amount: G.formatPrice(remainingBudget) })}
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
                <p class="gift-widget__price">${G.formatPrice(p.price)}</p>
              </div>
              <button type="button" class="gift-widget__select" onclick="window.giftWidget.selectGift('${p.variantId}', '${activeTier.id}')">
                <span class="gift-widget__select-label">${t("select")}</span>
                <span class="gift-widget__select-spinner" style="display:none"></span>
              </button>
            </div>
          `,
          )
          .join("");

        selectionReplacementHtml = `
          <div class="gift-widget__carousel">${productCards}</div>
        `;
      }

      containers.forEach((el) => {
        const selectionContainer = el.querySelector(".gift-widget__selection-loading");
        if (selectionContainer) {
          selectionContainer.outerHTML = selectionReplacementHtml;
        }
      });

      return; // Already rendered
    }

    // Render full widget (no product selection needed) to all containers
    const fullWidgetHtml = `
      <div class="gift-widget">
        <div class="gift-widget__header">
          <span class="gift-widget__icon">🎁</span>
          <div>
            <h3 class="gift-widget__title">${t("title")}</h3>
            <p class="gift-widget__subtitle">
              ${activeTier ? t("budget_label", { amount: G.formatPrice(activeTier.giftAmount) }) : t("unlock_free")}
            </p>
          </div>
        </div>
        ${progressHtml}
        ${selectedHtml}
        ${selectionHtml}
      </div>
    `;
    containers.forEach((el) => { el.innerHTML = fullWidgetHtml; });
  }

  // ─── Gift products fetch ───────────────────────────────────

  async function fetchGiftProducts(maxPrice, excludeVariantIds = new Set()) {
    const appUrl = "/apps/gift-threshold";
    try {
      const res = await fetch(
        `${appUrl}/products?maxPrice=${maxPrice}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const products = (data.products || []).filter(
        (p) => !excludeVariantIds.has(String(p.variantId)),
      );
      console.log(`[Gift Widget] API returned ${products.length} eligible gifts (maxPrice=${maxPrice} cents)`);
      return products;
    } catch (e) {
      console.warn("[Gift Widget] API products fetch failed, falling back to /products.json:", e);
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

      console.log(`[Gift Widget] Fallback found ${eligible.length} eligible gifts (maxPrice=${maxPrice} cents) from ${allProducts.length} products`);
      return eligible;
    }
  }

  // ─── Cart actions (delegate to gift-core) ──────────────────

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

    try {
      const result = await G.addGift(variantId, tierId);
      if (!result.ok) {
        throw new Error(result.error || "Unable to add this gift.");
      }
      await refreshCartSection();
    } catch (e) {
      console.error("[Gift Widget] Failed to add gift:", e);
      showNotification(e.message || "Unable to add this gift.", "warning");

      allButtons.forEach((btn) => { btn.disabled = false; });
      if (clickedLabel) clickedLabel.style.display = "";
      if (clickedSpinner) clickedSpinner.style.display = "none";
    } finally {
      isSelectingGift = false;
    }
  }

  async function removeGift(key) {
    if (removingGiftKey) return;
    removingGiftKey = key;

    const removeBtn = document.querySelector(`[data-gift-key="${key}"] .gift-widget__selected-remove`);
    if (removeBtn) {
      removeBtn.disabled = true;
      const label = removeBtn.querySelector(".gift-widget__remove-label");
      if (label) label.style.display = "none";
      if (!removeBtn.querySelector(".gift-widget__remove-spinner")) {
        const spinner = document.createElement("span");
        spinner.className = "gift-widget__remove-spinner";
        spinner.style.display = "inline-block";
        removeBtn.appendChild(spinner);
      }
    }

    try {
      const result = await G.removeGift(key);
      if (!result.ok) {
        throw new Error(result.error || "Unable to remove gift.");
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
    const gifts = G.getGiftItems(cart);
    for (const gift of gifts) {
      try {
        await G.removeGiftByKey(gift.key);
      } catch (e) {
        console.error("[Gift Widget] Failed to remove gift:", e);
      }
    }

    const updatedCart = await G.fetchCart();
    const nonGiftCodes = (updatedCart.discount_codes || [])
      .filter((discount) => discount.applicable !== false && discount.code && !discount.code.startsWith("BONUS-") && !discount.code.startsWith("GIFT-"))
      .map((discount) => discount.code);
    await fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discount: nonGiftCodes.join(",") }),
    });
  }

  // ─── Cart abuse prevention ─────────────────────────────────

  function interceptCartChanges() {
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      const body = init?.body;

      if (url.includes("/cart/change.js") || url.includes("/cart/update.js") || url.includes("/cart/add.js")) {
        const parsed = parseBody(body);
        if (parsed) {
          const cart = await G.fetchCart().catch(() => null);
          if (cart) {
            const giftKeys = new Set(G.getGiftItems(cart).map((item) => item.key));
            const giftVariantIds = new Set(G.getGiftItems(cart).map((item) => String(item.variant_id)));
            const giftQtyByKey = new Map(G.getGiftItems(cart).map((item) => [item.key, item.quantity]));

            if (url.includes("/cart/change.js")) {
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
          this._giftWidgetBody = parsed;
        }
      }
      return originalSend.call(this, body);
    };

    document.addEventListener("submit", async (e) => {
      const form = e.target;
      if (!form || !form.action) return;
      const action = form.getAttribute("action") || "";
      if (!action.includes("/cart")) return;

      const formData = new FormData(form);
      const updates = formData.get("updates[]") || formData.get("updates");
      if (!updates) return;

      const cart = await G.fetchCart().catch(() => null);
      if (!cart) return;

      const giftKeys = new Set(G.getGiftItems(cart).map((item) => item.key));
      const giftQtyByKey = new Map(G.getGiftItems(cart).map((item) => [item.key, item.quantity]));
      if (giftKeys.size === 0) return;

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

  function disableGiftQuantityInputs(cart) {
    const gifts = G.getGiftItems(cart);
    if (gifts.length === 0) return;

    const giftKeys = new Set(gifts.map((g) => g.key));
    const giftQtyByKey = new Map(gifts.map((g) => [g.key, g.quantity]));

    const cartItems = document.querySelectorAll(
      // Dawn selectors
      "[data-id^='template--'][data-id*='cart-items'] .cart-item, " +
      "cart-drawer-items .cart-item, " +
      "form[action='/cart'] .cart-item, " +
      // Prestige selectors
      "form.cart-page line-item, " +
      "cart-drawer line-item"
    );

    cartItems.forEach((item) => {
      // Dawn: cart-remove-button a[href*="/cart/change"]
      // Prestige: a[href*="/cart/change"] (line-item.url_to_remove)
      const removeLink = item.querySelector('a[href*="/cart/change"], cart-remove-button a[href*="/cart/change"]');
      let key = item.getAttribute("data-key") || item.getAttribute("data-line-key");
      if (!key && removeLink) {
        try {
          key = new URL(removeLink.href, window.location.origin).searchParams.get("id");
        } catch {}
      }

      if (key && giftKeys.has(key)) {
        const currentQty = (key && giftQtyByKey.get(key)) || 1;
        const inputs = item.querySelectorAll("input[name='quantity'], input[name='updates[]'], .quantity__input, [data-quantity-input]");
        inputs.forEach((input) => {
          input.max = String(currentQty);
          input.min = "1";
          input.value = String(currentQty);
          input.setAttribute("readonly", "readonly");
        });
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

  // ─── Cart update listener ──────────────────────────────────

  function listenForCartUpdates() {
    function scheduleCartRefresh() {
      if (cartUpdateDebounce) clearTimeout(cartUpdateDebounce);
      cartUpdateDebounce = setTimeout(async () => {
        cartUpdateDebounce = null;
        const cart = await G.fetchCart();
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
      // Dawn selectors
      document.querySelector("[data-id^='template--'][data-id*='cart-items']") ||
      document.querySelector("#cart") ||
      document.querySelector("cart-drawer-items") ||
      // Prestige selectors
      document.querySelector("form.cart-page") ||
      document.querySelector("cart-drawer .cart-drawer__items") ||
      document.querySelector("cart-drawer");

    if (cartItemsContainer && typeof MutationObserver !== "undefined") {
      let observerDebounce = null;
      const observer = new MutationObserver(() => {
        if (isRefreshingSection || isSelectingGift || removingGiftKey) return;
        if (observerDebounce) clearTimeout(observerDebounce);
        observerDebounce = setTimeout(async () => {
          observerDebounce = null;
          const containers = getContainers();
          const anyEmpty = [...containers].some((el) => el.children.length === 0);
          if (containers.length === 0 || anyEmpty) {
            if (window.giftWidget && typeof window.giftWidget._init === "function") {
              await window.giftWidget._init();
            }
          } else {
            const cart = await G.fetchCart();
            await onCartUpdate(cart);
          }
        }, 300);
      });
      observer.observe(cartItemsContainer, { childList: true, subtree: true });
    }
  }

  // ─── Utils ─────────────────────────────────────────────────

  function showNotification(message, type) {
    const containers = getContainers();
    if (containers.length === 0) return;
    containers.forEach((el) => {
      const notif = document.createElement("div");
      notif.className = `gift-widget__notification gift-widget__notification--${type}`;
      notif.textContent = message;
      el.prepend(notif);
      setTimeout(() => notif.remove(), 5000);
    });
  }

  // ─── Public API ────────────────────────────────────────────

  window.giftWidget = {
    selectGift,
    removeGift,
    _init: init,
  };

  interceptCartChanges();
  listenForCartUpdates();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/**
 * Gift Widget — Cart page logic.
 *
 * Uses the shared gift-core.js runtime (window.giftApp) for:
 *   - cart fetching and theme cart refreshes
 *   - tier/budget calculations
 *   - gift add/remove workflow
 *   - BXGY discount code generation and application
 *
 * This file handles:
 *   - Cart-page rendering (progress scale, selected gifts, product carousel)
 *   - The optional "choose a gift first" step that hides the main cart
 *   - Re-rendering after cart changes made by the theme
 */

(function () {
  // Several widget blocks can be on one page (cart page + cart drawer).
  function getContainers() {
    return document.querySelectorAll("[data-gift-widget]");
  }

  // The block renders a skeleton in Liquid that reserves the widget's space,
  // so the page doesn't jump when the widget loads.
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
  const esc = G.escapeHtml;

  let lastActiveTierId = null;
  let cartUpdateDebounce = null;
  let isSelectingGift = false;
  let removingGiftKey = null;
  let widgetBusyDepth = 0;
  let pendingEventCart = null;
  let handlingUpdate = false;
  let queuedCart = null;

  // ─── Optional "choose a gift first" step ──────────────────
  // When enabled in the block settings, the main cart is hidden until the
  // customer picks a gift or skips the step.

  function hideCartUntilChosen() {
    return [...getContainers()].some((el) => el.dataset.hideCartUntilChosen === "true");
  }

  function getMainCartSections() {
    const customSelector = [...getContainers()].map((el) => el.dataset.mainCartSelector).find(Boolean);
    const candidates = customSelector
      ? [...document.querySelectorAll(customSelector)]
      : [...document.querySelectorAll('[id^="shopify-section-"]')].filter((section) =>
          section.querySelector('form[action$="/cart"], cart-items, [data-cart-items]'),
        );
    return candidates.filter((section) => !section.querySelector("[data-gift-widget]"));
  }

  function isStepOne(state) {
    return hideCartUntilChosen() &&
      Boolean(state.activeTier) &&
      state.remainingBudget > 0 &&
      state.giftSelectionCount === 0 &&
      G.getExternalDiscountCodes(state.cart).length === 0;
  }

  function toggleCartStep(state) {
    const showStep1 = isStepOne(state);
    getMainCartSections().forEach((section) => {
      section.style.display = showStep1 ? "none" : "";
    });
    getContainers().forEach((container) => {
      container.classList.toggle("gift-widget-container--step1", showStep1);
    });
  }

  // Instantly show the cart again when a gift is chosen.
  function forceStep2() {
    getMainCartSections().forEach((section) => { section.style.display = ""; });
    getContainers().forEach((container) => {
      container.classList.remove("gift-widget-container--step1");
    });
  }

  // ─── Translations ──────────────────────────────────────────

  let _translations = null;
  function getTranslations() {
    if (!_translations) _translations = G.readTranslations(document.querySelector("[data-gift-translations]"));
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

  let initPromise = null;

  function init() {
    if (!initPromise) {
      initPromise = initOnce().finally(() => { initPromise = null; });
    }
    return initPromise;
  }

  async function initOnce() {
    const containers = getContainers();
    if (containers.length === 0) return;

    try {
      await G.ensureConfig();
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch config:", e);
      containers.forEach((el) =>
        renderError(el, t("unable_load"), () => init()),
      );
      return;
    }

    if (!G.getSettings().active) {
      containers.forEach((el) => el.remove());
      return;
    }

    let cart;
    try {
      cart = await G.fetchCart();
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch cart:", e);
      containers.forEach((el) =>
        renderError(el, t("unable_load"), () => init()),
      );
      return;
    }

    await onCartUpdate(cart);
  }

  // ─── Cart update handler ───────────────────────────────────

  async function onCartUpdate(cart) {
    // Removing gifts below refreshes the cart, which notifies us again —
    // queue that update instead of re-entering.
    if (handlingUpdate) {
      queuedCart = cart || queuedCart;
      return;
    }
    handlingUpdate = true;
    setWidgetBusy(true);
    try {
      if (!cart || typeof cart.total_price !== "number") {
        cart = await G.fetchCart();
      }

      const state = G.computeCartState(cart);
      const { activeTier } = state;
      const settings = G.getSettings();

      if (state.giftSelectionCount > 0 && state.freeGiftQuantity !== state.giftSelectionCount) {
        const conflictingCodes = G.getExternalDiscountCodes(cart);
        cart = await G.removeAllGifts(cart);
        await G.refreshCart(cart);
        if (conflictingCodes.length > 0) {
          const message = t("promo_conflict", { code: conflictingCodes.join(", ") });
          showWidgetError(message);
          showNotification(message, "warning");
        } else if (settings.showRemovalNotification) {
          showNotification(t("notif_removed_discount"), "warning");
        }
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
        cart = await G.removeAllGifts(cart);
        await G.refreshCart(cart);
        if (settings.showRemovalNotification) {
          showNotification(t("notif_removed_no_qualify"), "warning");
        }
      }

      // If gifts exceed budget (tier changed down) → remove them
      if (activeTier && state.totalGiftValue > activeTier.giftAmount) {
        cart = await G.removeAllGifts(cart);
        await G.refreshCart(cart);
        if (settings.showRemovalNotification) {
          showNotification(t("notif_removed_choose_again"), "info");
        }
      }

      // Recompute state after potential gift removals
      const updatedState = G.computeCartState(cart);
      toggleCartStep(updatedState);

      await renderWidget(cart, updatedState);
    } finally {
      setWidgetBusy(false);
      handlingUpdate = false;
      if (queuedCart) {
        const next = queuedCart;
        queuedCart = null;
        scheduleCartRefresh(next);
      }
    }
  }

  // ─── Rendering ─────────────────────────────────────────────

  function setWidgetBusy(busy) {
    widgetBusyDepth = Math.max(0, widgetBusyDepth + (busy ? 1 : -1));
    getContainers().forEach((el) => {
      el.classList.toggle("gift-widget-container--loading", widgetBusyDepth > 0);
      if (widgetBusyDepth > 0) el.setAttribute("aria-busy", "true");
      else el.removeAttribute("aria-busy");
    });
  }

  function showWidgetError(message) {
    getContainers().forEach((el) => {
      el.querySelector(".gift-widget__inline-error")?.remove();
      const widget = el.querySelector(".gift-widget");
      if (!widget) return;
      const error = document.createElement("p");
      error.className = "gift-widget__inline-error";
      error.setAttribute("role", "alert");
      error.textContent = message;
      widget.prepend(error);
    });
  }

  function renderError(el, message, retryFn) {
    el.innerHTML = `
      <div class="gift-widget gift-widget--error">
        <p class="gift-widget__subtitle">${esc(t("error_title"))}</p>
        <p class="gift-widget__subtitle">${esc(message)}</p>
        <button type="button" class="gift-widget__retry">${esc(t("retry"))}</button>
      </div>
    `;
    el.dataset.giftRendered = "true";
    const retryBtn = el.querySelector(".gift-widget__retry");
    if (retryBtn && retryFn) retryBtn.addEventListener("click", retryFn);
  }

  function setAllContainersHtml(html) {
    getContainers().forEach((el) => {
      el.innerHTML = html;
      el.dataset.giftRendered = "true";
    });
  }

  function renderScale(allTiers, activeTier, thresholdBase, stepWidth) {
    const totalWidth = allTiers.length * stepWidth;
    // Dots are centered in columns: dot i center = i*stepWidth + stepWidth/2.
    // The line spans from the first dot center to the last dot center.
    const usableStart = stepWidth / 2;
    const usableRange = totalWidth - stepWidth;
    // Fill ends at the ACTIVE (current) tier dot — the last unlocked marker.
    const activeIdx = activeTier ? allTiers.findIndex((tier) => tier.id === activeTier.id) : -1;
    const fillPx = Math.max(0, activeIdx * stepWidth);

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
          <div class="gift-widget__scale-amount">${esc(G.formatPrice(tier.minAmount))}</div>
          <div class="gift-widget__scale-bonus">${esc(G.formatPrice(tier.giftAmount))}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="gift-widget__scale-scroll" data-gift-scale-scroll>
        <div class="gift-widget__scale-track" style="min-width:${totalWidth}px">
          <div class="gift-widget__scale-steps">
            <div class="gift-widget__scale-line" style="left:${usableStart}px;width:${usableRange}px">
              <div class="gift-widget__scale-line-fill" style="width:${fillPx}px"></div>
            </div>
            ${tierSteps}
          </div>
        </div>
      </div>
    `;
  }

  async function renderWidget(cart, state) {
    const containers = getContainers();
    if (containers.length === 0) return;

    const { activeTier, nextTier, thresholdBase } = state;
    const giftItems = G.getGiftSelections(cart);
    const remainingBudget = state.remainingBudget;
    const allTiers = G.getTiers();
    const STEP_WIDTH = 116; // px per tier column (matches .gift-widget__scale-step)

    if (allTiers.length === 0) {
      setAllContainersHtml("");
      return;
    }

    // No tier unlocked yet: compact variant
    if (!activeTier) {
      const amountToFirst = Math.max(0, allTiers[0].minAmount - thresholdBase);
      setAllContainersHtml(`
        <div class="gift-widget gift-widget--compact">
          <p class="gift-widget__promo-title">${esc(t("promo_title"))}</p>
          <p class="gift-widget__subtitle">${esc(t("to_unlock_first", { amount: G.formatPrice(amountToFirst) }))}</p>
          <p class="gift-widget__footnote">${esc(t("footnote"))}</p>
        </div>
      `);
      return;
    }

    // ── Progress ──
    const infoText = nextTier
      ? `
        <span class="gift-widget__progress-current">${esc(t("gift_budget", { amount: G.formatPrice(activeTier.giftAmount) }))}</span>
        <span class="gift-widget__progress-next">${esc(t("to_unlock_next", {
          amount: G.formatPrice(nextTier.minAmount - thresholdBase),
          budget: G.formatPrice(nextTier.giftAmount),
        }))}</span>
      `
      : `<span class="gift-widget__progress-current">${esc(t("gift_budget_max", { amount: G.formatPrice(activeTier.giftAmount) }))}</span>`;

    const progressHtml = `
      <div class="gift-widget__progress">
        <div class="gift-widget__progress-info">${infoText}</div>
        ${renderScale(allTiers, activeTier, thresholdBase, STEP_WIDTH)}
      </div>
    `;

    // ── Selected gifts ──
    const selectedHtml = giftItems.length === 0 ? "" : `
      <div class="gift-widget__selected-list">
        ${giftItems.map((item) => `
          <div class="gift-widget__selected-item" data-gift-key="${esc(item.key)}">
            ${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.product_title)}" class="gift-widget__selected-image" loading="lazy" />` : ""}
            <div class="gift-widget__selected-info">
              <p class="gift-widget__selected-name">${esc(item.product_title)}</p>
              <p class="gift-widget__selected-price">${esc(G.formatPrice(G.getOriginalUnitPrice(item)))}</p>
            </div>
            <button type="button"
              class="gift-widget__selected-remove"
              data-gift-remove="${esc(item.key)}"
              aria-label="${esc(t("remove"))}"
              ${removingGiftKey === item.key ? "disabled" : ""}>
              <span class="gift-widget__remove-label" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                </svg>
              </span>
              ${removingGiftKey === item.key ? '<span class="gift-widget__remove-spinner"></span>' : ""}
            </button>
          </div>
        `).join("")}
      </div>
    `;

    // Budget fully used: nothing more to choose
    if (remainingBudget <= 0) {
      setAllContainersHtml(`
        <div class="gift-widget">
          <p class="gift-widget__promo-title">${esc(t("promo_title"))}</p>
          ${progressHtml}
          ${selectedHtml}
          <h2 class="gift-widget__budget-full-title gift-widget__budget-full-title--success">
            ${esc(t("budget_full", { amount: G.formatPrice(activeTier.giftAmount) }))}
          </h2>
          <p class="gift-widget__footnote">${esc(t("footnote"))}</p>
        </div>
      `);
      return;
    }

    // ── Gift selection ──
    const budgetLabel = giftItems.length > 0
      ? t("remaining", { amount: G.formatPrice(remainingBudget) })
      : t("choose_up_to", { amount: G.formatPrice(activeTier.giftAmount) });

    // Skeleton cards first (prevents layout jump), replaced once products load
    const skeletonCards = Array.from({ length: 5 }, () => `
      <div class="gift-widget__card gift-widget__card--skeleton">
        <div class="gift-widget__skeleton-image"></div>
        <div class="gift-widget__info">
          <div class="gift-widget__skeleton-line gift-widget__skeleton-line--name"></div>
          <div class="gift-widget__skeleton-line gift-widget__skeleton-line--price"></div>
        </div>
        <div class="gift-widget__skeleton-button"></div>
      </div>
    `).join("");

    const step1 = isStepOne(state);
    setAllContainersHtml(`
      <div class="gift-widget${step1 ? " gift-widget--step1" : ""}">
        <p class="gift-widget__promo-title">${esc(t("promo_title"))}</p>
        <p class="gift-widget__subtitle">${esc(budgetLabel)}</p>
        ${progressHtml}
        ${selectedHtml}
        <div class="gift-widget__carousel gift-widget__carousel--loading">${skeletonCards}</div>
        <p class="gift-widget__footnote">${esc(t("footnote"))}</p>
        ${step1 ? `<button type="button" class="gift-widget__skip-button" data-gift-skip>${esc(t("skip_step"))}</button>` : ""}
      </div>
    `);

    scrollScaleToCurrent(containers, allTiers, thresholdBase, STEP_WIDTH);

    const excludeIds = new Set(
      cart.items
        .filter((item) => !item.properties?.[GIFT_PROPERTY_KEY])
        .map((item) => String(item.variant_id)),
    );

    let products;
    try {
      products = await G.fetchGiftProducts(remainingBudget, excludeIds);
    } catch (e) {
      console.error("[Gift Widget] Failed to fetch products:", e);
      getContainers().forEach((el) => {
        const carousel = el.querySelector(".gift-widget__carousel--loading");
        if (!carousel) return;
        carousel.outerHTML = `
          <div class="gift-widget__selection-loading">
            <p class="gift-widget__subtitle">${esc(t("unable_load"))}</p>
            <button type="button" class="gift-widget__retry">${esc(t("retry"))}</button>
          </div>
        `;
        el.querySelector(".gift-widget__retry")?.addEventListener("click", () => renderWidget(cart, state));
      });
      return;
    }

    const selectionHtml = products.length === 0
      ? `<p class="gift-widget__subtitle">${esc(t("no_products", { amount: G.formatPrice(remainingBudget) }))}</p>`
      : `
        <div class="gift-widget__carousel">
          ${products.map((p) => `
            <div class="gift-widget__card" data-variant-id="${esc(p.variantId)}">
              ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" class="gift-widget__image" loading="lazy" />` : ""}
              <div class="gift-widget__info">
                <p class="gift-widget__name">${esc(p.title)}</p>
                <p class="gift-widget__price">${esc(G.formatPrice(p.price))}</p>
              </div>
              <button type="button" class="gift-widget__select" data-gift-select="${esc(p.variantId)}" data-tier-id="${esc(activeTier.id)}">
                <span class="gift-widget__select-label">${esc(t("select"))}</span>
                <span class="gift-widget__select-spinner" style="display:none"></span>
              </button>
            </div>
          `).join("")}
        </div>
      `;

    getContainers().forEach((el) => {
      const loadingCarousel = el.querySelector(".gift-widget__carousel--loading");
      if (loadingCarousel) loadingCarousel.outerHTML = selectionHtml;
    });
  }

  // ─── Cart actions (delegate to gift-core) ──────────────────

  async function selectGift(variantId, tierId) {
    if (isSelectingGift) return;
    isSelectingGift = true;

    const allButtons = document.querySelectorAll(".gift-widget__select");
    allButtons.forEach((btn) => { btn.disabled = true; });

    const clickedBtns = document.querySelectorAll(`[data-gift-select="${CSS.escape(String(variantId))}"]`);
    const toggleSpinner = (loading) => clickedBtns.forEach((btn) => {
      const label = btn.querySelector(".gift-widget__select-label");
      const spinner = btn.querySelector(".gift-widget__select-spinner");
      if (label) label.style.display = loading ? "none" : "";
      if (spinner) spinner.style.display = loading ? "inline-block" : "none";
    });
    toggleSpinner(true);
    const restoreSelection = () => {
      allButtons.forEach((btn) => { btn.disabled = false; });
      toggleSpinner(false);
    };

    try {
      let result = await G.addGift(variantId, Number(tierId));
      if (result.code === "PROMO_CHOICE_REQUIRED") {
        const codeLabel = (result.discountCodes || []).join(", ");
        const useGift = await G.requestPromoChoice({
          title: t("promo_choice_title"),
          message: t("promo_choice_message", { code: codeLabel }),
          keepLabel: t("promo_keep", { code: codeLabel }),
          useGiftLabel: t("promo_use_gift"),
        });
        if (!useGift) {
          restoreSelection();
          return;
        }
        result = await G.addGift(variantId, Number(tierId), { replaceExternalDiscounts: true });
      }
      if (!result.ok) {
        const error = new Error(result.error || t("notif_add_failed"));
        error.result = result;
        throw error;
      }
      // gift-core already refreshed the cart; show it right away
      forceStep2();
    } catch (e) {
      console.error("[Gift Widget] Failed to add gift:", e);
      const conflictCodes = e.result?.discountCodes || [];
      const message = e.result?.code === "DISCOUNT_COMBINATION_CONFLICT"
        ? t("promo_conflict", { code: conflictCodes.join(", ") })
        : (e.message || t("notif_add_failed"));
      showWidgetError(message);
      showNotification(message, "warning");
      restoreSelection();
    } finally {
      isSelectingGift = false;
    }
  }

  async function removeGift(key) {
    if (removingGiftKey) return;
    removingGiftKey = key;

    const removeBtns = document.querySelectorAll(`[data-gift-remove="${CSS.escape(key)}"]`);
    removeBtns.forEach((btn) => {
      btn.disabled = true;
      const label = btn.querySelector(".gift-widget__remove-label");
      if (label) label.style.display = "none";
      if (!btn.querySelector(".gift-widget__remove-spinner")) {
        const spinner = document.createElement("span");
        spinner.className = "gift-widget__remove-spinner";
        spinner.style.display = "inline-block";
        btn.appendChild(spinner);
      }
    });

    try {
      const result = await G.removeGift(key);
      if (!result.ok) {
        throw new Error(result.error || t("notif_remove_failed"));
      }
    } catch (e) {
      console.error("[Gift Widget] Failed to remove gift:", e);
      showNotification(t("notif_remove_failed"), "warning");
      removeBtns.forEach((btn) => {
        btn.disabled = false;
        const label = btn.querySelector(".gift-widget__remove-label");
        if (label) label.style.display = "";
        btn.querySelector(".gift-widget__remove-spinner")?.remove();
      });
    } finally {
      removingGiftKey = null;
    }
  }

  // Delegated click handling — survives re-renders and section swaps.
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest("[data-gift-widget]")) return;

    const selectBtn = target.closest("[data-gift-select]");
    if (selectBtn) {
      selectGift(selectBtn.dataset.giftSelect, selectBtn.dataset.tierId);
      return;
    }
    const removeBtn = target.closest("[data-gift-remove]");
    if (removeBtn) {
      removeGift(removeBtn.dataset.giftRemove);
      return;
    }
    if (target.closest("[data-gift-skip]")) {
      const sections = getMainCartSections();
      sections.forEach((s) => { s.style.display = ""; });
      getContainers().forEach((el) => {
        el.classList.remove("gift-widget-container--step1");
        el.querySelector(".gift-widget")?.classList.remove("gift-widget--step1");
      });
      sections[0]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // ─── Cart update listener ──────────────────────────────────

  function scheduleCartRefresh(cart = null) {
    if (cart && typeof cart.total_price === "number") pendingEventCart = cart;
    if (cartUpdateDebounce) clearTimeout(cartUpdateDebounce);
    cartUpdateDebounce = setTimeout(async () => {
      cartUpdateDebounce = null;
      const nextCart = pendingEventCart;
      pendingEventCart = null;
      await onCartUpdate(nextCart || await G.fetchCart());
    }, cart ? 75 : 300);
  }

  function listenForCartUpdates() {
    // Our own gift changes
    G.onCartUpdate((cart) => scheduleCartRefresh(cart));

    // Cart changes made by the theme (quantity buttons, product forms)
    G.onCartMutation(() => {
      if (isSelectingGift || removingGiftKey) return;
      scheduleCartRefresh();
    });

    // Themes that announce cart changes with events
    ["cart:updated", "cart:refresh", "cart:change", "cart-update"].forEach((eventName) => {
      document.addEventListener(eventName, (event) => {
        if (G.isRefreshing() || isSelectingGift || removingGiftKey) return;
        scheduleCartRefresh(event?.detail?.cart || event?.detail?.baseCart);
      });
    });

    // A theme re-render can replace the block with fresh (unrendered) markup.
    if (typeof MutationObserver !== "undefined") {
      let observerDebounce = null;
      new MutationObserver(() => {
        if (observerDebounce) clearTimeout(observerDebounce);
        observerDebounce = setTimeout(() => {
          observerDebounce = null;
          if (initPromise || handlingUpdate || isSelectingGift || removingGiftKey) return;
          const stale = [...getContainers()].some((el) => el.dataset.giftRendered !== "true");
          if (stale) init();
        }, 300);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  // ─── Utils ─────────────────────────────────────────────────

  function showNotification(message, type) {
    getContainers().forEach((el) => {
      const notif = document.createElement("div");
      notif.className = `gift-widget__notification gift-widget__notification--${type}`;
      notif.setAttribute("role", "status");
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

  listenForCartUpdates();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/**
 * Product Gift Button — Product page logic.
 *
 * Uses the shared gift-core.js runtime (window.giftApp) for:
 *   - eligibility checks
 *   - cart state and cart change notifications
 *   - gift add workflow
 *
 * This file handles, for every "Add as gift" block on the page:
 *   - Reading the currently selected variant (any theme: form input, common
 *     variant events, or the ?variant= URL parameter)
 *   - Rendering button states (eligible, over budget, unavailable, etc.)
 *   - Calling giftApp.addGift() on click
 */

(function () {
  const G = window.giftApp;
  if (!G) {
    console.error("[Product Gift Button] gift-core.js must be loaded before product-gift-button.js");
    return;
  }

  // Variant change events used by popular themes.
  const VARIANT_EVENTS = ["variant:change", "variant:changed", "variantChange", "on:variant:change", "product:variant-change"];

  function setupButton(container) {
    if (container.dataset.giftButtonReady === "true") return;
    container.dataset.giftButtonReady = "true";

    const originalDisplay = container.style.display;
    container.style.display = "none";

    const button = container.querySelector(".add-as-gift__button");
    const labelEl = container.querySelector(".add-as-gift__label");
    const spinnerEl = container.querySelector(".add-as-gift__spinner");
    const statusEl = container.querySelector(".add-as-gift__status");
    const remainingEl = container.querySelector(".add-as-gift__remaining");

    let variants = [];
    try {
      variants = JSON.parse(container.querySelector("[data-gift-product-variants]")?.textContent || "[]");
    } catch {
      console.warn("[Product Gift Button] Could not parse variant JSON");
    }

    const translations = G.readTranslations(container.querySelector("[data-gift-product-translations]"));

    function t(key, vars) {
      let str = translations[key];
      if (str == null) return "";
      for (const [k, v] of Object.entries(vars || {})) {
        str = str.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
      }
      return str;
    }

    // Labels from the locale file arrive HTML-escaped by Liquid's `t` filter.
    function getLabel(key) {
      return G.decodeHtml(container.dataset[key] || "");
    }

    // ─── Variant selection ─────────────────────────────────────

    // Liquid's variant JSON has prices in the customer's currency, in cents.
    let currentVariant = null;

    function findVariantById(id) {
      return variants.find((v) => String(v.id) === String(id)) || null;
    }

    function getProductForm() {
      const custom = container.dataset.productFormSelector;
      if (custom) {
        try {
          const el = document.querySelector(custom);
          if (el) return el;
        } catch {
          // Invalid merchant selector — fall back to detection
        }
      }
      // Prefer the form in the same section as this block.
      const section = container.closest('[id^="shopify-section-"]') || document;
      const productId = container.dataset.productId;
      return (
        section.querySelector(`form[action*="/cart/add"] input[name="product-id"][value="${productId}"]`)?.form ||
        section.querySelector('form[action*="/cart/add"]') ||
        document.querySelector('form[action*="/cart/add"]')
      );
    }

    function readSelectedVariantId() {
      const input = getProductForm()?.querySelector('[name="id"]');
      if (input?.value && findVariantById(input.value)) return input.value;
      const fromUrl = new URLSearchParams(window.location.search).get("variant");
      if (fromUrl && findVariantById(fromUrl)) return fromUrl;
      return container.dataset.variantId || "";
    }

    function syncVariant() {
      const id = readSelectedVariantId();
      if (currentVariant && String(currentVariant.id) === String(id)) return false;
      currentVariant = findVariantById(id) || {
        id,
        price: parseInt(container.dataset.variantPrice || "0", 10),
        available: container.dataset.variantAvailable === "true",
      };
      return true;
    }

    function onVariantMaybeChanged() {
      if (syncVariant()) updateButton();
    }

    function listenForVariantChanges() {
      document.addEventListener("change", (event) => {
        const form = getProductForm();
        if (form && event.target instanceof Node && form.contains(event.target)) {
          // Themes update the hidden id input after their own change handler.
          setTimeout(onVariantMaybeChanged, 0);
        }
      });
      VARIANT_EVENTS.forEach((name) => document.addEventListener(name, () => setTimeout(onVariantMaybeChanged, 0)));
      window.addEventListener("popstate", onVariantMaybeChanged);
      // Fallback for themes that swap the id input or only update the URL.
      setInterval(() => {
        if (document.visibilityState === "visible") onVariantMaybeChanged();
      }, 750);
    }

    // ─── Button state rendering ─────────────────────────────────

    function setButtonState({ label, disabled, showSpinner, statusText, statusType, remainingText }) {
      if (labelEl) labelEl.textContent = label;
      button.disabled = !!disabled;
      if (spinnerEl) spinnerEl.style.display = showSpinner ? "inline-block" : "none";

      if (statusEl) {
        statusEl.textContent = statusText || "";
        statusEl.className = `add-as-gift__status add-as-gift__status--${statusType || "info"}`;
        statusEl.style.display = statusText ? "" : "none";
      }

      if (remainingEl) {
        remainingEl.textContent = remainingText || "";
        remainingEl.style.display = remainingText ? "" : "none";
      }
    }

    let isAdding = false;

    async function updateButton() {
      if (isAdding || !currentVariant) return;

      if (currentVariant.available === false) {
        setButtonState({ label: getLabel("unavailableLabel"), disabled: true });
        return;
      }

      try {
        const variantId = currentVariant.id;
        const eligibility = await G.getEligibility(variantId, {
          price: Number(currentVariant.price),
          available: currentVariant.available !== false,
        });
        // Variant changed or an add started while we waited
        if (isAdding || String(currentVariant.id) !== String(variantId)) return;

        const remainingBudgetText = eligibility.remainingBudget != null
          ? t("remaining_budget", { amount: G.formatPrice(eligibility.remainingBudget) })
          : "";

        if (eligibility.eligible) {
          setButtonState({
            label: getLabel("buttonLabel"),
            disabled: false,
            remainingText: container.dataset.showRemaining === "true" ? remainingBudgetText : "",
          });
        } else if (eligibility.reason === "no_tier") {
          setButtonState({
            label: getLabel("disabledLabel"),
            disabled: true,
            remainingText: eligibility.amountToUnlock > 0
              ? t("add_more", { amount: G.formatPrice(eligibility.amountToUnlock) })
              : "",
          });
        } else if (eligibility.reason === "over_budget") {
          setButtonState({ label: getLabel("overBudgetLabel"), disabled: true, remainingText: remainingBudgetText });
        } else if (eligibility.reason === "excluded_collection" || eligibility.reason === "excluded_tag") {
          setButtonState({ label: getLabel("excludedLabel"), disabled: true });
        } else if (eligibility.reason === "unavailable") {
          setButtonState({ label: getLabel("unavailableLabel"), disabled: true });
        } else if (eligibility.reason === "busy") {
          setButtonState({ label: getLabel("loadingLabel"), disabled: true });
        } else {
          setButtonState({ label: getLabel("disabledLabel"), disabled: true });
        }
      } catch (e) {
        console.error("[Product Gift Button] Eligibility check failed:", e);
        setButtonState({ label: getLabel("disabledLabel"), disabled: true });
      }
    }

    // ─── Click handler ─────────────────────────────────────────

    async function handleClick() {
      if (isAdding || button.disabled || !currentVariant) return;
      isAdding = true;
      let addSucceeded = false;

      setButtonState({ label: getLabel("loadingLabel"), disabled: true, showSpinner: true });

      try {
        const variantInfo = { price: Number(currentVariant.price), available: currentVariant.available !== false };
        const eligibility = await G.getEligibility(currentVariant.id, variantInfo);
        if (!eligibility.eligible) {
          throw new Error(eligibility.reason || "not eligible");
        }

        let result = await G.addGift(currentVariant.id, eligibility.tierId);
        if (result.code === "PROMO_CHOICE_REQUIRED") {
          const codeLabel = (result.discountCodes || []).join(", ");
          const useGift = await G.requestPromoChoice({
            title: t("promo_choice_title"),
            message: t("promo_choice_message", { code: codeLabel }),
            keepLabel: t("promo_keep", { code: codeLabel }),
            useGiftLabel: t("promo_use_gift"),
          });
          if (!useGift) {
            setButtonState({ label: getLabel("buttonLabel"), disabled: false });
            return;
          }
          result = await G.addGift(currentVariant.id, eligibility.tierId, { replaceExternalDiscounts: true });
        }
        if (!result.ok) {
          throw new Error(result.error || "Unable to add.");
        }

        addSucceeded = true;
        setButtonState({
          label: getLabel("buttonLabel"),
          disabled: true,
          statusText: t("added"),
          statusType: "success",
        });
      } catch (e) {
        console.error("[Product Gift Button] Failed to add:", e);
        setButtonState({
          label: getLabel("buttonLabel"),
          disabled: false,
          statusText: getLabel("errorLabel"),
          statusType: "error",
        });
        setTimeout(updateButton, 3000);
      } finally {
        isAdding = false;
        if (addSucceeded) updateButton();
      }
    }

    // ─── Cart update listener ──────────────────────────────────

    let cartUpdateDebounce = null;
    function scheduleButtonRefresh(delay = 400) {
      if (isAdding) return;
      if (cartUpdateDebounce) clearTimeout(cartUpdateDebounce);
      cartUpdateDebounce = setTimeout(() => {
        cartUpdateDebounce = null;
        updateButton();
      }, delay);
    }

    // ─── Init ──────────────────────────────────────────────────

    async function init() {
      syncVariant();
      listenForVariantChanges();
      G.onCartUpdate(() => scheduleButtonRefresh(200));
      G.onCartMutation(() => scheduleButtonRefresh(400));
      ["cart:updated", "cart:refresh", "cart:change", "cart-update"].forEach((name) => {
        document.addEventListener(name, () => {
          if (!G.isRefreshing()) scheduleButtonRefresh(300);
        });
      });

      button.addEventListener("click", handleClick);

      try {
        await G.ensureConfig();
      } catch (e) {
        console.warn("[Product Gift Button] Config load failed:", e);
      }

      if (!G.getSettings().active) {
        container.remove();
        return;
      }

      container.style.display = originalDisplay;
      updateButton();
    }

    init();
  }

  function setupAll() {
    document.querySelectorAll("[data-gift-product-button]").forEach(setupButton);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupAll);
  } else {
    setupAll();
  }
  // Quick-view modals and section re-renders can add blocks later.
  document.addEventListener("shopify:section:load", setupAll);
  if (typeof MutationObserver !== "undefined") {
    let pending = null;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        setupAll();
      }, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }
})();

/**
 * Product Gift Button — Product page logic.
 *
 * Uses the shared gift-core.js runtime (window.giftApp) for:
 *   - eligibility checks
 *   - cart state
 *   - gift add/remove workflow
 *
 * This file handles:
 *   - Reading the currently selected variant
 *   - Listening for variant changes (Dawn + generic)
 *   - Rendering button states (eligible, over budget, unavailable, etc.)
 *   - Calling giftApp.addGift() on click
 *   - Re-evaluating eligibility after cart updates
 */

(function () {
  const container = document.getElementById("add-as-gift-container");
  if (!container) return;

  if (window.productGiftButtonInitialized) return;
  window.productGiftButtonInitialized = true;

  const G = window.giftApp;
  if (!G) {
    console.error("[Product Gift Button] gift-core.js must be loaded before product-gift-button.js");
    return;
  }

  // ─── DOM refs ──────────────────────────────────────────────

  const button = container.querySelector(".add-as-gift__button");
  const labelEl = container.querySelector(".add-as-gift__label");
  const spinnerEl = container.querySelector(".add-as-gift__spinner");
  const statusEl = container.querySelector(".add-as-gift__status");
  const remainingEl = container.querySelector(".add-as-gift__remaining");

  const variantsJson = document.querySelector("[data-gift-product-variants]");
  let variants = [];
  try {
    variants = JSON.parse(variantsJson?.textContent || "[]");
  } catch {
    console.warn("[Product Gift Button] Could not parse variant JSON");
  }

  // ─── State ──────────────────────────────────────────────────

  let currentVariantId = container.dataset.variantId || "";
  let currentVariantPrice = parseInt(container.dataset.variantPrice || "0", 10);
  let currentVariantAvailable = container.dataset.variantAvailable === "true";
  let isAdding = false;
  let lastEligibility = null;

  // ─── Variant selection ─────────────────────────────────────

  function getProductForm() {
    return (
      document.querySelector('form[action*="/cart/add"]') ||
      document.querySelector('form[data-type="add-to-cart-form"]') ||
      document.querySelector("product-form form")
    );
  }

  function getVariantInput() {
    const form = getProductForm();
    return form?.querySelector('input[name="id"], select[name="id"]');
  }

  function findVariantById(id) {
    return variants.find((v) => String(v.id) === String(id));
  }

  function readSelectedVariant() {
    const input = getVariantInput();
    if (input) {
      const id = input.value;
      const variant = findVariantById(id);
      if (variant) {
        currentVariantId = String(variant.id);
        currentVariantPrice = Math.round(parseFloat(variant.price || "0") * 100);
        currentVariantAvailable = variant.available !== false;
        return;
      }
    }
    // Fallback to data attributes
    currentVariantId = container.dataset.variantId || "";
    currentVariantPrice = parseInt(container.dataset.variantPrice || "0", 10);
    currentVariantAvailable = container.dataset.variantAvailable === "true";
  }

  function listenForVariantChanges() {
    const input = getVariantInput();
    if (input) {
      input.addEventListener("change", () => {
        readSelectedVariant();
        updateButton();
      });
    }

    // Dawn dispatches custom events on variant change
    document.addEventListener("variant:changed", (e) => {
      const v = e?.detail?.variant;
      if (v && v.id) {
        currentVariantId = String(v.id);
        currentVariantPrice = Math.round(parseFloat(v.price || "0") * 100);
        currentVariantAvailable = v.available !== false;
        updateButton();
      }
    });

    // Some themes use a custom element that updates the hidden input
    const form = getProductForm();
    if (form && typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        readSelectedVariant();
        updateButton();
      });
      const targetInput = getVariantInput();
      if (targetInput) {
        observer.observe(targetInput, { attributes: true, childList: false, subtree: false });
      }
    }
  }

  // ─── Button state rendering ─────────────────────────────────

  function setButtonState({ label, disabled, showSpinner, statusText, statusType, remainingText }) {
    if (labelEl) labelEl.textContent = label;
    button.disabled = !!disabled;
    if (spinnerEl) spinnerEl.style.display = showSpinner ? "inline-block" : "none";

    if (statusEl) {
      if (statusText) {
        statusEl.textContent = statusText;
        statusEl.className = `add-as-gift__status add-as-gift__status--${statusType || "info"}`;
        statusEl.style.display = "";
      } else {
        statusEl.style.display = "none";
      }
    }

    if (remainingEl) {
      if (remainingText) {
        remainingEl.textContent = remainingText;
        remainingEl.style.display = "";
      } else {
        remainingEl.style.display = "none";
      }
    }
  }

  function getLabel(key) {
    return container.dataset[key] || "";
  }

  async function updateButton() {
    if (isAdding) return;

    if (!currentVariantAvailable) {
      setButtonState({
        label: getLabel("unavailableLabel") || "Unavailable as gift",
        disabled: true,
      });
      return;
    }

    try {
      const eligibility = await G.getEligibility(currentVariantId);
      lastEligibility = eligibility;

      if (isAdding) return; // state changed during async

      if (eligibility.eligible) {
        const remainingText = container.dataset.showRemaining === "true" && eligibility.remainingBudget != null
          ? `Remaining gift budget: ${G.formatPrice(eligibility.remainingBudget)}`
          : "";
        setButtonState({
          label: getLabel("buttonLabel") || "Add as gift",
          disabled: false,
          remainingText,
        });
      } else if (eligibility.reason === "no_tier") {
        const amountToUnlock = eligibility.amountToUnlock || 0;
        const remainingText = amountToUnlock > 0
          ? `Add ${G.formatPrice(amountToUnlock)} more to unlock gifts`
          : "";
        setButtonState({
          label: getLabel("disabledLabel") || "Add more to unlock gifts",
          disabled: true,
          remainingText,
        });
      } else if (eligibility.reason === "over_budget") {
        const remainingText = eligibility.remainingBudget != null
          ? `Remaining gift budget: ${G.formatPrice(eligibility.remainingBudget)}`
          : "";
        setButtonState({
          label: getLabel("overBudgetLabel") || "Exceeds remaining gift budget",
          disabled: true,
          remainingText,
        });
      } else if (eligibility.reason === "busy") {
        setButtonState({
          label: getLabel("loadingLabel") || "Adding gift…",
          disabled: true,
        });
      } else {
        setButtonState({
          label: getLabel("disabledLabel") || "Add more to unlock gifts",
          disabled: true,
        });
      }
    } catch (e) {
      console.error("[Product Gift Button] Eligibility check failed:", e);
      setButtonState({
        label: getLabel("disabledLabel") || "Add more to unlock gifts",
        disabled: true,
      });
    }
  }

  // ─── Click handler ─────────────────────────────────────────

  async function handleClick() {
    if (isAdding || button.disabled) return;
    isAdding = true;

    setButtonState({
      label: getLabel("loadingLabel") || "Adding gift…",
      disabled: true,
      showSpinner: true,
    });

    try {
      // Re-check eligibility right before adding
      const eligibility = await G.getEligibility(currentVariantId);
      if (!eligibility.eligible) {
        throw new Error(eligibility.reason || "not eligible");
      }

      const result = await G.addGift(currentVariantId, eligibility.tierId);
      if (!result.ok) {
        throw new Error(result.error || "Unable to add this gift.");
      }

      setButtonState({
        label: getLabel("buttonLabel") || "Add as gift",
        disabled: false,
        statusText: "Gift added to cart!",
        statusType: "success",
      });
      // Re-evaluate after a short delay
      setTimeout(updateButton, 1500);
    } catch (e) {
      console.error("[Product Gift Button] Failed to add gift:", e);
      setButtonState({
        label: getLabel("buttonLabel") || "Add as gift",
        disabled: false,
        statusText: getLabel("errorLabel") || "Could not add free gift — try again",
        statusType: "error",
      });
      setTimeout(updateButton, 3000);
    } finally {
      isAdding = false;
    }
  }

  // ─── Cart update listener ──────────────────────────────────

  let cartUpdateDebounce = null;

  function scheduleButtonRefresh(delay = 500) {
    if (isAdding) return;
    if (cartUpdateDebounce) clearTimeout(cartUpdateDebounce);
    cartUpdateDebounce = setTimeout(() => {
      cartUpdateDebounce = null;
      updateButton();
    }, delay);
  }

  function listenForCartUpdates() {
    // 1. Listen for common cart event names across Dawn versions.
    //    Dawn's pubsub uses "cart-update"; older themes use "cart:updated".
    [
      "cart:updated", "cart:refresh", "cart:change",
      "cart-update", "quantity-update", "cart-error",
    ].forEach((eventName) => {
      window.addEventListener(eventName, () => scheduleButtonRefresh(300));
    });

    // 2. Intercept fetch calls to cart endpoints.
    //    Dawn's <product-form> submits via fetch('/cart/add') and may not
    //    dispatch any of the events above, so we also watch the network layer.
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      const isCartMutation =
        url.includes("/cart/add") ||
        url.includes("/cart/change") ||
        url.includes("/cart/update");

      const response = await originalFetch.call(this, input, init);

      if (isCartMutation && response.ok) {
        // Re-check eligibility after the cart mutation completes.
        // Use a short delay so Dawn's own section rendering finishes first.
        scheduleButtonRefresh(500);
      }

      return response;
    };

    // 3. Listen for product form submit (fallback for non-fetch submissions)
    const productForm = getProductForm();
    if (productForm) {
      productForm.addEventListener("submit", () => scheduleButtonRefresh(1000));
    }
  }

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    readSelectedVariant();
    listenForVariantChanges();
    listenForCartUpdates();

    button.addEventListener("click", handleClick);

    try {
      await G.ensureConfig();
    } catch (e) {
      console.warn("[Product Gift Button] Config load failed:", e);
    }

    updateButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

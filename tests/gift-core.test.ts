// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(join(__dirname, "../extensions/gift-widget/assets/gift-core.js"), "utf8");

type Handler = (url: string, init?: RequestInit) => unknown;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Load gift-core.js into the jsdom window with a mocked fetch. */
function loadCore(handler: Handler, shopify: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    jsonResponse(handler(String(input), init)),
  );
  const w = window as any;
  delete w.giftApp;
  w.fetch = fetchMock;
  w.Shopify = shopify;
  new Function(source)();
  return { G: w.giftApp, fetchMock };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("routes and money", () => {
  it("builds storefront URLs under the locale folder", () => {
    const { G } = loadCore(() => ({}), { routes: { root: "/fr/" } });
    expect(G.storefrontUrl("cart/add.js")).toBe("/fr/cart/add.js");
  });

  it("uses the shop money format for the shop currency", () => {
    document.body.innerHTML = `<div data-gift-app data-shop-currency="EUR" data-money-format="{{amount_with_comma_separator}} &euro;"></div>`;
    const { G } = loadCore(() => ({}), { currency: { active: "EUR", rate: "1.0" } });
    expect(G.formatPrice(123456)).toBe("1.234,56 €");
  });

  it("converts shop amounts to the customer's currency", () => {
    const { G } = loadCore(() => ({}), { currency: { active: "CAD", rate: "1.5" } });
    expect(G.toPresentment(1000)).toBe(1500);
  });

  it("escapes product titles", () => {
    const { G } = loadCore(() => ({}));
    expect(G.escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });
});

describe("tiers", () => {
  it("converts tier amounts with the currency rate", async () => {
    document.body.innerHTML = `<div data-gift-app data-proxy-path="/apps/gifts"></div>`;
    const { G, fetchMock } = loadCore(
      (url) =>
        url.endsWith("/tiers")
          ? { tiers: [{ id: 1, minAmount: 10000, giftAmount: 1000 }] }
          : { settings: { active: true, useTotalAfterDiscounts: true } },
      { currency: { active: "GBP", rate: "0.8" } },
    );
    await G.ensureConfig();
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain("/apps/gifts/tiers");
    expect(G.getTiers()[0]).toMatchObject({ minAmount: 8000, giftAmount: 800, shopMinAmount: 10000 });
  });
});

describe("embedded config", () => {
  const embed = (config: unknown) => {
    const el = document.createElement("div");
    el.setAttribute("data-gift-app", "");
    el.setAttribute("data-gift-config", JSON.stringify(config));
    document.body.appendChild(el);
  };
  const base = {
    tiers: [{ id: 1, minAmount: 5000, giftAmount: 500 }],
    settings: { active: true, useTotalAfterDiscounts: true },
  };

  it("uses the metafield config without calling the app proxy", async () => {
    embed({ ...base, billing: { unlimited: true, trialEndsAt: null } });
    const { G, fetchMock } = loadCore(() => ({}));
    await G.ensureConfig();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(G.getTiers()).toHaveLength(1);
    expect(G.getSettings().active).toBe(true);
  });

  it("turns gifts off once the trial date has passed", async () => {
    embed({ ...base, billing: { unlimited: false, trialEndsAt: "2020-01-01T00:00:00Z" } });
    const { G } = loadCore(() => ({}));
    await G.ensureConfig();
    expect(G.getSettings().active).toBe(false);
  });
});

describe("refreshCart", () => {
  it("re-renders cart sections, keeps the drawer open and keeps live app blocks", async () => {
    document.body.innerHTML = `
      <div id="shopify-section-cart-drawer">
        <cart-drawer class="drawer active"><div data-gift-app id="gift-drawer-1">live</div><p class="count">1</p></cart-drawer>
      </div>
      <div id="shopify-section-header"><a href="/cart">Cart <span class="bubble">1</span></a></div>
      <div id="shopify-section-footer"><p>footer</p></div>
    `;
    let requestedSections = "";
    const { G } = loadCore((url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith("/cart/update.js") && body.sections) {
        requestedSections = body.sections;
        return { item_count: 2, items: [], sections: {
          "cart-drawer": `<div id="shopify-section-cart-drawer"><cart-drawer class="drawer"><div data-gift-app id="gift-drawer-1">fresh</div><p class="count">2</p></cart-drawer></div>`,
          header: `<div id="shopify-section-header"><a href="/cart">Cart <span class="bubble">2</span></a></div>`,
        } };
      }
      return {};
    });
    const events: string[] = [];
    document.addEventListener("gift:cart-updated", () => events.push("gift:cart-updated"));

    await G.refreshCart({ item_count: 2, items: [] });

    expect(requestedSections).toBe("cart-drawer,header");
    expect(document.querySelector(".count")?.textContent).toBe("2");
    expect(document.querySelector(".bubble")?.textContent).toBe("2");
    expect(document.querySelector("cart-drawer")?.classList.contains("active")).toBe(true);
    expect(document.getElementById("gift-drawer-1")?.textContent).toBe("live");
    expect(events).toEqual(["gift:cart-updated"]);
  });

  it("doesn't reload the cart page when sections render", async () => {
    window.history.replaceState({}, "", "/cart");
    document.body.innerHTML = `<div id="shopify-section-main-cart"><form action="/cart"><p class="line">1</p></form></div>`;
    const { G } = loadCore((url) =>
      url.endsWith("/cart/update.js")
        ? { item_count: 1, items: [], sections: { "main-cart": `<div id="shopify-section-main-cart"><form action="/cart"><p class="line">2</p></form></div>` } }
        : {},
    );
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, pathname: "/cart", reload } });
    try {
      await G.refreshCart({ item_count: 1, items: [] });
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
    expect(reload).not.toHaveBeenCalled();
    expect(document.querySelector(".line")?.textContent).toBe("2");
  });

  it("re-renders section IDs added in the block settings", () => {
    document.body.innerHTML = `
      <div data-gift-app data-refresh-sections="custom-cart"></div>
      <div id="shopify-section-custom-cart"></div>
    `;
    const { G } = loadCore(() => ({}));
    expect(G.cartSectionIds()).toContain("custom-cart");
  });
});

describe("cart watcher", () => {
  it("stops the theme from raising a gift line's quantity", async () => {
    const cart = {
      item_count: 2,
      items: [
        { key: "paid", variant_id: 1, quantity: 1, properties: {} },
        { key: "gift", variant_id: 2, quantity: 1, properties: { _gift: "true" } },
      ],
    };
    const { G, fetchMock } = loadCore((url) => (url.includes("cart.js") ? cart : cart));
    await G.fetchCart();

    await window.fetch("/cart/change.js", {
      method: "POST",
      body: JSON.stringify({ id: "gift", quantity: 3 }),
    });
    const sent = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(sent).toEqual({ id: "gift", quantity: 1 });

    await window.fetch("/cart/change.js", {
      method: "POST",
      body: JSON.stringify({ id: "paid", quantity: 3 }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ id: "paid", quantity: 3 });
  });

  it("notifies listeners about theme cart changes", async () => {
    const { G } = loadCore(() => ({}));
    const seen: string[] = [];
    G.onCartMutation((url: string) => seen.push(url));
    await window.fetch("/cart/add.js", { method: "POST", body: "{}" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["/cart/add.js"]);
  });
});

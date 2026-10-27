// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const asset = (name: string) =>
  readFileSync(join(__dirname, "../extensions/gift-widget/assets", name), "utf8");

describe("cart page widget", () => {
  it("renders the gift budget and escaped gift products", async () => {
    document.body.innerHTML = `
      <div id="shopify-section-main-cart"><form action="/cart"></form></div>
      <div id="shopify-section-apps">
        <div id="gift-widget-1" data-gift-widget data-gift-app data-shop-currency="USD" data-money-format="\${{amount}}"></div>
      </div>
      <script type="application/json" data-gift-translations>
        { "promo_title": "Free gift", "choose_up_to": "Choose gifts up to {{ amount }}", "select": "Select",
          "gift_budget_max": "{{ amount }} gift budget", "footnote": "" }
      </script>
    `;
    const cart = {
      item_count: 1,
      total_price: 12000,
      discount_codes: [],
      items: [{ key: "a", variant_id: 1, quantity: 1, final_line_price: 12000, original_line_price: 12000, properties: {} }],
    };
    const w = window as any;
    w.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/tiers")
        ? { tiers: [{ id: 7, minAmount: 10000, giftAmount: 1500 }] }
        : url.includes("/settings")
          ? { settings: { active: true, useTotalAfterDiscounts: true } }
          : url.includes("/products")
            ? { products: [{ variantId: "9", title: "<b>Mug</b>", price: 1200, image: "" }] }
            : cart;
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    });
    w.Shopify = { currency: { active: "USD", rate: "1.0" } };
    // jsdom doesn't implement element scrolling.
    Element.prototype.scrollTo = () => {};
    delete w.giftApp;
    delete w.giftWidgetInitialized;

    new Function(asset("gift-core.js"))();
    new Function(asset("gift-widget.js"))();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-gift-select]")).not.toBeNull();
    });
    const widget = document.getElementById("gift-widget-1")!;
    expect(widget.textContent).toContain("Choose gifts up to $15.00");
    expect(widget.querySelector(".gift-widget__name")?.innerHTML).toBe("&lt;b&gt;Mug&lt;/b&gt;");
    expect(widget.querySelector("[data-gift-select]")?.getAttribute("data-tier-id")).toBe("7");
    // The cart stays visible unless the merchant enables the gift-first step.
    expect((document.getElementById("shopify-section-main-cart") as HTMLElement).style.display).toBe("");
  });
});

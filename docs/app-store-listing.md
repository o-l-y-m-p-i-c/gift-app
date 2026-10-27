# Gift Threshold — Shopify App Store submission

Copy for each field of the App Store listing and the review submission. Character counts are shown next to each field. The limits in brackets are the usual Partner Dashboard limits; the form's own counter is the final word.

App URL: `https://gift-app-ux53.onrender.com`

## Before you submit

1. **Protected customer data** (Partner Dashboard → App → API access → Protected customer data access). Without this, `shopify app deploy` fails with "not approved to subscribe to webhook topics containing protected customer data". Use the answers in [Protected customer data request](#protected-customer-data-request).
2. **Pricing:** set the app to manual pricing (Billing API), not Managed Pricing.
3. **Emergency developer contact:** add one in Partner Dashboard → Settings (requirement 4.5.6).
4. **Support email:** set `SUPPORT_EMAIL` on Render so the privacy policy page shows it, and use the same address in the listing.
5. **Deploy:** run `shopify app deploy --allow-updates` once step 1 is approved.
6. **App name:** the Partner Dashboard app is called "Gift App" but `shopify.app.toml` says "Gift Threshold". Deploying the config renames it; the listing name must match (requirement 4.1.1).

## Listing

### App name (14 / 30)

Gift Threshold

### App icon

1200 × 1200 px, JPEG or PNG. A simple gift box symbol on a solid color, with no text, pricing or Shopify trademarks (requirements 4.2.2, 4.4.3).

### App card subtitle (40 / 62)

Free gifts that unlock as the cart grows

### App introduction (99 / 100)

Reward bigger orders with a free gift your customers choose themselves once their cart hits a tier.

### App details (462 / 500)

Set spending tiers, and each tier unlocks a gift budget. When a customer's cart reaches a tier, they choose free gifts from your catalog up to that budget, on the cart page, in the cart drawer or from a product page. The app adds the gift, makes it free with a single-use discount code and removes it if the cart drops below the tier. Exclude collections or tags, count totals before or after discounts, and match the widgets to your theme from the theme editor.

### Feature list (each ≤ 80)

| # | Feature | Length |
| --- | --- | --- |
| 1 | Spending tiers that each unlock a gift budget, set in your shop currency | 72 |
| 2 | Gift picker on the cart page, cart drawer and product pages of any theme | 72 |
| 3 | Gifts are removed automatically if the cart drops below the tier | 64 |
| 4 | Exclude collections or tags from being offered as gifts | 55 |
| 5 | Gift history with order links and total gift value | 50 |

### Pricing

Pricing goes only in the pricing section, never in the name, icon, screenshots or text above (requirement 4.2.3).

| Field | Value |
| --- | --- |
| Plan name | Gift App Pro |
| Price | $9.99 USD / month (every 30 days) |
| Free trial | 14 days |
| Plan features | Unlimited gift tiers · Gift picker on cart, drawer and product pages · Collection and tag exclusions · Gift history |
| Note | Free on Shopify development stores |

### Categories and search terms

- **Primary category:** Selling products → Discounts
- **Secondary category:** Marketing and conversion → Upselling and cross-selling
- **Search terms (up to 5):** free gift, gift with purchase, GWP, spend threshold, tiered rewards

### Screenshots (1600 × 900, 16:9)

Show only the app's own UI, with no browser frame or desktop background, and make each image different (requirements 4.4.4, 4.4.5). No pricing, statistics or reviews in the images.

| # | What to capture | Alt text |
| --- | --- | --- |
| 1 | Cart page with the gift widget: progress scale and gift cards | Gift picker on the cart page showing the unlocked gift budget and gifts to choose |
| 2 | Cart drawer with the drawer widget | Cart drawer showing progress to the next gift tier |
| 3 | Product page with the "Add as gift" button | Add as gift button on a product page with the remaining gift budget |
| 4 | Admin: Gift Tiers page with several tiers | Gift tiers with minimum cart totals and gift budgets |
| 5 | Admin: Settings page with exclusions | Settings for discount handling and excluded collections and tags |
| 6 | Theme editor with the block's style and advanced settings | Theme editor settings for the gift widget's colors and cart refresh |

### Feature media

Optional promotional video of 2–3 minutes, or a 1600 × 900 feature image showing the cart widget.

### Links

| Field | Value |
| --- | --- |
| Privacy policy URL | https://gift-app-ux53.onrender.com/privacy |
| Support email | Your support address (also set as `SUPPORT_EMAIL`) |
| Demo store URL | A development store with the app installed and sample tiers loaded |
| FAQ / documentation | Optional — the README's Theme setup section works as a start |

## Protected customer data request

The app subscribes to `orders/create` to record which orders included a gift. It needs **Level 1** (protected customer data) only. It does not need Level 2 fields (name, email, phone, address).

- **Why the app needs the data:** "To record gift history. When an order is created, the app reads the order's line items to find gift lines and stores the order ID, gift product, gift price and cart total so the merchant can see which orders received gifts."
- **Data minimization:** "The app only stores the order ID, product IDs and amounts. It does not store any customer name, email, phone number or address."
- **Retention:** "Gift history is deleted when Shopify sends customers/redact for the customer's orders and when shop/redact is received after uninstall."
- **Encryption and access:** "Data is stored in a managed PostgreSQL database encrypted at rest and accessed only over TLS. Only the app server's database credentials can read it."

## Review submission

### Testing instructions

1. Install the app on the review store. It opens on the Dashboard; development stores are free, other stores start a 14-day free trial.
2. Go to **Gift Tiers** and click **Load sample tiers** (for example: a cart of $50 unlocks a $2.50 gift budget, $100 unlocks $7.50).
3. In **Online Store → Customize**, open the cart template and add the **Gift Widget** block. Optionally add **Add as Gift** to the product template and enable the **Gift Drawer Embed** app embed.
4. On the storefront, add products worth more than $50 to the cart and open the cart page. The widget shows the unlocked gift budget and gift products that fit it.
5. Click **Select** on a gift. It's added to the cart at $0 with a single-use discount code.
6. Lower the cart below $50. The gift is removed automatically.
7. To test billing on a non-development store, open **Billing** in the app and click **Subscribe**. The Shopify charge approval page opens; approve or decline it, and you can request it again from the Billing page.

### Screencast

Record onboarding and every step above in English: install, loading tiers, adding the theme blocks, choosing a gift, the gift being removed, and the billing page (requirement 4.5.3).

### Scopes

| Scope | Why |
| --- | --- |
| `read_products` | List gift products and check variant prices and availability |
| `read_discounts` | Check whether a customer's promo code can combine with the gift |
| `write_discounts` | Create the single-use discount code that makes the gift free |
| `read_orders` | Record gift history from new orders |

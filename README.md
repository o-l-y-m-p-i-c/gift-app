# Gift Threshold

A public Shopify app that gives customers a free gift when their cart reaches a spending threshold. Each tier sets a minimum cart total and a gift budget (a percentage of that total). Customers pick gifts up to that budget on the cart page, in the cart drawer, or from a product page.

## How it works

1. The merchant sets gift tiers in the app admin (or loads the sample tiers).
2. The theme blocks show the customer's progress and the gifts they can choose.
3. When a gift is chosen, the app creates a single-use BXGY discount code that makes exactly the chosen gifts free, adds the gift to the cart and applies the code.
4. If the cart drops below the tier, or a promo code stops the gift being free, the gift is removed.
5. `orders/create` records each gift in the History page.

Tier amounts are stored in the shop currency. The storefront converts them to the customer's currency with `Shopify.currency.rate`.

## Pricing

- 14-day free trial
- Free on Shopify development stores
- $9.99 USD every 30 days on production stores, billed through the Shopify invoice

The plan name, price, currency and trial length come from env vars (see below).

## Setting up a new app

1. **Create the app** in the Partner Dashboard (or Dev Dashboard) and copy its client ID and client secret.
2. **Link the config:** run `shopify app config link` and pick the new app. This fills `client_id` and the URLs in `shopify.app.toml`. Or replace the `YOUR_CLIENT_ID` and `YOUR_APP_HOST` placeholders by hand.
3. **Set env vars** on the host (see `.env.example`): `DATABASE_URL`, `DIRECT_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, and optionally the `BILLING_*` vars.
   - `DATABASE_URL` is the pooled connection the app uses. On Neon, that's the host ending in `-pooler`.
   - `DIRECT_URL` is the direct connection for migrations: the same database, with the `-pooler` part removed from the host. Prisma's migration lock doesn't work through a pooler, so migrations over the pooled URL hang and leave the lock held. Without a pooler, set both to the same value.
4. **Deploy the server.** `render.yaml` deploys to Render on an always-on plan, runs `prisma migrate deploy` on start, and checks `/healthz`. The `Dockerfile` does the same anywhere else.
5. **Deploy the app config and theme extension:** `npm run shopify:deploy`. This registers the webhooks, including the GDPR compliance webhooks, the app proxy and the scopes.
6. **Partner Dashboard settings:**
   - **Pricing:** use manual pricing (Billing API), not Managed Pricing. Otherwise subscription requests fail.
   - **Protected customer data:** request access for `orders/create` (Level 1 is enough; the app reads no names, emails or addresses).
   - **App listing:** copy for every listing field, the protected customer data request and the reviewer instructions is in [docs/app-store-listing.md](docs/app-store-listing.md). The privacy policy is served at `/privacy`. Describe the four scopes: `read_products`, `read_discounts`, `write_discounts`, `read_orders`.

### Moving an existing database

The schema is now managed with Prisma migrations. For a database that was created earlier with `prisma db push`, mark the initial migration as applied once before the first deploy:

```bash
npx prisma migrate resolve --applied 20261027000000_init
```

## Theme setup

In **Online Store → Customize**:

- **Cart page:** add the **Gift Widget** block.
- **Product page:** add the **Add as Gift** block.
- **Cart drawer:** add the **Gift Drawer Widget** block if the drawer section supports app blocks. Otherwise enable the **Gift Drawer Embed** app embed.

The blocks work on any Online Store 2.0 theme. Colors follow the section's color scheme, and the button color and corner radius are block settings. If a theme needs help, each block has **Advanced** settings:

| Setting | Use it when |
| --- | --- |
| Cart refresh after a gift change | The cart doesn't update after adding a gift. Pick "Reload the page". |
| Extra section IDs to refresh | A cart count or drawer on the page isn't refreshed automatically. |
| Cart drawer selector / position | The drawer embed can't find the theme's cart drawer. |
| Product form selector | The product button doesn't follow the selected variant. |
| App proxy path | The app proxy URL was renamed in Shopify admin. |

After every gift change the app dispatches `gift:cart-updated` (and `cart:refresh`, `cart:updated`, `cart:change`) on `document` with `{ cart }` in `detail`, so theme code can react.

## Development

```bash
npm install
npm run shopify:dev     # Shopify CLI dev server with tunnel
npm run typecheck
npm run lint
npm test
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build on every push and pull request.

## Project layout

- `app/` — Remix admin app, storefront API routes (`api.*`, served through the app proxy) and webhooks
- `extensions/gift-widget/` — theme app extension (blocks, scripts, styles, translations)
- `prisma/` — schema and migrations
- `tests/` — storefront runtime tests (jsdom)

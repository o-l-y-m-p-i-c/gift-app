# Gift App — Issues Before Public Release

Oct 27, 2026 · @Nick · updated after the fixes on the same day

## Summary

27 of 31 issues are resolved in code. Two need a step outside the code before launch: protected customer data approval (S5) and a billing test on a development store (B1). Two remain open by choice: admin translations (B4) and exact payment figures (B2).

- **Critical (5):** all resolved, including S7 found while fixing the others.
- **High (13), Medium (7), Low (6).**
- **Scope:** the Remix app, Prisma schema, the theme app extension and deploy config.

Statuses: Open, In progress, Needs check (needs a manual step or a live store), Done. The sections below keep the original problem descriptions.

## Issue tracker

Sorted by severity.

| ID | Issue | Area | Severity | Status | Resolution |
| --- | --- | --- | --- | --- | --- |
| T1 | Cart refresh hardcoded to Dawn and Prestige selectors | Theme | Critical | Done | Generic Section Rendering API refresh of all cart sections, keeps open drawers and live app blocks; refresh mode and extra section IDs are block settings |
| T3 | Prices hardcoded to EUR and de-DE format | Theme | Critical | Done | Prices use the customer's currency; shop money format when it matches; amounts converted with Shopify.currency.rate |
| S1 | orders/create and app/uninstalled webhooks skip HMAC check | Security | Critical | Done | orders/create and app/uninstalled call authenticate.webhook first |
| S3 | No GDPR compliance webhooks | Compliance | Critical | Done | /webhooks/compliance handles all three topics; registered via compliance_topics |
| S7 | Admin actions trusted a shopId from the form | Security | Critical | Done | Tiers and Settings actions now authenticate and use session.shop; tier deletes scoped to the shop |
| T2 | Global window.fetch override in two scripts | Theme | High | Done | One chained fetch wrapper in gift-core.js plus a PerformanceObserver for XHR themes; XHR is no longer patched |
| T4 | Hardcoded /cart, /products.json and app proxy URLs | Theme | High | Done | All storefront URLs built from Shopify.routes.root; app proxy path is a block setting |
| T6 | CSS depends on Prestige CSS variables | Theme | High | Done | Colors derive from currentColor with color-mix; button color, text color and radius are block settings |
| T7 | Drawer embed only finds a cart-drawer element | Theme | High | Done | Drawer selector and position settings, plus detection for common drawer markup |
| T9 | Gift catalogue loaded by paging /products.json | Theme | High | Done | /products.json fallbacks removed; server caches the eligible catalogue per shop for 5 minutes |
| S5 | orders/create needs protected customer data approval | Compliance | High | Needs check | Request protected customer data (Level 1) in the Partner Dashboard; documented in README |
| B1 | Billing untested on a real store | Billing | High | Needs check | Test subscribe, cancel and trial expiry on a development store |
| B3 | Davines branding and presets in a public app | App Store | High | Done | Generic name and copy; sample tiers replace the Davines preset; client placeholders in shopify.app.toml |
| B5 | Checkout UI extension is an empty placeholder | App Store | High | Done | Empty checkout extension removed |
| F1 | Tier amounts stored without a currency | Data | High | Done | AppSettings.currencyCode synced from the shop; admin pages and the storefront use it |
| O1 | prisma db push --accept-data-loss on every start | Ops | High | Done | Initial Prisma migration committed; start runs prisma migrate deploy |
| O2 | Free Render plan sleeps when idle | Ops | High | Done | render.yaml uses the always-on starter plan with a /healthz check |
| S8 | Product titles rendered as raw HTML in the widgets | Security | High | Done | Product titles, images and keys are HTML-escaped; inline onclick handlers replaced |
| T5 | Fixed element ids clash when a block is added twice | Theme | Medium | Done | IDs use block.id; scripts select by data attributes; several blocks per page work |
| T8 | data-shop uses request.host, not the myshopify domain | Theme | Medium | Done | Uses shop.permanent_domain |
| T10 | Product form detection covers only 3 selectors | Theme | Medium | Done | Product form selector setting, common variant events, URL and input polling |
| S2 | getShopId can fall back to another shop | Security | Medium | Done | getShopId and other unused ?shop= helpers deleted |
| B4 | Admin is English only; storefront has en, lv, ru | App Store | Medium | In progress | Storefront in 8 languages (en, de, fr, es, it, nl, lv, ru); admin is still English only |
| F2 | Extension config split across several files | Functions | Medium | Done | Unused Rust functions removed; one shopify.extension.toml for the theme extension |
| O3 | No tests, lint or CI for the app | Ops | Medium | Done | Vitest unit and jsdom tests (21), ESLint, GitHub Actions CI |
| S4 | CORS allows any origin | Security | Low | Done | CORS headers only outside production |
| S6 | Access scopes need a least-privilege review | Compliance | Low | Done | Dropped write_products and write_app_proxy; four scopes remain, each explained in shopify.app.toml |
| B2 | Payment statistics are estimates | Billing | Low | Open | Accepted for launch: page labels figures as estimates; exact data needs the Partner API |
| O4 | Leftover files in the repo | Ops | Low | Done | CSV, cart_drawer.html, vite.config.js, web/ and the checkout placeholder removed |
| O5 | .env.example says SQLite, schema is PostgreSQL | Ops | Low | Done | .env.example shows a PostgreSQL URL and the billing vars |
| O6 | Custom nav links instead of the App Bridge nav menu | App Store | Low | Done | Duplicate in-page nav removed; App Bridge NavMenu includes Billing |

## Theme compatibility

The storefront code assumes Dawn or Prestige markup. On most other themes, the widget can't refresh the cart after adding a gift. Merchants also can't adjust it from the theme editor. All files are under `extensions/gift-widget/`.

- **T1 — Cart refresh hardcoded to two themes.** `gift-widget.js:281-387` and `gift-core.js:864-949` re-render `cart-drawer`, `cart-drawer-items`, `form.cart-page`, `#cart-icon-bubble` and the `main-cart` section. Fix: after a cart change, dispatch a documented event (for example `gift:cart-updated`) and fall back to a page reload. Add block settings for the section IDs and selectors to refresh.
- **T2 — Global window.fetch override.** `gift-widget.js:1025` and `product-gift-button.js:352` both replace `window.fetch` to watch cart calls. This stacks with themes and other apps that do the same. Fix: wrap it once, in `gift-core.js`, and chain the previous fetch. Prefer theme cart events or a `PerformanceObserver` where they exist.
- **T3 — EUR only.** `gift-core.js:1022` formats every price as `de-DE` EUR, and admin pages print `€`. Fix: use `Shopify.currency.active` and the shop's money format from Liquid (`shop.money_format`). Convert thresholds with `Shopify.currency.rate` for Markets.
- **T4 — Hardcoded URLs.** `/cart`, `/cart/*.js`, `/products.json` and `/apps/gift-threshold` ignore locale and market subfolders (`/fr/cart`). They also ignore a merchant-renamed app proxy path. Fix: build URLs from `window.Shopify.routes.root`. Pass the proxy path from Liquid instead of hardcoding it.
- **T5 — Fixed element IDs.** `#gift-widget-container` and `#add-as-gift-container` break if a block is added twice, for example on a quick-view. Fix: use `data-` attributes plus `block.id`.
- **T6 — Prestige CSS variables.** `gift-widget.css` reads `--text-color` (33 uses), `--button-background` and `--container-sm-max-width`, which other themes don't define. Fix: add fallbacks for each variable. Expose colour, radius and font settings in the block schema.
- **T7 — Drawer embed only finds cart-drawer.** `gift-drawer.js:113-166` mounts only inside a `cart-drawer` element. Fix: add a "drawer container selector" setting, and recommend the app block where the theme supports one.
- **T8 — data-shop uses request.host.** On a custom domain this isn't the `myshopify.com` domain. Fix: use `shop.permanent_domain`.
- **T9 — Catalogue loaded in the browser.** `gift-core.js:368` and `gift-widget.js:858` page through `/products.json`, which is slow on large stores and ignores market prices. Fix: return the eligible gifts from the app proxy, or use the Storefront API with `@inContext`.
- **T10 — Product form detection.** `product-gift-button.js:88-90` checks only three form selectors. Fix: add a selector setting, and listen for the theme's `variant:change` events.

## Security and multi-tenancy

Two webhooks trust any caller, and this is the most urgent fix. With many shops installed, a forged request can write fake gift history for any shop or delete its sessions.

- **S1 — Webhooks skip HMAC check.** `webhooks.orders-create.tsx` and `webhooks.app-uninstalled.tsx` read the `X-Shopify-Shop-Domain` header without verifying it. Fix: call `authenticate.webhook(request)` first, as `webhooks.app-subscriptions-update.tsx` does.
- **S2 — getShopId can return another shop.** `app/lib/shop.server.ts` falls back to the newest session, then any tier, then `demo-shop`. Nothing uses it today. Fix: delete it so no future route can leak data across shops.
- **S7 — Admin actions trusted the form.** The Tiers and Settings actions in `app.tiers.tsx` and `app.settings.tsx` ran without `authenticate.admin` and wrote to whatever `shopId` the form sent, so anyone could change another shop's tiers. Found while fixing S1.
- **S8 — Product titles rendered as HTML.** The widgets built markup from product titles and image URLs without escaping, so a title containing HTML would run in the storefront.
- **S4 — CORS allows any origin.** `app/lib/cors.ts` sends `Access-Control-Allow-Origin: *` and an ngrok header. Storefront calls go through the app proxy on the shop's own origin, so this isn't needed. Fix: remove it, or limit it to development.

## Billing, App Store and compliance

App Store review will reject the app as it stands. The GDPR webhooks are missing, the checkout extension is empty, and it carries a client's brand.

- **S3 — No GDPR compliance webhooks.** Public apps must handle `customers/data_request`, `customers/redact` and `shop/redact`. Fix: add them under `[webhooks]` with `compliance_topics` in `shopify.app.toml`. On `shop/redact`, delete the shop's tiers, settings, history and billing rows.
- **S5 — Protected customer data.** Subscribing to `orders/create` with `read_orders` requires approval for protected customer data in the Partner Dashboard. Fix: request the minimum level, or use the order's gift line properties from a Function instead.
- **S6 — Scope review.** `write_products` and `write_app_proxy` are requested; check each is used and drop the rest. Reviewers ask for a reason for every scope.
- **B1 — Billing untested.** The subscription flow (14-day trial, free on development stores, $9.99/month) passes typecheck and build only. Fix: switch the Partner Dashboard to manual pricing, then test subscribe, cancel and trial expiry on a development store with `SHOPIFY_BILLING_TEST=true`.
- **B2 — Payment stats are estimates.** They are counted from 30-day cycles because the Admin API doesn't list charges. Fix, if exact figures matter: read app charges from the Partner API.
- **B3 — Davines branding.** The app name in `shopify.app.toml`, the discount title in `app/lib/gift-discount.server.ts`, the tier preset in `app/lib/tiers.ts` and the dashboard copy all say Davines. Fix: rename them, and turn the preset into an optional sample or remove it.
- **B4 — Languages.** The admin is English only, and the storefront has en, lv and ru. Fix: add at least the App Store's main languages to `locales/`, and move admin strings to i18n.
- **B5 — Empty checkout extension.** `extensions/checkout-ui/src/CheckoutBlock.tsx` exports nothing, yet it's listed in `shopify.app.toml`. Fix: build it, or remove it until it's ready.
- **O6 — Admin navigation.** `app/routes/app.tsx` renders links in a Card. Built for Shopify expects the App Bridge `NavMenu`. Fix: switch to `NavMenu`.

## Functions and data

Thresholds only work in one currency, so shops selling in several Markets would give gifts at the wrong cart totals.

- **F1 — Tier amounts have no currency.** `GiftTier.minAmount` and `giftAmount` are "cents EUR" per the schema comment, and `app.tiers.tsx` prints `€`. Fix: store the shop's currency on each tier, compare in the shop currency on the server, and convert presentment amounts in the Function. Goes with T3.
- **F2 — Extension config is split.** `gift-widget` has both `extension.toml` and `shopify.extension.toml`. `cart-transform` uses the old `extension.toml` format. `shopify.app.toml` lists extensions in an `[[extensions]]` table that the CLI doesn't read. I haven't confirmed which config the CLI deploys. Fix: keep one `shopify.extension.toml` per extension, then check `shopify app deploy` output.

## Ops and repo hygiene

The current hosting setup can lose data and goes to sleep when idle. Neither is acceptable once other merchants depend on it.

- **O1 — Schema pushed with data loss allowed.** `render.yaml` and `Dockerfile` run `prisma db push --accept-data-loss` on every start, so a schema change can silently drop columns. Fix: commit Prisma migrations and run `prisma migrate deploy`.
- **O2 — Free Render plan sleeps.** The first storefront or webhook request after an idle spell waits for a cold start. Shopify times out app proxy calls after a few seconds. Fix: move to a paid always-on plan before launch.
- **O3 — No tests, lint or CI.** The only test is `extensions/gift-discount/tests/default.test.js`. Fix: add unit tests for billing access, tier math and gift-code validation. Add ESLint and a CI job that runs typecheck and build.
- **O4 — Leftover files.** `Davines Discount logic - Sheet1.csv`, `cart_drawer.html`, both `vite.config.js` and `vite.config.ts`, `web/` and `CheckoutBlock.js`. Fix: delete or move them out of the repo.
- **O5 — .env.example mismatch.** It says SQLite (`file:./dev.db`), but the schema uses PostgreSQL. Fix: show a Postgres URL.

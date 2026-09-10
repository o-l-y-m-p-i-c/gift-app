# План разработки Gift Threshold App

## 1. Архитектура приложения

```
┌─────────────────────────────────────────────────────────────────┐
│                        SHOPIFY STORE                            │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │  Storefront   │   │   Cart       │   │   Checkout       │    │
│  │  (витрина)    │   │   (корзина)  │   │   (оформление)   │    │
│  │              │   │              │   │                  │    │
│  │  Товары      │   │ ┌──────────┐ │   │ ┌──────────────┐ │    │
│  │  Коллекции   │   │ │ Виджет   │ │   │ │ Cart         │ │    │
│  │  Поиск       │   │ │ подарка  │ │   │ │ Transform    │ │    │
│  │              │   │ │ (App     │ │   │ │ Function      │ │    │
│  │              │   │ │  Block)  │ │   │ │ (скидка 100%) │ │    │
│  │              │   │ └──────────┘ │   │ └──────────────┘ │    │
│  │              │   │              │   │                  │    │
│  └──────────────┘   └──────────────┘   └──────────────────┘    │
│         │                  │                   │               │
│         │                  │                   │               │
└─────────┼──────────────────┼───────────────────┼───────────────┘
          │                  │                   │
          │ Storefront API   │ /cart.js          │ Shopify Function
          │ (товары)         │ (состояние)       │ (Run API)
          │                  │                   │
          ▼                  ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     APP BACKEND (Remix)                         │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Admin UI │  │ API      │  │ Webhooks │  │ Storefront   │   │
│  │ (пороги) │  │ Routes   │  │ Handler  │  │ API Proxy    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│       │              │              │              │            │
│       └──────────────┴──────────────┴──────────────┘            │
│                             │                                   │
│                    ┌──────────────┐                             │
│                    │   Prisma     │                             │
│                    │   (SQLite)   │                             │
│                    └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Структура проекта

```
gift-threshold-app/
├── app/                          # Remix backend
│   ├── routes/
│   │   ├── _index.tsx            # Dashboard
│   │   ├── app._index.tsx        # Главная админки
│   │   ├── app.tiers.tsx         # Настройка порогов
│   │   ├── app.products.tsx      # Выбор товаров-подарков
│   │   ├── app.settings.tsx      # Общие настройки
│   │   ├── app.history.tsx       # История подарков
│   │   └── webhooks.orders-create.tsx  # Webhook
│   ├── models/
│   │   ├── tier.server.ts        # CRUD порогов
│   │   ├── gift.server.ts        # CRUD подарков
│   │   └── history.server.ts     # История
│   ├── services/
│   │   ├── shopify.server.ts     # Shopify client
│   │   ├── storefront.server.ts  # Storefront API
│   │   └── threshold.server.ts   # Логика расчёта порога
│   └── db.server.ts              # Prisma client
├── extensions/
│   ├── gift-widget/              # Theme App Extension
│   │   ├── blocks/
│   │   │   └── gift-widget.liquid # App Block для корзины
│   │   ├── assets/
│   │   │   ├── gift-widget.js    # Логика виджета
│   │   │   └── gift-widget.css   # Стили
│   │   └── extension.toml
│   └── cart-transform/           # Shopify Function
│       ├── src/
│       │   ├── graphql/
│       │   │   └── cart_transform.graphql
│       │   ├── function.rs       # Rust логика
│       │   └── main.rs
│       ├── Cargo.toml
│       └── extension.toml
├── prisma/
│   └── schema.prisma             # Схема БД
├── shopify.app.toml              # Конфиг приложения
├── package.json
└── README.md
```

## 3. Схема базы данных

```
┌─────────────────────────────────────────────────────────────┐
│                      PRISMA SCHEMA                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐     ┌─────────────────────────┐   │
│  │   GiftTier          │     │   GiftProduct           │   │
│  ├─────────────────────┤     ├─────────────────────────┤   │
│  │ id: Int (PK)        │◄───┐│ id: Int (PK)            │   │
│  │ shopId: String      │    ││ shopId: String          │   │
│  │ minAmount: Int      │    └│ tierId: Int (FK)        │   │
│  │ giftPercent: Float  │     │ productId: String       │   │
│  │ collectionId: String│     │ variantId: String       │   │
│  │   (nullable)        │     │ title: String           │   │
│  │ active: Boolean     │     │ price: Int              │   │
│  │ createdAt: DateTime │     │ image: String (nullable)│   │
│  │ updatedAt: DateTime │     │ active: Boolean         │   │
│  └─────────────────────┘     └─────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   GiftHistory                                       │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ id: Int (PK)                                        │   │
│  │ shopId: String                                      │   │
│  │ orderId: String                                     │   │
│  │ tierId: Int (FK)                                    │   │
│  │ giftProductId: String                               │   │
│  │ giftProductTitle: String                            │   │
│  │ giftProductPrice: Int                               │   │
│  │ cartTotal: Int                                      │   │
│  │ thresholdBase: Int                                  │   │
│  │ createdAt: DateTime                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   AppSettings                                       │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ id: Int (PK)                                        │   │
│  │ shopId: String (unique)                             │   │
│  │ useTotalAfterDiscounts: Boolean (default: true)     │   │
│  │ showLevelUpNotification: Boolean (default: true)    │   │
│  │ showRemovalNotification: Boolean (default: true)    │   │
│  │ active: Boolean (default: true)                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 4. Flow — пользовательский путь

```
┌─────────────────────────────────────────────────────────────────┐
│                    ПОЛЬЗОВАТЕЛЬСКИЙ FLOW                         │
└─────────────────────────────────────────────────────────────────┘

  Пользователь заходит в магазин
            │
            ▼
  Добавляет товары в корзину
            │
            ▼
  Открывает страницу корзины (/cart)
            │
            ▼
  ┌─────────────────────────────────────────┐
  │  App Block (gift-widget.liquid)         │
  │                                         │
  │  1. Читать cart.total_price             │
  │  2. Вычесть подарок (если есть)         │
  │  3. Определить активный порог           │
  │  4. Рассчитать maxGiftPrice             │
  │  5. Запросить товары через              │
  │     Storefront API (price <= max)       │
  │  6. Отрисовать виджет                   │
  └─────────────────────────────────────────┘
            │
            ├─ Сумма < минимального порога
            │     → Виджет скрыт
            │
            ├─ Сумма ≥ порога, подарок не выбран
            │     → Показать карусель подарков
            │     → "Выберите подарок до 11.70€"
            │
            ├─ Пользователь выбирает подарок
            │     → POST /cart/add.js (с properties._gift)
            │     → Перерисовать корзину
            │     → Подарок виден в корзине
            │
            ├─ Пользователь применяет промокод
            │     → cart:updated event
            │     → Пересчёт thresholdBase
            │     → Если порог упал → удалить подарок
            │     → Если порог вырос → показать новые подарки
            │
            ▼
  Переход к чекауту (/checkout)
            │
            ▼
  ┌─────────────────────────────────────────┐
  │  Cart Transform Function (Rust)         │
  │                                         │
  │  1. Найти line с properties._gift       │
  │  2. Перепроверить порог                 │
  │     (useTotalAfterDiscounts setting)    │
  │  3. Если порог достигнут →              │
  │     CartTransformOperation:             │
  │       price = 0 (бесплатно)             │
  │  4. Если порог НЕ достигнут →           │
  │     Удалить подарок из заказа           │
  └─────────────────────────────────────────┘
            │
            ▼
  Заказ оформлен
            │
            ▼
  ┌─────────────────────────────────────────┐
  │  Webhook: orders/create                 │
  │                                         │
  │  1. Проверить наличие подарка в заказе  │
  │  2. Записать в GiftHistory              │
  │  3. Сохранить для аналитики             │
  └─────────────────────────────────────────┘
```

## 5. Flow — расчёт порога

```
┌─────────────────────────────────────────────────────────────────┐
│                   РАСЧЁТ ПОРОГА                                  │
└─────────────────────────────────────────────────────────────────┘

  cart.total_price (после всех скидок и промокодов)
         │
         │  минус
         ▼
  giftPrice (цена товара-подарка, 0 если подарка нет)
         │
         │  равно
         ▼
  thresholdBase = cart.total_price - giftPrice
         │
         │
         ▼
  ┌─────────────────────────────────────────────┐
  │  Настройка: useTotalAfterDiscounts          │
  │                                             │
  │  Если TRUE (после промокодов):              │
  │    base = cart.total_price - giftPrice      │
  │                                             │
  │  Если FALSE (до промокодов):                │
  │    base = cart.items_subtotal_price         │
  │           - giftPrice                       │
  └─────────────────────────────────────────────┘
         │
         ▼
  Найти максимальный порог где minAmount <= thresholdBase
         │
         ▼
  maxGiftPrice = tier.minAmount × (tier.giftPercent / 100)
         │
         ▼
  Показать товары с price <= maxGiftPrice

  ─────────────────────────────────────────────

  ПРИМЕРЫ:

  1. Без промокода
     Товары: 135€, Промокод: нет
     thresholdBase = 135€ - 0€ = 135€
     Активный порог: 130€ (9%)
     maxGiftPrice = 130 × 0.09 = 11.70€

  2. С промокодом (режим "после")
     Товары: 145€, Промокод: -15€
     thresholdBase = 130€ - 0€ = 130€
     Активный порог: 130€ (9%)
     maxGiftPrice = 130 × 0.09 = 11.70€

  3. Подарок + промокод (режим "после")
     Товары: 150€, Промокод: -10€, Подарок: 13.30€
     thresholdBase = 140€ - 13.30€ = 126.70€
     Активный порог: НЕТ (ниже 130€)
     → Подарок удаляется

  4. С промокодом (режим "до")
     Товары: 145€, Промокод: -15€
     thresholdBase = 145€ - 0€ = 145€
     Активный порог: 140€ (9.5%)
     maxGiftPrice = 140 × 0.095 = 13.30€
```

## 6. Этапы разработки

```
┌─────────────────────────────────────────────────────────────────┐
│                     ЭТАПЫ РАЗРАБОТКИ                            │
└─────────────────────────────────────────────────────────────────┘

  ЭТАП 1: Скаффолд (1 день)
  ─────────────────────────────
  □ npm create @shopify/app@latest
  □ Создать Theme App Extension
  □ Создать Cart Transform Function
  □ Настроить shopify.app.toml
  □ Git init + первый коммит

           │
           ▼

  ЭТАП 2: База данных + Models (1 день)
  ─────────────────────────────
  □ Prisma schema (GiftTier, GiftProduct, GiftHistory, AppSettings)
  □ Модели: tier.server.ts, gift.server.ts, history.server.ts
  □ Settings server (useTotalAfterDiscounts, notifications)
  □ Миграция Prisma

           │
           ▼

  ЭТАП 3: Admin UI (2 дня)
  ─────────────────────────────
  □ Dashboard — обзор (активные пороги, статистика)
  □ Tiers page — CRUD порогов (minAmount, percent, collection)
  □ Products page — выбор товаров-подарков через Admin API
  □ Settings page — переключатель до/после промокодов
  □ History page — таблица выданных подарков
  □ Shopify App Bridge integration

           │
           ▼

  ЭТАП 4: Theme App Extension (2 дня)
  ─────────────────────────────
  □ gift-widget.liquid (App Block)
  □ gift-widget.js — логика:
    □ Чтение cart.total_price
    □ Расчёт thresholdBase
    □ Определение активного порога
    □ Запрос товаров через Storefront API
    □ Отрисовка карусели подарков
    □ Добавление подарка в корзину (POST /cart/add.js)
    □ Слушатель cart:updated
    □ Автоудаление подарка при падении ниже порога
    □ Уведомление при смене уровня
  □ gift-widget.css — стили

           │
           ▼

  ЭТАП 5: Cart Transform Function (1 день)
  ─────────────────────────────
  □ GraphQL query (cart transform)
  □ Rust логика:
    □ Найти line с properties._gift
    □ Перепроверить порог (server-side)
    □ Применить price = 0 если порог достигнут
    □ Удалить подарок если порог не достигнут
  □ Тестирование на dev store

           │
           ▼

  ЭТАП 6: Webhooks + История (0.5 дня)
  ─────────────────────────────
  □ Webhook orders/create
  □ Запись в GiftHistory
  □ History page в админке

           │
           ▼

  ЭТАП 7: Тестирование (1 день)
  ─────────────────────────────
  □ Тест: достижение порога → подарок доступен
  □ Тест: промокод снижает сумму → подарок удаляется
  □ Тест: подарок не влияет на порог
  □ Тест: смена уровня → уведомление
  □ Тест: заказ с подарком → скидка 100% в чекауте
  □ Тест: заказ без подарка → ничего не меняется
  □ Тест: webhook → запись в истории

           │
           ▼

  ЭТАП 8: Деплой (0.5 дня)
  ─────────────────────────────
  □ shopify app deploy
  □ Установка на продакшн магазин
  □ Проверка на живом магазине
```

## 7. API — Storefront API запрос товаров-подарков

```graphql
query GetGiftProducts($maxPrice: Money!, $collectionId: ID) {
  products(
    first: 20
    query: $priceQuery
    sortKey: PRICE
  ) {
    edges {
      node {
        id
        title
        featuredImage {
          url
          altText
        }
        variants(first: 1) {
          edges {
            node {
              id
              price {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
}
```

## 8. API — Admin API (управление товарами)

```graphql
# Создать мета-поле на товаре — пометить как подарок
mutation SetGiftMetafield($productId: ID!, $metafield: MetafieldInput!) {
  metafieldSet(metafield: $metafield) {
    metafield {
      id
      namespace
      key
      value
    }
  }
}

# metafield:
# namespace: "gift"
# key: "is_gift"
# value: "true"
```

## 9. Безопасность

```
┌─────────────────────────────────────────────────────────────────┐
│                     ЗАЩИТА ОТ ЗЛОУПОТРЕБЛЕНИЙ                  │
└─────────────────────────────────────────────────────────────────┘

  Клиент (виджет корзины):
  ├── Подарок исключается из thresholdBase
  ├── Только 1 подарок на корзину
  ├── Автоудаление при падении ниже порога
  └── Перепроверка при каждом cart:updated

  Сервер (Cart Transform Function):
  ├── Перепроверка порога перед применением скидки
  ├── Если порог не достигнут → подарок не бесплатный
  ├── Если подарок дороже maxGiftPrice → не бесплатный
  └── Server-side — невозможно обойти

  Webhook (orders/create):
  ├── Запись каждого подарка в историю
  ├── Проверка соответствия порогу
  └── Аудит для администратора
```

## 10. Итоговая оценка

| Этап | Время |
|------|-------|
| Скаффолд | 1 день |
| База данных | 1 день |
| Admin UI | 2 дня |
| Theme App Extension | 2 дня |
| Cart Transform Function | 1 день |
| Webhooks | 0.5 дня |
| Тестирование | 1 день |
| Деплой | 0.5 дня |
| **Итого** | **~9 дней** |

## 11. Product Page — Add as Gift

### Goal

Add an **Add as gift** button to Shopify product pages. The button must use the same eligibility, budget, cart-property, BXGY discount, and validation logic as the existing cart widget.

A product that does not fit the remaining gift budget must not be added by the gift button. The regular Shopify **Add to cart** button remains available for purchasing it normally.

### Recommended architecture

Do not manually modify the theme footer. Use the existing Theme App Extension:

```text
extensions/gift-widget/
├── blocks/
│   ├── gift-widget.liquid          # Existing cart-page gift selector
│   └── add-as-gift.liquid          # New product-page app block
└── assets/
    ├── gift-core.js                # Shared eligibility and gift-add workflow
    ├── gift-widget.js              # Cart-page UI
    ├── product-gift-button.js      # Product-page UI
    └── gift-widget.css             # Shared styles
```

The merchant places the product block through:

```text
Online Store
  → Customize
  → Product template
  → Product information
  → Add block
  → Add as gift
```

An App Embed is optional. Use it only if `gift-core.js` needs to run globally on collection pages, quick-add modals, cart drawers, or other storefront surfaces.

### Runtime flow

```mermaid
flowchart TD
    A[Product page loads] --> B[Read selected variant]
    B --> C[Fetch cart, tiers, and settings]
    C --> D[Calculate qualifying non-gift cart value]
    D --> E[Find active tier and remaining gift budget]
    E --> F{Variant available and price <= remaining?}
    F -- No --> G[Disable Add as gift]
    F -- Yes --> H[Enable Add as gift]
    H --> I[Customer clicks button]
    I --> J[Call shared gift-core addGift]
    J --> K[Request BXGY code from app proxy]
    K --> L[Add variant with gift properties]
    L --> M[Apply generated GIFT code]
    M --> N{Gift is fully free?}
    N -- No --> O[Rollback new gift and show error]
    N -- Yes --> P[Publish cart updated event]
```

### Shared gift runtime

Extract the non-UI logic from `gift-widget.js` into `gift-core.js` and expose a small public API:

```js
window.giftApp = {
  getCartState(),
  getEligibility(variantId),
  addGift(variantId),
  removeGift(selectionId),
};
```

Shared responsibilities:

- Fetch `/cart.js`.
- Fetch tiers and settings through the app proxy.
- Exclude `_gift=true` lines from the qualifying cart value.
- Calculate gift usage from original prices, not discounted prices.
- Count one authorized gift per unique `_gift_selection`.
- Calculate the active tier and remaining gift budget.
- Request the generated BXGY code.
- Add a gift with `_gift=true` and a unique `_gift_selection`.
- Apply the generated code through `/cart/update.js`.
- Verify that the expected number of gift units became fully free.
- Roll back the newly added gift if code creation or application fails.
- Dispatch `cart:updated` after a successful operation.

The cart widget and product-page button must call this shared API instead of maintaining two implementations of the discount workflow.

### Product app block

Create `blocks/add-as-gift.liquid` with:

- `target: "section"`.
- `enabled_on.templates: ["product"]`.
- A button container with the shop domain and initial variant data.
- Product variant JSON for client-side variant switching.
- Theme-editor settings for label, disabled text, alignment, and button style.
- References to `gift-core.js`, `product-gift-button.js`, and shared CSS.

Suggested UI states:

| State | Button/message |
|---|---|
| No active tier | `Add €X more to unlock gifts` |
| Eligible | `Add as gift` |
| Variant exceeds remaining budget | `Exceeds remaining gift budget` |
| Variant unavailable | `Unavailable as gift` |
| Request running | `Adding gift…` |
| Discount failed | `Could not add free gift — try again` |

### Selected variant handling

The button must follow the active product variant instead of always using `selected_or_first_available_variant`.

Implementation steps:

1. Render `product.variants | json` in the block.
2. Read the current product form input named `id`.
3. Listen for variant input changes and supported theme variant events.
4. Resolve the selected variant price and availability.
5. Recalculate button eligibility after every variant change.
6. Recalculate after `cart:updated`, `cart:change`, and `cart:refresh`.

### Eligibility rules

Enable **Add as gift** only when all conditions are true:

```text
active tier exists
AND selected variant is active
AND selected variant is available for sale
AND original variant price <= remaining gift budget
AND variant is permitted by the merchant's gift-product rules
AND no gift mutation is currently running
```

Both the browser and app-proxy backend must validate the selection. Browser validation is for UX; backend validation is authoritative.

### Cart and discount behavior

```mermaid
sequenceDiagram
    participant P as Product block
    participant C as Shopify Cart
    participant A as App Proxy
    participant S as Shopify Admin API

    P->>C: GET /cart.js
    P->>A: POST /gift-code with authorized gift selections
    A->>S: Create one BXGY code for all selected gifts
    S-->>A: Code + gift quantity
    A-->>P: Code + validated quantity/value
    P->>C: POST /cart/add.js with _gift and _gift_selection
    P->>C: POST /cart/update.js with generated code
    C-->>P: Updated cart
    P->>P: Verify expected free gift quantity
    P->>C: Roll back new line if verification fails
```

Required behavior:

- Multiple different gifts can be selected within the budget.
- The same variant can be selected multiple times through the gift button.
- Every button click creates a unique `_gift_selection`.
- Manual cart quantity increases do not create new authorized gift selections.
- BXGY `discountOnQuantity.quantity` equals the number of authorized selections.
- Units beyond the authorized gift count remain at normal price.
- A product exceeding the remaining budget is not added by the gift button.
- Removing one gift recreates the combined code for the remaining gifts.
- Removing the last gift clears generated `GIFT-*` codes while preserving applicable merchant codes.

### Backend improvements

Recommended additions before enabling the product-page button broadly:

1. Add a dedicated eligibility endpoint, for example `/apps/gift-threshold/gift-eligibility`.
2. Accept the current variant ID and authorized gift selections.
3. Validate active tier, product availability, original price, and total gift budget.
4. Return structured eligibility data:

```json
{
  "eligible": true,
  "tierId": 46,
  "giftBudget": 14025,
  "usedBudget": 9600,
  "remainingBudget": 4425,
  "variantPrice": 3400
}
```

5. Keep Admin API calls and discount creation on the backend only.
6. Add server-side request throttling and generated-code cleanup.
7. Return stable error codes so both storefront UIs show consistent messages.

### Merchant configuration ideas

Add settings for controlling which products can be gifts:

- Explicit product or variant selection.
- Eligible collections.
- Product tags.
- A product metafield such as `gift.is_gift=true`.
- Excluded products and collections.
- Product-page button enabled/disabled.
- Custom button label and styling.
- Show/hide remaining gift budget.

The backend must enforce these rules; Liquid and JavaScript filtering alone are not sufficient.

### Implementation checklist

```text
□ Extract shared calculations and cart operations into gift-core.js
□ Refactor cart widget to call the shared runtime
□ Add add-as-gift.liquid product app block
□ Add product-gift-button.js
□ Track selected product variant changes
□ Render eligibility and remaining-budget states
□ Add gifts with unique _gift_selection values
□ Reuse the existing app-proxy BXGY workflow
□ Validate the returned gift quantity before cart mutation
□ Validate fully free gift units after discount application
□ Roll back failed or partially discounted gift additions
□ Preserve normal Shopify Add to cart behavior
□ Test different gift variants
□ Test repeated selection of the same variant
□ Test a product equal to the remaining budget
□ Test a product one cent above the remaining budget
□ Test manual cart quantity increases
□ Test removing one gift and the final gift
□ Test product pages in Dawn desktop and mobile layouts
□ Run npm run typecheck
□ Run npm run build
□ Deploy the Render backend before the Shopify extension
□ Release the updated Theme App Extension
```

### Acceptance criteria

- The product-page button is added through the Shopify theme editor, with no manual theme edits.
- The button always uses the currently selected variant.
- The button is disabled when the variant is unavailable or exceeds the remaining budget.
- Clicking the button never silently adds a paid product.
- All selected gift units are fully free after the code is applied.
- Duplicate selections through the gift UI are supported.
- Manual quantity increases remain paid.
- Product-page and cart-page gift calculations produce identical results.
- Existing non-gift discount codes are preserved where Shopify combination rules allow them.
- Failed discount application leaves no paid gift line in the cart.

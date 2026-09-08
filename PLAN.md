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

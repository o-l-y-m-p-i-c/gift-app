/**
 * Gift history is recorded by the orders/create webhook, which needs protected
 * customer data approval. Set GIFT_HISTORY_ENABLED=true once that webhook is
 * subscribed in shopify.app.toml; until then the History page stays hidden.
 */
export const isGiftHistoryEnabled = () => process.env.GIFT_HISTORY_ENABLED === "true";

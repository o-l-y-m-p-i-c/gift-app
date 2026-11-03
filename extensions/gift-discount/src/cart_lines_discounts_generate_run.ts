import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
  CartInput,
  CartLinesDiscountsGenerateRunResult,
} from '../generated/api';

/**
 * Written by the app to the discount's `$app:gift/function-config`
 * metafield. Amounts are cents in the shop currency.
 */
type GiftConfig = {
  active?: boolean;
  message?: string;
  tiers?: Array<{minAmount: number; giftAmount: number}>;
};

// Line amounts can differ from the cart's by rounding in the customer's currency.
const TOLERANCE = 0.005;
const NO_DISCOUNTS: CartLinesDiscountsGenerateRunResult = {operations: []};

/**
 * Makes gift lines (those with the `_gift` property) free, one unit each,
 * while their total fits the budget of the highest tier the rest of the
 * cart reaches. Gifts from excluded collections or tags are never free.
 */
export function cartLinesDiscountsGenerateRun(
  input: CartInput,
): CartLinesDiscountsGenerateRunResult {
  const config = (input.discount.metafield?.jsonValue ?? null) as GiftConfig | null;
  if (!config?.active || !input.shop.localTime.accessOpen) return NO_DISCOUNTS;
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) return NO_DISCOUNTS;

  const rate = Number(input.presentmentCurrencyRate) || 1;
  const toPresentment = (cents: number) => (cents / 100) * rate;

  const isGift = (line: CartInput['cart']['lines'][number]) => line.gift?.value === 'true';
  const thresholdBase = input.cart.lines
    .filter((line) => !isGift(line))
    .reduce((sum, line) => sum + Number(line.cost.subtotalAmount.amount), 0);

  const tier = (config.tiers ?? [])
    .filter((candidate) => toPresentment(candidate.minAmount) <= thresholdBase + TOLERANCE)
    .sort((a, b) => b.minAmount - a.minAmount)[0];
  if (!tier) return NO_DISCOUNTS;

  let budget = toPresentment(tier.giftAmount);
  const freeLines: string[] = [];
  for (const line of input.cart.lines) {
    if (!isGift(line) || line.merchandise.__typename !== 'ProductVariant') continue;
    const {product} = line.merchandise;
    if (product.excluded || product.excludedTag) continue;
    const unitPrice = Number(line.cost.amountPerQuantity.amount);
    if (unitPrice > budget + TOLERANCE) continue;
    budget -= unitPrice;
    freeLines.push(line.id);
  }
  if (freeLines.length === 0) return NO_DISCOUNTS;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: freeLines.map((id) => ({
            message: config.message || 'Free gift',
            targets: [{cartLine: {id, quantity: 1}}],
            value: {percentage: {value: '100'}},
          })),
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

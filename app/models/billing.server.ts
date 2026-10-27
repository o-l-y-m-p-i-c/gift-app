import { prisma } from "~/db.server";
import { adminGraphql } from "~/lib/admin-api.server";
import { PLAN_CURRENCY, getBillingAccess, getPaidPeriods } from "~/lib/billing.server";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export async function getShopBilling(shopId: string) {
  return prisma.shopBilling.upsert({
    where: { shopId },
    create: { shopId },
    update: {},
  });
}

/**
 * Cheap access check for storefront requests — reads only the cached
 * billing state, never the Admin API.
 */
export async function hasBillingAccess(shopId: string) {
  const billing = await getShopBilling(shopId);
  return getBillingAccess(billing).hasAccess;
}

const BILLING_STATE_QUERY = `
  query BillingState {
    shop {
      plan {
        partnerDevelopment
      }
    }
    currentAppInstallation {
      allSubscriptions(first: 50, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          status
          test
          trialDays
          createdAt
          currentPeriodEnd
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
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
  }
`;

/**
 * Pull dev-store status and subscriptions from Shopify, store them and
 * record a payment for every paid billing cycle seen so far.
 * Skips the API call when synced recently unless `force` is set.
 */
export async function syncBilling(shopId: string, { force = false } = {}) {
  const billing = await getShopBilling(shopId);
  if (
    !force &&
    billing.lastSyncedAt &&
    Date.now() - billing.lastSyncedAt.getTime() < SYNC_INTERVAL_MS
  ) {
    return billing;
  }

  let data: any;
  try {
    data = await adminGraphql(BILLING_STATE_QUERY, {}, shopId);
  } catch (error) {
    console.error("[billing] Failed to sync billing state:", error);
    return billing;
  }

  const isDevStore = Boolean(data?.data?.shop?.plan?.partnerDevelopment);
  const subscriptions: any[] = data?.data?.currentAppInstallation?.allSubscriptions?.nodes || [];
  const now = new Date();

  for (const sub of subscriptions) {
    const price = sub.lineItems?.[0]?.plan?.pricingDetails?.price;
    const amount = Math.round(Number.parseFloat(price?.amount ?? "0") * 100);
    const currencyCode = price?.currencyCode || PLAN_CURRENCY;
    const createdAt = new Date(sub.createdAt);
    const currentPeriodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;

    const previous = await prisma.billingSubscription.findUnique({ where: { id: sub.id } });
    await prisma.billingSubscription.upsert({
      where: { id: sub.id },
      create: {
        id: sub.id,
        shopId,
        name: sub.name,
        status: sub.status,
        test: Boolean(sub.test),
        trialDays: sub.trialDays ?? 0,
        amount,
        currencyCode,
        createdAt,
        currentPeriodEnd,
      },
      update: { status: sub.status, currentPeriodEnd },
    });

    // Charges only happen while the subscription is active; a subscription
    // cancelled since the last sync still gets its cycles up to now.
    if (sub.status === "ACTIVE" || previous?.status === "ACTIVE") {
      const periods = getPaidPeriods(createdAt, sub.trialDays ?? 0, now);
      if (periods.length > 0) {
        await prisma.billingPayment.createMany({
          data: periods.map((period) => ({
            shopId,
            subscriptionId: sub.id,
            amount,
            currencyCode,
            periodStart: period.start,
            periodEnd: period.end,
            test: Boolean(sub.test),
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  const active = subscriptions.find((sub) => sub.status === "ACTIVE");
  return prisma.shopBilling.update({
    where: { shopId },
    data: {
      isDevStore,
      subscriptionId: active?.id ?? null,
      subscriptionStatus: active?.status ?? subscriptions[0]?.status ?? null,
      currentPeriodEnd: active?.currentPeriodEnd ? new Date(active.currentPeriodEnd) : null,
      lastSyncedAt: now,
    },
  });
}

/** Shopify cancels app subscriptions on uninstall. */
export async function clearSubscription(shopId: string) {
  await prisma.shopBilling.updateMany({
    where: { shopId },
    data: { subscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null, lastSyncedAt: null },
  });
  await prisma.billingSubscription.updateMany({
    where: { shopId, status: { in: ["ACTIVE", "PENDING", "FROZEN"] } },
    data: { status: "CANCELLED" },
  });
}

export async function getSubscriptions(shopId: string) {
  return prisma.billingSubscription.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPayments(shopId: string) {
  return prisma.billingPayment.findMany({
    where: { shopId },
    orderBy: { periodStart: "desc" },
  });
}

export async function getPaymentStats(shopId: string) {
  const payments = await prisma.billingPayment.findMany({
    where: { shopId, test: false },
    select: { amount: true, periodStart: true },
  });

  const byMonth = new Map<string, { count: number; amount: number }>();
  for (const payment of payments) {
    const month = payment.periodStart.toISOString().slice(0, 7);
    const entry = byMonth.get(month) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += payment.amount;
    byMonth.set(month, entry);
  }

  return {
    totalPaid: payments.reduce((total, payment) => total + payment.amount, 0),
    paymentCount: payments.length,
    lastPaymentAt: payments.reduce<Date | null>(
      (latest, payment) => (!latest || payment.periodStart > latest ? payment.periodStart : latest),
      null,
    ),
    byMonth: [...byMonth.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, entry]) => ({ month, ...entry })),
  };
}

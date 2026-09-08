const GIFT_DISCOUNT_TITLE = "Davines Free Gift";
const GIFT_FUNCTION_TITLE = "gift-discount";

export async function ensureGiftDiscount(admin: any) {
  const setupResponse = await admin.graphql(`#graphql
    query GiftDiscountSetup {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
        }
      }
      discountNodes(first: 50, query: "title:\"Davines Free Gift\"") {
        nodes {
          discount {
            __typename
            ... on DiscountAutomaticApp {
              title
              status
              appDiscountType {
                functionId
              }
            }
          }
        }
      }
    }
  `);
  const setup: any = await setupResponse.json();
  const giftFunction = setup.data?.shopifyFunctions?.nodes?.find(
    (shopifyFunction: any) => shopifyFunction.title === GIFT_FUNCTION_TITLE,
  );

  if (!giftFunction) return;

  const exists = setup.data?.discountNodes?.nodes?.some(
    (node: any) =>
      node.discount?.__typename === "DiscountAutomaticApp" &&
      node.discount.appDiscountType?.functionId === giftFunction.id,
  );

  if (exists) return;

  const createResponse = await admin.graphql(
    `#graphql
      mutation CreateGiftDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount {
            discountId
            title
            status
            appDiscountType {
              functionId
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        automaticAppDiscount: {
          title: GIFT_DISCOUNT_TITLE,
          functionId: giftFunction.id,
          startsAt: new Date().toISOString(),
          discountClasses: ["PRODUCT"],
          combinesWith: {
            orderDiscounts: true,
            productDiscounts: true,
            shippingDiscounts: true,
          },
        },
      },
    },
  );
  const created: any = await createResponse.json();
  const errors = created.data?.discountAutomaticAppCreate?.userErrors || [];

  if (errors.length > 0) {
    console.error("[gift-discount] Activation failed:", errors);
  }
}

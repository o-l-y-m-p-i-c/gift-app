import type { LoaderFunctionArgs } from "@remix-run/node";
import { adminGraphql } from "~/lib/admin-api.server";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { authenticate } from "~/shopify.server";

const PROMO_COMPATIBILITY_QUERY = `#graphql
  query PromoCompatibility($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          combinesWith { productDiscounts }
        }
        ... on DiscountCodeBxgy {
          combinesWith { productDiscounts }
        }
        ... on DiscountCodeFreeShipping {
          combinesWith { productDiscounts }
        }
        ... on DiscountCodeApp {
          combinesWith { productDiscounts }
        }
      }
    }
  }
`;

export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return corsJson({ error: "App proxy session is unavailable." }, { status: 401 });
  }

  const codes = (new URL(request.url).searchParams.get("codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (codes.length === 0 || codes.some((code) => code.length > 255)) {
    return corsJson({ error: "At least one valid discount code is required." }, { status: 400 });
  }

  const discounts = await Promise.all(codes.map(async (code) => {
    try {
      const result: any = await adminGraphql(
        PROMO_COMPATIBILITY_QUERY,
        { code },
        session.shop,
      );
      const discount = result.data?.codeDiscountNodeByCode?.codeDiscount;
      return {
        code,
        found: Boolean(discount),
        productDiscounts: discount?.combinesWith?.productDiscounts === true,
      };
    } catch (error) {
      console.error(`[promo-compatibility] Unable to inspect ${code}:`, error);
      return { code, found: false, productDiscounts: false };
    }
  }));

  return corsJson({ discounts });
}

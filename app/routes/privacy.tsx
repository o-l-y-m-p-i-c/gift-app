import type { MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

/** Public privacy policy, linked from the Shopify App Store listing. */
export async function loader() {
  return json({
    contactEmail: process.env.SUPPORT_EMAIL || "",
    updated: "November 3, 2026",
  });
}

export const meta: MetaFunction = () => [{ title: "Privacy policy · Gift Threshold" }];

export default function PrivacyPolicy() {
  const { contactEmail, updated } = useLoaderData<typeof loader>();

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
      <h1>Gift Threshold privacy policy</h1>
      <p>Last updated: {updated}</p>

      <p>
        Gift Threshold (&quot;the app&quot;) lets Shopify merchants give customers a free gift when
        their cart reaches a spending threshold. This policy explains what data the app collects
        when a merchant installs it and how that data is used.
      </p>

      <h2>Data the app collects</h2>
      <ul>
        <li>
          <strong>Store details:</strong> the shop domain, currency, plan type (to recognise
          development stores) and the access token Shopify issues when the app is installed.
        </li>
        <li>
          <strong>App settings:</strong> the gift tiers and settings the merchant configures.
        </li>
        <li>
          <strong>Gift history (when enabled):</strong> for orders that include a gift, the order
          ID, gift product, gift price and cart totals. The app does not currently read orders, so
          no gift history is collected.
        </li>
        <li>
          <strong>Billing:</strong> the status and price of the app subscription, as reported by
          Shopify.
        </li>
      </ul>
      <p>
        The app does not store customer names, email addresses, phone numbers or addresses. It
        reads cart contents and product prices only to work out gift eligibility.
      </p>

      <h2>How the data is used</h2>
      <p>
        The data is used only to run the app: to show gift offers, make chosen gifts free, show
        gift history to the merchant, and manage the subscription. To make gifts free, the app
        creates one automatic discount, &quot;Free gifts (Gift Threshold)&quot;, in the
        merchant&apos;s store; carts set up before it existed may use single-use discount codes
        instead. Shopify removes the app&apos;s discount when the app is uninstalled. It is not sold or shared with third parties, and it is not used for
        advertising.
      </p>

      <h2>Where the data is stored</h2>
      <p>
        Data is stored in a PostgreSQL database hosted by the app&apos;s infrastructure providers
        (Render for the application and Neon for the database).
      </p>

      <h2>Retention and deletion</h2>
      <p>
        When a merchant uninstalls the app, Shopify revokes the app&apos;s access and the app
        deletes its access tokens. Shopify sends a shop data erasure request 48 hours later, and
        the app then deletes all of the shop&apos;s tiers, settings, gift history and billing
        records. Only the shop&apos;s myshopify.com domain and free-trial start date are kept, so
        that reinstalling the app doesn&apos;t start a second free trial. Customer data erasure
        requests remove any gift history linked to that customer&apos;s orders.
      </p>

      <h2>Contact</h2>
      <p>
        {contactEmail ? (
          <>
            Questions about this policy or your data: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </>
        ) : (
          <>Questions about this policy or your data: contact us through the app&apos;s Shopify App Store listing.</>
        )}
      </p>
    </main>
  );
}

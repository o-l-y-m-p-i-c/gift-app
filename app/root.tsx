import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteLoaderData,
} from "@remix-run/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisDe from "@shopify/polaris/locales/de.json";
import polarisEn from "@shopify/polaris/locales/en.json";
import polarisEs from "@shopify/polaris/locales/es.json";
import polarisFr from "@shopify/polaris/locales/fr.json";
import polarisIt from "@shopify/polaris/locales/it.json";
import polarisNl from "@shopify/polaris/locales/nl.json";
import type { Locale } from "~/i18n";
import { localeCookie, resolveLocale } from "~/i18n/locale.server";
import { I18nProvider, useI18n } from "~/i18n/react";

// Polaris ships no Latvian or Russian strings; those fall back to English.
const POLARIS_TRANSLATIONS: Partial<Record<Locale, typeof polarisEn>> = {
  en: polarisEn,
  de: polarisDe,
  es: polarisEs,
  fr: polarisFr,
  it: polarisIt,
  nl: polarisNl,
};

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: polarisStyles },
];

export function loader({ request }: LoaderFunctionArgs) {
  const cookie = localeCookie(request);
  return json(
    { apiKey: process.env.SHOPIFY_API_KEY || "", locale: resolveLocale(request) },
    cookie ? { headers: { "Set-Cookie": cookie } } : undefined,
  );
}

// Keep the language Shopify passed on the first load; later requests don't
// carry the ?locale= parameter.
export const shouldRevalidate = () => false;

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang={data?.locale ?? "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Navigation() {
  const { t } = useI18n();
  return (
    <NavMenu>
      <Link to="/" rel="home">{t("nav.dashboard")}</Link>
      <Link to="/app/tiers">{t("nav.tiers")}</Link>
      <Link to="/app/settings">{t("nav.settings")}</Link>
      <Link to="/app/history">{t("nav.history")}</Link>
      <Link to="/app/billing">{t("nav.billing")}</Link>
    </NavMenu>
  );
}

export default function App() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  return (
    <ShopifyAppProvider isEmbeddedApp apiKey={apiKey} i18n={POLARIS_TRANSLATIONS[locale] ?? polarisEn}>
      <I18nProvider locale={locale}>
        <Navigation />
        <Outlet />
      </I18nProvider>
    </ShopifyAppProvider>
  );
}

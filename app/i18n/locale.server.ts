import { DEFAULT_LOCALE, LOCALES, type Locale, matchLocale } from "./index";

const COOKIE = "gift_admin_locale";

/**
 * The admin language: Shopify adds `?locale=` when it opens the app; later
 * requests fall back to the cookie set from it, then the browser language.
 */
export function resolveLocale(request: Request): Locale {
  const url = new URL(request.url);
  const fromParam = matchLocale(url.searchParams.get("locale"));
  if (fromParam) return fromParam;

  const cookie = request.headers.get("Cookie") || "";
  const fromCookie = matchLocale(cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1]);
  if (fromCookie) return fromCookie;

  const accepted = (request.headers.get("Accept-Language") || "")
    .split(",")
    .map((part) => matchLocale(part.split(";")[0]))
    .find(Boolean);
  return accepted ?? DEFAULT_LOCALE;
}

/** Remember the locale Shopify passed, for requests that don't carry it. */
export function localeCookie(request: Request): string | null {
  const locale = matchLocale(new URL(request.url).searchParams.get("locale"));
  if (!locale || !(LOCALES as readonly string[]).includes(locale)) return null;
  // The app runs in the Shopify admin iframe, so the cookie must be cross-site.
  return `${COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=None; Secure; Partitioned`;
}

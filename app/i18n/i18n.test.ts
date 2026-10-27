import { describe, expect, it } from "vitest";
import { LOCALES, createTranslator, matchLocale } from "./index";
import { localeCookie, resolveLocale } from "./locale.server";
import { en } from "./messages/en";
import { de } from "./messages/de";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { it as itMessages } from "./messages/it";
import { lv } from "./messages/lv";
import { nl } from "./messages/nl";
import { ru } from "./messages/ru";

const ALL = { de, es, fr, it: itMessages, lv, nl, ru };
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("admin translations", () => {
  it("covers every supported language", () => {
    expect(Object.keys(ALL).sort()).toEqual(LOCALES.filter((l) => l !== "en").sort());
  });

  for (const [locale, messages] of Object.entries(ALL)) {
    it(`${locale} uses the same placeholders as English`, () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(messages[key].trim(), `${locale} ${key}`).not.toBe("");
        expect(placeholders(messages[key]), `${locale} ${key}`).toEqual(placeholders(en[key]));
      }
    });
  }

  it("fills placeholders", () => {
    expect(createTranslator("de")("tiers.listTitle", { count: 3 })).toBe("Schwellenstufen (3)");
  });
});

describe("locale detection", () => {
  const request = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers });

  it("matches region variants to a supported language", () => {
    expect(matchLocale("de-DE")).toBe("de");
    expect(matchLocale("pt-BR")).toBeNull();
  });

  it("prefers Shopify's ?locale=, then the cookie, then the browser", () => {
    expect(resolveLocale(request("https://app.test/app?locale=lv"))).toBe("lv");
    expect(resolveLocale(request("https://app.test/app", { Cookie: "gift_admin_locale=fr" }))).toBe("fr");
    expect(resolveLocale(request("https://app.test/app", { "Accept-Language": "ru-RU,ru;q=0.9" }))).toBe("ru");
    expect(resolveLocale(request("https://app.test/app", { "Accept-Language": "ja" }))).toBe("en");
  });

  it("only sets the cookie when Shopify passes a supported locale", () => {
    expect(localeCookie(request("https://app.test/app?locale=it"))).toContain("gift_admin_locale=it");
    expect(localeCookie(request("https://app.test/app?locale=ja"))).toBeNull();
  });
});

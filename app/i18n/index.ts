/**
 * Admin translations. Safe to import on the client.
 * The storefront has its own translations in the theme extension's locales.
 */
import { en, type MessageKey, type Messages } from "./messages/en";
import { de } from "./messages/de";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { it } from "./messages/it";
import { lv } from "./messages/lv";
import { nl } from "./messages/nl";
import { ru } from "./messages/ru";

export type { MessageKey, Messages };

export const LOCALES = ["en", "de", "fr", "es", "it", "nl", "lv", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const MESSAGES: Record<Locale, Messages> = { en, de, fr, es, it, nl, lv, ru };

/** Match "de", "de-DE" or "pt-BR"-style values to a supported language. */
export function matchLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : null;
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function createTranslator(locale: Locale): Translate {
  const messages = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  return (key, vars) => {
    const template = messages[key] ?? en[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      vars[name] !== undefined ? String(vars[name]) : match,
    );
  };
}

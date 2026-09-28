/**
 * Every key this site stores in a visitor's browser (localStorage, sessionStorage). The privacy page's "Cookies and
 * similar storage" table must list each one, and no other key may be written: lib/storage-keys.test.ts fails when a
 * key is undisclosed or typed in place. A new key goes here and into that table in the same change (brief §8.3).
 */
export const storageKeys = {
  /** The analytics choice, kept for 12 months (lib/consent.ts). */
  consent: "rh-analytics-consent",
} as const;

export type StorageKey = (typeof storageKeys)[keyof typeof storageKeys];

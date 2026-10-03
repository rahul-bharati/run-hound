/**
 * Common-password check: returns true for a password that is a very common word or a plain number ("password",
 * "Admin123", "test1234", "123456"). Reports hide the password wherever it appears, so hiding such a word in ordinary
 * text ("input[type=password]") would give it away (docs/v2-spec.md "Test accounts"). The list of common passwords
 * itself lives in `constants/accounts-constants.ts` (data only).
 */
import { COMMON_PASSWORDS } from "../../constants/accounts-constants.js";

export function isCommonPassword(password: string): boolean {
  const p = password.trim().toLowerCase();
  if (/^\d+$/.test(p)) return true;
  const stem = p.replace(/[\d\W_]+$/, "");
  return COMMON_PASSWORDS.has(stem);
}

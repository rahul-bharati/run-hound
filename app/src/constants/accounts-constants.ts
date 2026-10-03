/**
 * Fixed values for the test-accounts feature (data only): the list of common passwords the storage layer checks a
 * value against, the message that says a saved password is one of them, and the redaction notice when such a
 * password is in a report. The check itself is in `utils/validation/common-password.ts`.
 */

/** Very common passwords (with trailing digits and punctuation taken off, lowercased). */
export const COMMON_PASSWORDS = new Set([
  "password",
  "passw0rd",
  "passwort",
  "pass",
  "admin",
  "administrator",
  "root",
  "test",
  "tester",
  "testing",
  "demo",
  "guest",
  "user",
  "login",
  "secret",
  "letmein",
  "qwerty",
  "welcome",
  "changeme",
  "default",
  "hello",
  "example",
  "iloveyou",
  "abc",
]);

/** AccountStatus.problem for a common password. Never names it, and holds none of COMMON_PASSWORDS. */
export const COMMON_PASSWORD_PROBLEM =
  "The saved credential is a very common word or number. Reports hide it everywhere it appears, which gives it away: choose a longer, unusual one for this account.";

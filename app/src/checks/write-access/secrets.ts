/**
 * The per-scenario secret registrar: registers URL credentials Run Hound saw in the app's URLs as secrets while
 * a scenario runs, so its steps, notes, cards and specs are redacted; releases them when the scenario ends.
 * The shared redactor lives in `engine/redact.ts`.
 */
import { redactDeep, registerSecretLiterals } from "../../engine/redact.js";

/** A secrets registrar for the lifetime of a single scenario. */
export function heldSecrets() {
  const seen = new Set<string>();
  const held: (() => void)[] = [];
  return {
    add(values: Iterable<string>): void {
      const added = [...values].filter((v) => !seen.has(v));
      for (const v of added) seen.add(v);
      if (added.length > 0) held.push(registerSecretLiterals(added));
    },
    redact<T>(value: T): T {
      return held.length > 0 ? redactDeep(value) : value;
    },
    release(): void {
      for (const unregister of held.splice(0)) unregister();
    },
  };
}

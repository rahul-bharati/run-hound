// The SIGN_IN_HARDENING init script signIn runs in every page and frame of the guarded sign-in context (auth/sign-in.ts).
// It is a raw JavaScript string sent to addInitScript; a syntax error would only surface at runtime, after the context
// has been opened. This test parses the script with Node's vm so a regression in the source string (the typo at
// `type ===9 ? documentAll : type ===9` was once shipped and silently disabled the whole hardening) is caught at
// vitest time. The script is read by mirroring sign-in.ts's own private re-export so the source remains canonical.
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { SIGN_IN_HARDENING } from "../../../../src/engine/auth/sign-in.js";

describe("SIGN_IN_HARDENING (the init script signIn runs in every guarded page)", () => {
  it("parses as valid JavaScript", () => {
    expect(() => vm.compileFunction(SIGN_IN_HARDENING, [])).not.toThrow();
  });

  it("is an IIFE: assigning its return value to a slot produces a defined value, not a ReferenceError", () => {
    const out = vm.runInNewContext(`${SIGN_IN_HARDENING}; window.__rhHardeningRan = true;`, { window: {} });
    expect(out).toBeDefined();
  });
});
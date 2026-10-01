/**
 * Counter of sign-in tests (POST /api/accounts/test) in progress: each drives its own Chromium. The controller
 * increments before doing the work and decrements in `finally`, so the counter is back to its prior value when
 * the response goes out — even on error.
 */
export const MAX_SIGN_IN_TESTS = 2;

/** Mutable counter wrapped in a closure so the controller can't bypass increment/decrement. */
export class SignInTestsCounter {
  #count = 0;

  get value(): number {
    return this.#count;
  }

  increment(): void {
    this.#count += 1;
  }

  decrement(): void {
    this.#count -= 1;
  }

  isAtCapacity(): boolean {
    return this.#count >= MAX_SIGN_IN_TESTS;
  }
}

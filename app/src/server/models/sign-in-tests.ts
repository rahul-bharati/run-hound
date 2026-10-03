/** Counter of sign-in tests (POST /api/accounts/test) in progress: each drives its own Chromium. */
import { MAX_SIGN_IN_TESTS } from "../../config/server.js";

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
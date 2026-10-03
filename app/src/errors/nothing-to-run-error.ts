/** Thrown when the approval is empty or names scenarios the plan doesn't have. The CLI and the API report it as a usage error. */

export class NothingToRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NothingToRunError";
  }
}

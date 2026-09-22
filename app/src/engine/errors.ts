export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

/** The target is not localhost, a private address or an explicitly allowed host. */
export class TargetNotAllowedError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`Refusing to test ${url}: ${reason}`);
    this.name = "TargetNotAllowedError";
  }
}

/** No form was found on the target page. */
export class NoFormFoundError extends Error {
  constructor(public readonly url: string) {
    super(`No form found on ${url}`);
    this.name = "NoFormFoundError";
  }
}

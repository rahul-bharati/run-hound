import { describe, expect, it } from "vitest";
import { cleanErrorMessage, explainNavigationError, normalizeTargetUrl, TargetUnreachableError } from "./errors.js";

describe("normalizeTargetUrl", () => {
  it("adds http:// when the scheme is missing", () => {
    expect(normalizeTargetUrl("localhost:38471/book")).toBe("http://localhost:38471/book");
    expect(normalizeTargetUrl(" 127.0.0.1:5173 ")).toBe("http://127.0.0.1:5173");
  });

  it("leaves URLs that name a scheme alone, for the safety gate to judge", () => {
    expect(normalizeTargetUrl("https://localhost:3000/")).toBe("https://localhost:3000/");
    expect(normalizeTargetUrl("file:///etc/passwd")).toBe("file:///etc/passwd");
  });
});

describe("cleanErrorMessage", () => {
  it("drops ANSI codes and Playwright's call log", () => {
    const raw = "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:1/\nCall log:\n\u001b[2m  - navigating to \"http://localhost:1/\"\u001b[22m\n";
    expect(cleanErrorMessage(raw)).toBe("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:1/");
  });
});

describe("explainNavigationError", () => {
  it("turns a refused connection into one plain sentence", () => {
    const err = explainNavigationError(new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:38471/book\nCall log:\n\u001b[2m - navigating"), "http://localhost:38471/book");
    expect(err).toBeInstanceOf(TargetUnreachableError);
    expect((err as Error).message).toBe("Nothing is answering at http://localhost:38471. Is the app running, and on that port?");
    expect((err as Error).message).not.toMatch(/\u001b|Call log/);
  });

  it("explains timeouts and unknown net errors", () => {
    expect((explainNavigationError(new Error("page.goto: Timeout 30000ms exceeded."), "http://x.localhost/") as Error).message).toMatch(/did not finish loading within 30 seconds/);
    expect((explainNavigationError(new Error("net::ERR_FOO_BAR at x"), "http://localhost/") as Error).message).toMatch(/ERR_FOO_BAR/);
  });

  it("returns other errors unchanged", () => {
    const err = new Error("something else");
    expect(explainNavigationError(err, "http://localhost/")).toBe(err);
  });
});

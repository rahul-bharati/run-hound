/**
 * cross-site.ts forgeFrom (0.6.0 close-out, csrf review round 2): how a forge's answer, or the lack of one, is read,
 * on a stand-in page whose network events the test orders itself, so the branches that depend on event order under
 * load are covered without a browser:
 *   - a request that fails first and whose answer the browser still got (Chromium's Opaque Response Blocking reports a
 *     blocked no-cors answer as a failure after it arrived) is read from that answer: its status and cookies;
 *   - a request that fails with no answer is "failed": sent when the connection closed after it went out
 *     (net::ERR_EMPTY_RESPONSE), not sent when the browser never reached the app (net::ERR_CONNECTION_REFUSED);
 *   - no answer within the wait is "late", and a late forge was sent;
 *   - the wait is FORGE_WAIT_MS unless a test shortens it (setForgeWaitMs), and a failure of another request is ignored.
 */
import { EventEmitter } from "node:events";
import type { Page } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { FORGE_WAIT_MS, forgeFrom, forgeWaitMs, setForgeWaitMs, type ForgedRequest } from "./cross-site.js";

const URL_ = "http://127.0.0.1:9/api/tasks";
const FORGE: ForgedRequest = { method: "POST", url: URL_, body: "title=x", encoding: "form" };

interface FakeResponse {
  status(): number;
  headers(): Record<string, string>;
  request(): { allHeaders(): Promise<Record<string, string>> };
}

function response(status: number, cookie?: string): FakeResponse {
  return {
    status: () => status,
    headers: () => ({}),
    request: () => ({ allHeaders: async (): Promise<Record<string, string>> => (cookie ? { cookie } : {}) }),
  };
}

function request(url: string, o: { answer?: FakeResponse | null; errorText?: string }) {
  return {
    url: () => url,
    method: () => "POST",
    response: async () => o.answer ?? null,
    failure: () => (o.errorText ? { errorText: o.errorText } : null),
  };
}

/** A stand-in for a Playwright page: evaluate does nothing, and the test fires the network events. */
class FakePage extends EventEmitter {
  timeouts: number[] = [];
  private waiters: { pred: (r: FakeResponse & { request(): unknown }) => boolean; resolve: (r: unknown) => void }[] = [];

  waitForResponse(pred: (r: never) => boolean, o: { timeout: number }): Promise<unknown> {
    this.timeouts.push(o.timeout);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout ${o.timeout}ms exceeded`)), o.timeout);
      this.waiters.push({
        pred: pred as never,
        resolve: (r) => {
          clearTimeout(t);
          resolve(r);
        },
      });
    });
  }

  async evaluate(): Promise<undefined> {
    return undefined;
  }

  /** Fires `requestfailed` for a request, after the forge started waiting. */
  fail(r: ReturnType<typeof request>) {
    setTimeout(() => this.emit("requestfailed", r), 10);
  }
}

const asPage = (p: FakePage) => p as unknown as Page;

afterEach(() => setForgeWaitMs());

describe("forgeFrom: the answer, or why there is none", () => {
  it("a request that failed after its answer arrived (Opaque Response Blocking) is read from that answer", async () => {
    setForgeWaitMs(2_000);
    const page = new FakePage();
    page.fail(request(URL_, { answer: response(403, "sid=a-session; theme=dark"), errorText: "net::ERR_BLOCKED_BY_ORB" }));
    const outcome = await forgeFrom(asPage(page), FORGE);
    expect(outcome.status).toBe(403);
    expect(outcome.cookies).toEqual(["sid", "theme"]);
    expect(outcome.cookiesSeen).toBe(true);
    expect(outcome.sent).toBe(true);
    expect(outcome.unanswered).toBeUndefined();
  });

  it("a connection closed with no answer is 'failed', and the request was sent", async () => {
    setForgeWaitMs(2_000);
    const page = new FakePage();
    page.fail(request(URL_, { answer: null, errorText: "net::ERR_EMPTY_RESPONSE" }));
    const outcome = await forgeFrom(asPage(page), FORGE);
    expect(outcome.status).toBeNull();
    expect(outcome.unanswered).toBe("failed");
    expect(outcome.sent).toBe(true);
    expect(outcome.failure).toBe("net::ERR_EMPTY_RESPONSE");
    expect(outcome.cookiesSeen).toBe(false);
    expect(outcome.cookies).toEqual([]);
  });

  it("a request the browser couldn't deliver (connection refused) is 'failed' and was never sent", async () => {
    setForgeWaitMs(2_000);
    const page = new FakePage();
    page.fail(request(URL_, { answer: null, errorText: "net::ERR_CONNECTION_REFUSED" }));
    const outcome = await forgeFrom(asPage(page), FORGE);
    expect(outcome.status).toBeNull();
    expect(outcome.unanswered).toBe("failed");
    expect(outcome.sent).toBe(false);
    expect(outcome.failure).toBe("net::ERR_CONNECTION_REFUSED");
  });

  it("no answer within the wait is 'late', waited for as long as the wait says, and the request was sent", async () => {
    setForgeWaitMs(150);
    expect(forgeWaitMs()).toBe(150);
    const page = new FakePage();
    const started = Date.now();
    const outcome = await forgeFrom(asPage(page), FORGE);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    expect(page.timeouts).toEqual([150]);
    expect(outcome.status).toBeNull();
    expect(outcome.unanswered).toBe("late");
    expect(outcome.sent).toBe(true);
    expect(outcome.cookiesSeen).toBe(false);
  });

  it("a failure of another request is ignored", async () => {
    setForgeWaitMs(150);
    const page = new FakePage();
    page.fail(request("http://127.0.0.1:9/favicon.ico", { answer: null, errorText: "net::ERR_EMPTY_RESPONSE" }));
    const outcome = await forgeFrom(asPage(page), FORGE);
    expect(outcome.unanswered).toBe("late");
  });

  it("the wait is FORGE_WAIT_MS unless a test shortens it", () => {
    setForgeWaitMs(150);
    setForgeWaitMs();
    expect(forgeWaitMs()).toBe(FORGE_WAIT_MS);
    expect(FORGE_WAIT_MS).toBe(30_000);
  });
});

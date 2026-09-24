/**
 * waitForCreates() runs right after a submit click. The click resolves before the page's save request reaches
 * the capture (Playwright delivers the request event asynchronously, later still on a busy machine), so
 * "no create request yet" must not be read as "every create request finished".
 */
import type { Page, Request } from "playwright";
import { describe, expect, it } from "vitest";
import { SIMULATED_RESPONSE_HEADER, type Capture, type DiscoveredForm, type FormField } from "../../core/types.js";
import { CREATE_GRACE_MS, createRequests, isRefusedSignIn, isSignInForm, simulatedResponse, waitForCreates } from "./functional-form.js";

type CapturedRequest = Capture["requests"][number];

const PAGE_URL = "http://127.0.0.1:4100/book";

/** Just what waitForCreates uses: the URL and a network-idle wait that is already satisfied (as after load). */
function fakePage(url = PAGE_URL): Page & { navigate(to: string): void } {
  let current = url;
  return {
    url: () => current,
    waitForLoadState: async () => undefined,
    navigate(to: string) {
      current = to;
    },
  } as unknown as Page & { navigate(to: string): void };
}

function request(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    url: `${new URL(PAGE_URL).origin}/api/bookings`,
    method: "POST",
    resourceType: "fetch",
    postData: "{}",
    status: null,
    failure: null,
    responseBody: null,
    ...overrides,
  };
}

const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

describe("waitForCreates", () => {
  it("waits for a save request that shows up after it is called, and for its response", async () => {
    const capture: Capture = { requests: [], console: [], pageErrors: [] };
    const save = request();
    later(300, () => capture.requests.push(save));
    later(600, () => (save.status = 201));

    await waitForCreates(fakePage(), capture, PAGE_URL);

    expect(capture.requests).toHaveLength(1);
    expect(save.status).toBe(201);
  });

  it("counts a failed save request as finished", async () => {
    const capture: Capture = { requests: [], console: [], pageErrors: [] };
    const save = request();
    later(200, () => capture.requests.push(save));
    later(400, () => (save.failure = "net::ERR_CONNECTION_REFUSED"));

    await waitForCreates(fakePage(), capture, PAGE_URL);
    expect(save.failure).not.toBeNull();
  });

  it("does not treat GETs or third-party posts as the save request", async () => {
    const capture: Capture = { requests: [], console: [], pageErrors: [] };
    capture.requests.push(request({ method: "GET", status: 200 }), request({ url: "https://analytics.example.test/collect", status: 204 }));
    const save = request();
    later(300, () => capture.requests.push(save));
    later(500, () => (save.status = 201));

    await waitForCreates(fakePage(), capture, PAGE_URL);
    expect(save.status).toBe(201);
  });

  it("returns as soon as the page navigates without a save request (a GET form)", async () => {
    const capture: Capture = { requests: [], console: [], pageErrors: [] };
    const page = fakePage();
    later(200, () => page.navigate(`${PAGE_URL.replace("/book", "/thanks")}?petName=x`));

    const started = Date.now();
    await waitForCreates(page, capture, PAGE_URL);
    expect(Date.now() - started).toBeLessThan(CREATE_GRACE_MS);
  });

  it("gives up after the grace period when the form sends nothing (e.g. client-side validation blocked it)", async () => {
    const capture: Capture = { requests: [], console: [], pageErrors: [] };
    const started = Date.now();
    await waitForCreates(fakePage(), capture, PAGE_URL);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(CREATE_GRACE_MS - 50);
    expect(waited).toBeLessThan(CREATE_GRACE_MS + 2_000);
  });

  it("stops at the timeout when the save request never answers", async () => {
    const capture: Capture = { requests: [request()], console: [], pageErrors: [] };
    const started = Date.now();
    await waitForCreates(fakePage(), capture, PAGE_URL, 500);
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});

describe("waitForCreates and createRequests: an API on another origin", () => {
  it("waits for a save to another origin when its body carries the run token", async () => {
    const capture: Capture = { requests: [], console: [], pageErrors: [] };
    const save = request({ url: "http://127.0.0.1:4101/api/rsvps", postData: '{"name":"Name tok9keep"}' });
    later(200, () => capture.requests.push(save));
    later(400, () => (save.status = 201));

    await waitForCreates(fakePage(), capture, PAGE_URL, 10_000, "tok9");
    expect(save.status).toBe(201);
    expect(createRequests(capture, PAGE_URL, "tok9")).toEqual([save]);
    // Without the run token, another origin never counts.
    expect(createRequests(capture, PAGE_URL)).toEqual([]);
  });

  it("counts a classic page post (resourceType document) to the page's origin", () => {
    const post = request({ resourceType: "document", url: `${new URL(PAGE_URL).origin}/book`, postData: "petName=x", status: 303 });
    expect(createRequests({ requests: [post], console: [], pageErrors: [] }, PAGE_URL)).toEqual([post]);
  });
});

function field(over: Partial<FormField>): FormField {
  return { key: "f", accessibleName: null, label: null, placeholder: null, type: "text", role: "textbox", required: false, selector: "#f", ...over };
}

function form(fields: FormField[], name: string | null = null, submit = "Submit"): DiscoveredForm {
  return {
    url: PAGE_URL,
    selector: "form",
    name,
    fields,
    controls: [{ accessibleName: submit, text: submit, role: "button", tag: "button", selector: "button", isSubmit: true }],
  };
}

describe("isSignInForm", () => {
  const email = field({ key: "email", type: "email" });
  it("is a sign-in form with one current-password field", () => {
    expect(isSignInForm(form([email, field({ key: "password", type: "password", autocomplete: "current-password" })]))).toBe(true);
  });

  it("recognises a short form named or submitted as sign in / log in when the password has no autocomplete hint", () => {
    expect(isSignInForm(form([email, field({ key: "pw", type: "password" })], "Welcome back", "Log in"))).toBe(true);
    expect(isSignInForm(form([email, field({ key: "pw", type: "password" })], "Sign in to Pinecone", "Continue"))).toBe(true);
  });

  it("is not a sign-in form: sign-up (new-password, or password + confirm), no password, or a long form", () => {
    expect(isSignInForm(form([email, field({ key: "pw", type: "password", autocomplete: "new-password" })], "Sign in"))).toBe(false);
    expect(isSignInForm(form([email, field({ key: "pw", type: "password" }), field({ key: "pw2", type: "password" })], "Log in"))).toBe(false);
    expect(isSignInForm(form([email], "Sign in"))).toBe(false);
    const long = [email, field({ key: "a" }), field({ key: "b" }), field({ key: "pw", type: "password" })];
    expect(isSignInForm(form(long, "Log in"))).toBe(false);
  });

  it("isRefusedSignIn: 400, 401, 403 or 422 from a sign-in form; never from other forms or other statuses", () => {
    const signIn = form([email, field({ key: "password", type: "password", autocomplete: "current-password" })]);
    for (const status of [400, 401, 403, 422]) expect(isRefusedSignIn(signIn, status), String(status)).toBe(true);
    for (const status of [null, 200, 404, 500]) expect(isRefusedSignIn(signIn, status), String(status)).toBe(false);
    expect(isRefusedSignIn(form([email]), 401)).toBe(false);
  });
});

describe("simulatedResponse", () => {
  const fake = (url: string, origin?: string) => ({ url: () => url, headers: () => (origin ? { origin } : {}) }) as unknown as Request;

  it("marks the answer as simulated, so it is never counted as a test record", () => {
    const res = simulatedResponse(fake(`${new URL(PAGE_URL).origin}/api/bookings`, new URL(PAGE_URL).origin), 500, "{}");
    expect(res.status).toBe(500);
    expect(res.headers[SIMULATED_RESPONSE_HEADER]).toBe("1");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("adds CORS headers for a request to another origin, so the page can read the made-up answer", () => {
    const res = simulatedResponse(fake("http://127.0.0.1:4101/api/rsvps", "http://127.0.0.1:4100"), 201, "{}");
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4100");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

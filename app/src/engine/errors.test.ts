import { describe, expect, it } from "vitest";
import { cleanErrorMessage, containerLocalhostHint, explainNavigationError, explainNoForm, inContainer, NoFormFoundError, normalizeTargetUrl, TargetUnreachableError } from "./errors.js";

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

  it("explains a port the browser refuses to open", () => {
    const err = explainNavigationError(new Error("page.goto: net::ERR_UNSAFE_PORT at http://localhost:6000/signup"), "http://localhost:6000/signup");
    expect(err).toBeInstanceOf(TargetUnreachableError);
    expect((err as Error).message).toBe("Chromium refuses to open port 6000: it is on the list of ports that Chrome and other Chromium browsers block. Run your app on another port, such as 5173 or 8080.");
  });

  it("returns other errors unchanged", () => {
    const err = new Error("something else");
    expect(explainNavigationError(err, "http://localhost/")).toBe(err);
  });
});

describe("explainNoForm", () => {
  const page = (over: Partial<Parameters<typeof explainNoForm>[0]> = {}) => ({
    requested: "http://localhost:5173/signup",
    final: "http://localhost:5173/signup",
    status: 200,
    text: "Welcome",
    ...over,
  });

  it("says nothing when the page is simply a page without a form", () => {
    expect(explainNoForm(page())).toBeUndefined();
  });

  it("names an error status, with a hint for 404", () => {
    expect(explainNoForm(page({ status: 404 }))).toBe("the page answered 404 (not found): check the path");
    expect(explainNoForm(page({ status: 500 }))).toBe("the page answered 500");
  });

  it("explains a dev server refusing the host name (Vite's allowedHosts, Next's allowedDevOrigins)", () => {
    const why = explainNoForm(page({ status: 403, text: 'Blocked request. This host ("host.docker.internal") is not allowed.\nTo allow this host, add "host.docker.internal" to `server.allowedHosts` in vite.config.js.' }));
    expect(why).toMatch(/the dev server refused the host name "host\.docker\.internal"/);
    expect(why).toMatch(/server\.allowedHosts/);
    expect(why).toMatch(/allowedDevOrigins/);
    expect(why).toMatch(/answered 403/);
  });

  it("names a redirect, and says when it looks like a sign-in page", () => {
    expect(explainNoForm(page({ final: "http://localhost:5173/login?next=/settings" }))).toMatch(/redirected to http:\/\/localhost:5173\/login\?next=\/settings, which looks like a sign-in page/);
    expect(explainNoForm(page({ final: "http://localhost:5173/home" }))).toBe("the page redirected to http://localhost:5173/home");
  });

  it("NoFormFoundError carries the reason in its message", () => {
    expect(new NoFormFoundError("http://localhost:1/x").message).toBe("No form found on http://localhost:1/x.");
    expect(new NoFormFoundError("http://localhost:1/x", "the page answered 404").message).toBe("No form found on http://localhost:1/x: the page answered 404.");
  });
});

describe("running in a container", () => {
  it("inContainer looks for Docker's and Podman's marker files", () => {
    expect(inContainer((p) => p === "/.dockerenv")).toBe(true);
    expect(inContainer((p) => p === "/run/.containerenv")).toBe(true);
    expect(inContainer(() => false)).toBe(false);
  });

  it("containerLocalhostHint explains that localhost is the container, for loopback targets only", () => {
    const hint = containerLocalhostHint("http://localhost:5430/signup");
    expect(hint).toMatch(/localhost is the container itself/);
    expect(hint).toMatch(/http:\/\/host\.docker\.internal:5430\//);
    expect(hint).toMatch(/--network host/);
    expect(containerLocalhostHint("http://127.0.0.1/")).toMatch(/127\.0\.0\.1 is the container itself/);
    expect(containerLocalhostHint("http://host.docker.internal:5430/")).toBeUndefined();
    expect(containerLocalhostHint("http://192.168.1.20:5430/")).toBeUndefined();
  });
});

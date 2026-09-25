import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startKennel, type Kennel } from "./kennel.js";
import { closeBrowser, openBook } from "./form.js";

afterAll(async () => {
  await closeBrowser();
});

function useKennel(bugs: string) {
  const ref = {} as { k: Kennel };
  beforeAll(async () => {
    ref.k = await startKennel(bugs);
  });
  afterAll(async () => {
    await ref.k?.stop();
  });
  return ref;
}

/** URL of the built bundle's source map, from the script tag in /book. */
async function mapUrl(k: Kennel): Promise<string> {
  const html = await (await fetch(`${k.url}/book`)).text();
  const src = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(src, "bundle script in index.html").toBeTruthy();
  return `${k.url}${src}.map`;
}

async function refreshSendsRequest(k: Kennel): Promise<boolean> {
  const { page, events, close } = await openBook(k);
  try {
    const refresh = page.locator('[data-kennel="refresh-bookings"]');
    await refresh.waitFor();
    await page.waitForLoadState("networkidle");
    const before = events.requests.length;
    await refresh.click();
    await page.waitForTimeout(500);
    return events.requests.slice(before).some((r) => r.url().endsWith("/api/bookings") && r.method() === "GET");
  } finally {
    await close();
  }
}

describe("V1 clean mode", () => {
  const ref = useKennel("none");

  it("sends security headers on the page and the API", async () => {
    for (const path of ["/book", "/api/bookings"]) {
      const res = await fetch(`${ref.k.url}${path}`);
      expect(res.headers.get("content-security-policy"), path).toMatch(/default-src 'self'.*frame-ancestors 'self'/);
      expect(res.headers.get("content-security-policy"), path).toContain(`connect-src 'self' ${ref.k.analyticsUrl}`);
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
    }
  });

  it("sets an HttpOnly SameSite=Lax session cookie on /book, once", async () => {
    const res = await fetch(`${ref.k.url}/book`);
    expect(res.headers.get("set-cookie")).toMatch(/^kennel_session=[0-9a-f-]{36}; Path=\/; HttpOnly; SameSite=Lax$/);
    const again = await fetch(`${ref.k.url}/book`, { headers: { cookie: "kennel_session=x" } });
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("sends no CORS headers on the API, even to Origin: null", async () => {
    const res = await fetch(`${ref.k.url}/api/bookings`, { headers: { origin: "null" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("builds source maps but does not serve them", async () => {
    expect((await fetch(await mapUrl(ref.k))).status).toBe(404);
  });

  it("Refresh reloads the bookings list", async () => {
    expect(await refreshSendsRequest(ref.k)).toBe(true);
  });
});

describe("V1 bugs", () => {
  const ref = useKennel("F07,S05,S06,S07,S08");

  it("S05: no security headers", async () => {
    const res = await fetch(`${ref.k.url}/book`);
    for (const h of ["content-security-policy", "x-content-type-options", "referrer-policy"]) expect(res.headers.get(h), h).toBeNull();
  });

  it("S06: the session cookie is not HttpOnly", async () => {
    const res = await fetch(`${ref.k.url}/book`);
    expect(res.headers.get("set-cookie")).toMatch(/^kennel_session=[0-9a-f-]{36}; Path=\/; SameSite=Lax$/);
  });

  it("S07: the API echoes any Origin with credentials", async () => {
    for (const origin of ["null", "https://evil.example"]) {
      const res = await fetch(`${ref.k.url}/api/bookings`, { headers: { origin } });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    }
  });

  it("S08: the source map is public and carries the source", async () => {
    const res = await fetch(await mapUrl(ref.k));
    expect(res.status).toBe(200);
    const map = (await res.json()) as { sources: string[]; sourcesContent: string[] };
    expect(map.sources.some((s) => s.includes("App.tsx"))).toBe(true);
    expect(map.sourcesContent.length).toBeGreaterThan(0);
  });

  it("F07: Refresh does nothing", async () => {
    expect(await refreshSendsRequest(ref.k)).toBe(false);
  });
});

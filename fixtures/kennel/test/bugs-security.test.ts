import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startKennel, type Kennel } from "./kennel.js";
import {
  bookThroughUi,
  closeBrowser,
  fillForm,
  jwtPayloads,
  LLM_KEY_RE,
  loadedScripts,
  loc,
  openBook,
  postBooking,
  sha256,
  STACK_RE,
  validBooking,
  waitForCreate,
} from "./form.js";

afterAll(async () => {
  await closeBrowser();
});

function useKennel(bug: string) {
  const ref = {} as { k: Kennel };
  beforeAll(async () => {
    ref.k = await startKennel(bug);
  });
  afterAll(async () => {
    await ref.k?.stop();
  });
  beforeEach(async () => {
    await ref.k.reset();
  });
  return ref;
}

/** URLs of every script the browser actually loaded on /book. */
async function scriptsLoadedByBrowser(k: Kennel) {
  const { page, events, close } = await openBook(k);
  try {
    await page.waitForLoadState("networkidle");
    return {
      urls: events.requests.filter((r) => r.resourceType() === "script").map((r) => r.url()),
      consoleErrors: [...events.consoleErrors],
    };
  } finally {
    await close();
  }
}

describe("S01: fake LLM-provider-shaped key shipped in the JavaScript bundle", () => {
  const ref = useKennel("S01");

  it("a loaded script contains an sk-proj- key; no service_role JWT", async () => {
    const scripts = await loadedScripts(ref.k);
    const withKey = scripts.filter((s) => LLM_KEY_RE.test(s.text));
    expect(withKey.length).toBeGreaterThan(0);
    expect(withKey.some((s) => /sk-proj-[A-Za-z0-9_-]{20,}/.test(s.text))).toBe(true);
    for (const s of scripts) {
      expect(jwtPayloads(s.text).filter((p) => p.role === "service_role")).toEqual([]);
      // obviously fake: the key contains FAKE
      for (const m of s.text.matchAll(/sk-proj-[A-Za-z0-9_-]{20,}/g)) expect(m[0]).toMatch(/FAKE/i);
    }
  });

  it("the secret script is really loaded by the browser, without console errors", async () => {
    const scripts = await loadedScripts(ref.k);
    const secretSrc = scripts.filter((s) => LLM_KEY_RE.test(s.text) && s.src !== "(inline)").map((s) => s.src);
    const loaded = await scriptsLoadedByBrowser(ref.k);
    if (secretSrc.length) expect(loaded.urls).toEqual(expect.arrayContaining(secretSrc));
    expect(loaded.consoleErrors).toEqual([]);
  });

  it("spot check: the form still books", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      expect((await bookThroughUi(page, validBooking())).status()).toBe(201);
    } finally {
      await close();
    }
  });
});

describe("S02: Supabase-style service_role key shipped in the JavaScript bundle", () => {
  const ref = useKennel("S02");

  it("a loaded script contains a JWT whose payload role is service_role; no sk- key", async () => {
    const scripts = await loadedScripts(ref.k);
    const roles = scripts.flatMap((s) => jwtPayloads(s.text).map((p) => p.role));
    expect(roles).toContain("service_role");
    for (const s of scripts) expect(s.text).not.toMatch(LLM_KEY_RE);
  });

  it("the secret script is really loaded by the browser, without console errors", async () => {
    const scripts = await loadedScripts(ref.k);
    const secretSrc = scripts
      .filter((s) => s.src !== "(inline)" && jwtPayloads(s.text).some((p) => p.role === "service_role"))
      .map((s) => s.src);
    const loaded = await scriptsLoadedByBrowser(ref.k);
    if (secretSrc.length) expect(loaded.urls).toEqual(expect.arrayContaining(secretSrc));
    expect(loaded.consoleErrors).toEqual([]);
  });

  it("spot check: server errors still carry no stack trace", async () => {
    const res = await postBooking(ref.k, validBooking({ petName: "Crash" }));
    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(STACK_RE);
  });
});

describe("S03: customer email sent to the mock analytics service in a query string", () => {
  const ref = useKennel("S03");

  it("after booking, a third-party GET /collect carries the email in its query string", async () => {
    const { page, events, close } = await openBook(ref.k);
    try {
      const data = validBooking();
      await bookThroughUi(page, data);
      await expect.poll(async () => (await ref.k.hits()).length).toBeGreaterThan(0);
      const hits = await ref.k.hits();
      const leaking = hits.filter((h) => h.method === "GET" && new URL(h.url, "http://x").searchParams.get("email") === data.ownerEmail);
      expect(leaking).toHaveLength(1);
      expect(new URL(leaking[0]!.url, "http://x").searchParams.get("event")).toBe("booking_created");

      const origin = new URL(ref.k.url).origin;
      const thirdParty = events.requests.filter((r) => new URL(r.url()).origin !== origin);
      expect(thirdParty.some((r) => r.url().includes(encodeURIComponent(data.ownerEmail)))).toBe(true);
      // only the email leaks, not the phone
      for (const h of hits) {
        expect(h.url).not.toContain(encodeURIComponent(data.phone));
        expect(h.url).not.toContain(sha256(data.phone));
      }
    } finally {
      await close();
    }
  });

  it("spot check: nothing leaks before a booking is made", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      await fillForm(page, validBooking());
      await page.waitForTimeout(300);
      const hits = await ref.k.hits();
      expect(hits.filter((h) => h.url.includes("email"))).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("S04: server error shows a stack trace in the page", () => {
  const ref = useKennel("S04");

  it("the 500 response and the page both show a stack trace", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      await fillForm(page, validBooking({ petName: "Crash" }));
      const created = waitForCreate(page);
      await loc.book(page).click();
      const res = await created;
      expect(res.status()).toBe(500);
      expect(await res.text()).toMatch(STACK_RE);
      await page.getByText("Something went wrong").first().waitFor({ timeout: 5000 });
      await expect.poll(async () => await page.locator("body").innerText()).toMatch(STACK_RE);
    } finally {
      await close();
    }
  });

  it("spot check: the error is still announced and input is kept", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      await fillForm(page, validBooking({ petName: "Crash" }));
      await loc.book(page).click();
      await page.getByRole("alert").filter({ hasText: "Something went wrong" }).waitFor({ timeout: 5000 });
      expect(await loc.petName(page).inputValue()).toBe("Crash");
    } finally {
      await close();
    }
  });

  it("spot check: no secret keys in scripts", async () => {
    for (const s of await loadedScripts(ref.k)) {
      expect(s.text).not.toMatch(LLM_KEY_RE);
      expect(s.text).not.toContain("service_role");
    }
  });
});

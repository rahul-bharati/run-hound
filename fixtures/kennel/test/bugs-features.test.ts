import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startKennel, type Kennel } from "./kennel.js";
import {
  bookThroughUi,
  closeBrowser,
  delayCreates,
  fillForm,
  listBookings,
  loc,
  openBook,
  postBooking,
  validBooking,
  waitForCreate,
} from "./form.js";

afterAll(async () => {
  await closeBrowser();
});

/** Starts Kennel with exactly one bug for the enclosing describe and resets data before each test. */
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

async function configBugs(k: Kennel) {
  return ((await (await fetch(`${k.url}/api/__config`)).json()) as { bugs: string[] }).bugs;
}

describe("F01: Save draft has no handler", () => {
  const ref = useKennel("F01");

  it("reports only F01 as active", async () => {
    expect(await configBugs(ref.k)).toEqual(["F01"]);
  });

  it("clicking Save draft changes nothing: no 'Draft saved', no localStorage write, no request", async () => {
    const { page, events, close } = await openBook(ref.k);
    try {
      await fillForm(page, validBooking());
      const before = await page.evaluate(() => JSON.stringify(localStorage));
      const htmlBefore = await page.locator("body").innerHTML();
      const requestsBefore = events.requests.length;
      await loc.saveDraft(page).click();
      await page.waitForTimeout(1000);
      expect(await page.getByText("Draft saved").count()).toBe(0);
      expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);
      expect(await page.evaluate(() => localStorage.getItem("kennel:draft"))).toBeNull();
      expect(events.requests.length).toBe(requestsBefore);
      expect(await page.locator("body").innerHTML()).toBe(htmlBefore);
    } finally {
      await close();
    }
  });

  it("spot check: booking still works", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      expect((await bookThroughUi(page, validBooking())).status()).toBe(201);
    } finally {
      await close();
    }
  });
});

describe("F02: server errors leave the form spinning with no message", () => {
  const ref = useKennel("F02");

  it("a 500 on create shows no message within 5 s and Book stays disabled", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const data = validBooking({ petName: "Crash" });
      await fillForm(page, data);
      const created = waitForCreate(page);
      await loc.book(page).click();
      expect((await created).status()).toBe(500);
      await page.waitForTimeout(5_000);
      expect(await page.getByText("Something went wrong").count()).toBe(0);
      const alerts = await page.getByRole("alert").allInnerTexts();
      expect(alerts.join("").trim()).toBe("");
      expect(await loc.book(page).isDisabled()).toBe(true);
    } finally {
      await close();
    }
  });

  it("an intercepted 500 is also silent", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      await page.route("**/api/bookings", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Something went wrong"}' })
          : route.continue(),
      );
      await fillForm(page, validBooking());
      await loc.book(page).click();
      await page.waitForTimeout(5_000);
      expect(await page.getByText("Something went wrong").count()).toBe(0);
    } finally {
      await close();
    }
  });

  it("spot check: client validation errors are still announced", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      await loc.book(page).click();
      await expect.poll(() => loc.petName(page).getAttribute("aria-invalid")).toBe("true");
    } finally {
      await close();
    }
  });
});

describe("F03: special instructions show a success toast but are never saved", () => {
  const ref = useKennel("F03");

  it("toast appears, but instructions are missing from the list, after reload and in the API", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const data = validBooking();
      const res = await bookThroughUi(page, data); // waits for "Booking saved"
      expect(res.status()).toBe(201);
      await page.reload({ waitUntil: "networkidle" });
      const item = loc.bookings(page).locator("li").filter({ hasText: data.petName });
      await item.waitFor();
      const text = await item.innerText();
      expect(text).not.toContain(data.instructions);
      for (const value of [data.petName, data.startDate, data.endDate, data.ownerEmail, data.phone]) expect(text).toContain(value);
      const stored = await listBookings(ref.k);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.instructions).toBe("");
      expect(stored[0]).toMatchObject({ petName: data.petName, ownerEmail: data.ownerEmail, phone: data.phone });
    } finally {
      await close();
    }
  });

  it("spot check: Book is still disabled while pending", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      await delayCreates(page, 1000);
      await fillForm(page, validBooking());
      await loc.book(page).click();
      await expect.poll(() => loc.book(page).isDisabled(), { timeout: 900 }).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("F04: Book stays enabled while sending, so a double click books twice", () => {
  const ref = useKennel("F04");

  it("Book remains enabled while the request is pending and a double click sends two creates", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const seen = await delayCreates(page, 1000);
      await fillForm(page, validBooking());
      await loc.book(page).dblclick();
      await page.waitForTimeout(200);
      expect(await loc.book(page).isEnabled()).toBe(true);
      await expect.poll(() => seen.count, { timeout: 3000 }).toBe(2);
      await expect.poll(async () => (await listBookings(ref.k)).length, { timeout: 5000 }).toBe(2);
    } finally {
      await close();
    }
  });

  it("spot check: a server error is still announced", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      await fillForm(page, validBooking({ petName: "Crash" }));
      await loc.book(page).click();
      await page.getByRole("alert").filter({ hasText: "Something went wrong" }).waitFor({ timeout: 5000 });
    } finally {
      await close();
    }
  });
});

describe("F05: availability request uses an undefined env var", () => {
  const ref = useKennel("F05");

  it("the page requests undefined/api/availability, gets a 404 and logs a console error", async () => {
    const { page, events, close } = await openBook(ref.k);
    try {
      await page.waitForLoadState("networkidle");
      const avail = events.requests.map((r) => new URL(r.url())).filter((u) => u.pathname.endsWith("/api/availability"));
      expect(avail.map((u) => u.pathname)).toContain("/undefined/api/availability");
      expect(avail.map((u) => u.pathname)).not.toContain("/api/availability");
      expect(events.badResponses.some((r) => r.startsWith("404 ") && r.includes("/undefined/api/availability"))).toBe(true);
      expect(events.consoleErrors.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("the server itself still answers /api/availability correctly", async () => {
    const res = await fetch(`${ref.k.url}/api/availability`);
    expect(await res.json()).toEqual({ available: true });
  });

  it("spot check: the booking still succeeds", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      expect((await bookThroughUi(page, validBooking())).status()).toBe(201);
    } finally {
      await close();
    }
  });
});

describe("F06: end date before start date is only blocked in the browser", () => {
  const ref = useKennel("F06");

  it("the browser still blocks it", async () => {
    const { page, events, close } = await openBook(ref.k);
    try {
      await fillForm(page, validBooking({ startDate: "2030-05-03", endDate: "2030-05-01" }));
      await loc.book(page).click();
      await expect.poll(() => loc.endDate(page).getAttribute("aria-invalid")).toBe("true");
      await page.waitForTimeout(300);
      expect(events.requests.filter((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/bookings")).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("the server accepts the replayed request with end before start", async () => {
    const res = await postBooking(ref.k, validBooking({ startDate: "2030-05-03", endDate: "2030-05-01" }));
    expect(res.status).toBe(201);
  });

  it("spot check: other server validation still rejects bad input", async () => {
    const res = await postBooking(ref.k, validBooking({ petName: "" }));
    expect(res.status).toBe(400);
    expect(res.json.errors.petName).toBeTypeOf("string");
  });
});

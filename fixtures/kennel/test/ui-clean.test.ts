import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startKennel, type Kennel } from "./kennel.js";
import {
  bookThroughUi,
  closeBrowser,
  delayCreates,
  fillForm,
  horizontalOverflow,
  jwtPayloads,
  listBookings,
  LLM_KEY_RE,
  loadedScripts,
  loc,
  openBook,
  pasteAllowed,
  postBooking,
  probeFocus,
  sha256,
  STACK_RE,
  textContrast,
  validBooking,
  waitForCreate,
} from "./form.js";

describe("Kennel /book in clean mode", () => {
  let kennel: Kennel;
  beforeAll(async () => {
    kennel = await startKennel("none");
  });
  afterAll(async () => {
    await closeBrowser();
    await kennel?.stop();
  });
  beforeEach(async () => {
    await kennel.reset();
  });

  it("loads with no console errors, page errors, failed requests or 4xx/5xx", async () => {
    const { page, events, close } = await openBook(kennel);
    try {
      await page.waitForLoadState("networkidle");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
      const paths = events.requests.map((r) => new URL(r.url()).pathname);
      expect(paths).toContain("/api/__config");
      expect(paths).toContain("/api/availability");
      expect(paths).toContain("/api/bookings");
    } finally {
      await close();
    }
  });

  it("the golden path also has no console errors or failed requests", async () => {
    const { page, events, close } = await openBook(kennel);
    try {
      await bookThroughUi(page, validBooking());
      await page.waitForLoadState("networkidle");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("every input has a visible label", async () => {
    const { page, close } = await openBook(kennel);
    try {
      for (const field of [loc.petName, loc.startDate, loc.endDate, loc.email, loc.instructions, loc.password, loc.confirmPassword]) {
        await expect(field(page).count()).resolves.toBe(1);
      }
      await expect(page.getByLabel("Phone", { exact: true }).count()).resolves.toBe(1);
      for (const text of ["Pet name", "Start date", "End date", "Owner email", "Phone", "Special instructions", "Password", "Confirm password"]) {
        const label = page.locator("label").filter({ hasText: new RegExp(`^\\s*${text}\\s*\\*?\\s*$`) });
        expect(await label.count(), text).toBeGreaterThanOrEqual(1);
        expect(await label.first().isVisible(), text).toBe(true);
      }
      await expect(page.getByRole("textbox", { name: "Special instructions", exact: true }).evaluate((el) => el.tagName)).resolves.toBe("TEXTAREA");
      expect(await loc.password(page).getAttribute("type")).toBe("password");
      expect(await loc.confirmPassword(page).getAttribute("type")).toBe("password");
      // no unlabeled form controls at all
      const unlabeled = await page.locator("form input, form textarea, form select").evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLInputElement).type !== "hidden")
          .filter((el) => !((el as HTMLInputElement).labels?.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
          .map((el) => el.outerHTML),
      );
      expect(unlabeled).toEqual([]);
    } finally {
      await close();
    }
  });

  it("pet type is a native radio group inside a fieldset with legend 'Pet type', operable with arrow keys", async () => {
    const { page, close } = await openBook(kennel);
    try {
      const radios = page.locator('input[type="radio"][name="petType"]');
      expect(await radios.count()).toBe(3);
      expect(await radios.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["dog", "cat", "other"]);
      const group = page.getByRole("group", { name: "Pet type" });
      expect(await group.evaluate((el) => el.tagName)).toBe("FIELDSET");
      expect(await group.getByRole("radio").count()).toBe(3);

      await loc.petTypeRadio(page, "Dog").focus();
      await page.keyboard.press("Space");
      await expect(loc.petTypeRadio(page, "Dog").isChecked()).resolves.toBe(true);
      await page.keyboard.press("ArrowRight");
      await expect(loc.petTypeRadio(page, "Cat").isChecked()).resolves.toBe(true);
    } finally {
      await close();
    }
  });

  it("the form can be completed and submitted with the keyboard only", async () => {
    const { page, close } = await openBook(kennel);
    try {
      const data = validBooking({ petType: "dog" });
      await loc.petName(page).focus();
      await page.keyboard.type(data.petName);
      // Tab until the Dog radio is focused, then select it with Space
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        if (await loc.petTypeRadio(page, "Dog").evaluate((el) => el === document.activeElement)) break;
      }
      await page.keyboard.press("Space");
      await expect(loc.petTypeRadio(page, "Dog").isChecked()).resolves.toBe(true);
      await loc.startDate(page).fill(data.startDate);
      await loc.endDate(page).fill(data.endDate);
      await loc.email(page).focus();
      await page.keyboard.type(data.ownerEmail);
      const created = waitForCreate(page);
      await page.keyboard.press("Enter");
      expect((await created).status()).toBe(201);
      expect(await listBookings(kennel)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("client errors use aria-invalid, aria-describedby and a polite live region", async () => {
    const { page, events, close } = await openBook(kennel);
    try {
      await loc.book(page).click();
      for (const field of [loc.petName, loc.startDate, loc.endDate, loc.email]) {
        const el = field(page);
        await expect.poll(() => el.getAttribute("aria-invalid")).toBe("true");
        const describedBy = (await el.getAttribute("aria-describedby")) ?? "";
        const ids = describedBy.split(/\s+/).filter(Boolean);
        expect(ids.length).toBeGreaterThan(0);
        const texts: string[] = [];
        for (const id of ids) {
          const target = page.locator(`[id="${id}"]`);
          if ((await target.count()) && (await target.isVisible())) texts.push((await target.innerText()).trim());
        }
        expect(texts.join(" ").length, "visible described-by error text").toBeGreaterThan(0);
      }
      // radios: the group or its radios are marked invalid too
      const radioInvalid = await page
        .locator('input[type="radio"][name="petType"][aria-invalid="true"], fieldset[aria-invalid="true"], [role="radiogroup"][aria-invalid="true"]')
        .count();
      expect(radioInvalid).toBeGreaterThan(0);

      const live = page.locator('[aria-live="polite"], [role="status"]');
      await expect.poll(async () => (await live.allInnerTexts()).join(" ").trim().length).toBeGreaterThan(0);
      // valid optional fields are not marked invalid
      expect(await loc.phone(page).getAttribute("aria-invalid")).not.toBe("true");
      expect(events.requests.filter((r) => r.method() === "POST" && r.url().endsWith("/api/bookings"))).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("end date before start date is blocked in the browser", async () => {
    const { page, events, close } = await openBook(kennel);
    try {
      await fillForm(page, validBooking({ startDate: "2030-05-03", endDate: "2030-05-01" }));
      await loc.book(page).click();
      await expect.poll(() => loc.endDate(page).getAttribute("aria-invalid")).toBe("true");
      await page.waitForTimeout(300);
      expect(events.requests.filter((r) => r.method() === "POST" && r.url().endsWith("/api/bookings"))).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("every focusable control shows a visible focus indicator", async () => {
    await postBooking(kennel, validBooking()); // so a remove button exists
    const { page, close } = await openBook(kennel);
    try {
      await loc.removeButtons(page).first().waitFor();
      const probes = await probeFocus(page);
      expect(probes.length).toBeGreaterThanOrEqual(10);
      expect(probes.filter((p) => !p.visible)).toEqual([]);
    } finally {
      await close();
    }
  });

  it("Book is disabled while the create request is pending, and one click sends one request", async () => {
    const { page, close } = await openBook(kennel);
    try {
      const seen = await delayCreates(page, 1500);
      await fillForm(page, validBooking());
      const created = waitForCreate(page);
      await loc.book(page).click();
      await expect.poll(() => loc.book(page).isDisabled(), { timeout: 1000 }).toBe(true);
      await loc.book(page).dblclick({ force: true }).catch(() => {});
      expect((await created).status()).toBe(201);
      await expect.poll(() => loc.book(page).isEnabled()).toBe(true);
      expect(seen.count).toBe(1);
      expect(await listBookings(kennel)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("a server error shows a visible, announced message and keeps the input", async () => {
    const { page, close } = await openBook(kennel);
    try {
      const data = validBooking({ petName: "Crash" });
      await fillForm(page, data);
      const created = waitForCreate(page);
      await loc.book(page).click();
      expect((await created).status()).toBe(500);
      const alert = page.getByRole("alert").filter({ hasText: "Something went wrong" });
      await alert.waitFor({ state: "visible", timeout: 5000 });
      expect(await loc.petName(page).inputValue()).toBe(data.petName);
      expect(await loc.email(page).inputValue()).toBe(data.ownerEmail);
      expect(await loc.phone(page).inputValue()).toBe(data.phone);
      expect(await loc.instructions(page).inputValue()).toBe(data.instructions);
      expect(await loc.startDate(page).inputValue()).toBe(data.startDate);
      expect(await loc.petTypeRadio(page, "Cat").isChecked()).toBe(true);
      await expect.poll(() => loc.book(page).isEnabled()).toBe(true);
      expect(await page.locator("body").innerText()).not.toMatch(STACK_RE);
    } finally {
      await close();
    }
  });

  it("server errors from intercepted 500s are announced too (silent-failure scenario)", async () => {
    const { page, close } = await openBook(kennel);
    try {
      await page.route("**/api/bookings", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Something went wrong"}' })
          : route.continue(),
      );
      const data = validBooking();
      await fillForm(page, data);
      await loc.book(page).click();
      await page.getByRole("alert").filter({ hasText: "Something went wrong" }).waitFor({ timeout: 5000 });
      expect(await loc.petName(page).inputValue()).toBe(data.petName);
    } finally {
      await close();
    }
  });

  it("after booking, 'Your bookings' shows every saved field, also after reload", async () => {
    const { page, close } = await openBook(kennel);
    try {
      const data = validBooking({ petType: "other" });
      const res = await bookThroughUi(page, data);
      expect(res.status()).toBe(201);
      const check = async () => {
        const section = loc.bookings(page);
        const item = section.locator("li").filter({ hasText: data.petName });
        await item.waitFor();
        const text = await item.innerText();
        for (const value of [data.petName, "Other", data.startDate, data.endDate, data.ownerEmail, data.phone, data.instructions]) {
          expect(text, value).toContain(value);
        }
      };
      await check();
      await page.reload({ waitUntil: "networkidle" });
      await check();
      const stored = await listBookings(kennel);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject(data);
    } finally {
      await close();
    }
  });

  it("the form resets after a successful booking", async () => {
    const { page, close } = await openBook(kennel);
    try {
      await bookThroughUi(page, validBooking());
      await expect.poll(() => loc.petName(page).inputValue()).toBe("");
    } finally {
      await close();
    }
  });

  it("reflows at 320 px without horizontal scrolling", async () => {
    const { page, close } = await openBook(kennel, { viewport: { width: 320, height: 800 } });
    try {
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    } finally {
      await close();
    }
  });

  it("paste works on every field, including both password fields, and autocomplete tokens are present", async () => {
    const { page, close } = await openBook(kennel);
    try {
      for (const field of [loc.petName, loc.email, loc.phone, loc.instructions, loc.password, loc.confirmPassword]) {
        expect(await pasteAllowed(page, field(page))).toBe(true);
      }
      expect(await loc.password(page).getAttribute("autocomplete")).toBe("new-password");
      expect(await loc.confirmPassword(page).getAttribute("autocomplete")).toBe("new-password");
      expect(await loc.email(page).getAttribute("autocomplete")).toBe("email");
      expect(await loc.phone(page).getAttribute("autocomplete")).toBe("tel");
    } finally {
      await close();
    }
  });

  it("no third-party request contains personal data; analytics still receives a booking_created event", async () => {
    const { page, events, close } = await openBook(kennel);
    try {
      const data = validBooking();
      await bookThroughUi(page, data);
      await expect.poll(async () => (await kennel.hits()).length).toBeGreaterThan(0);
      const hits = await kennel.hits();
      expect(hits.some((h) => h.method === "POST" && h.body.includes("booking_created"))).toBe(true);
      const canaries = [data.ownerEmail, encodeURIComponent(data.ownerEmail), sha256(data.ownerEmail), data.phone, encodeURIComponent(data.phone), sha256(data.phone)];
      for (const h of hits) {
        for (const c of canaries) {
          expect(h.url, "analytics url").not.toContain(c);
          expect(h.body, "analytics body").not.toContain(c);
        }
      }
      const origin = new URL(kennel.url).origin;
      const thirdParty = events.requests.filter((r) => new URL(r.url()).origin !== origin);
      expect(thirdParty.length).toBeGreaterThan(0);
      for (const r of thirdParty) {
        for (const c of canaries) {
          expect(r.url()).not.toContain(c);
          expect(r.postData() ?? "").not.toContain(c);
        }
      }
    } finally {
      await close();
    }
  });

  it("Save draft stores the draft in localStorage and shows 'Draft saved'", async () => {
    const { page, close } = await openBook(kennel);
    try {
      const data = validBooking();
      await fillForm(page, data);
      await loc.password(page).fill("FAKE-pass-123");
      expect(await page.evaluate(() => localStorage.getItem("kennel:draft"))).toBeNull();
      await loc.saveDraft(page).click();
      await page.getByRole("status").filter({ hasText: "Draft saved" }).waitFor({ timeout: 3000 });
      const draft = await page.evaluate(() => localStorage.getItem("kennel:draft"));
      expect(draft).not.toBeNull();
      expect(draft).toContain(data.petName);
      expect(draft).not.toContain("FAKE-pass-123");
    } finally {
      await close();
    }
  });

  it("icon buttons have accessible names and work", async () => {
    await postBooking(kennel, validBooking({ petName: "Biscuit" }));
    const { page, close } = await openBook(kennel);
    try {
      const clear = page.getByRole("button", { name: "Clear pet name", exact: true });
      expect(await clear.count()).toBe(1);
      expect(await loc.clearButton(page).count()).toBe(1);
      await loc.petName(page).fill("Zed");
      await clear.click();
      expect(await loc.petName(page).inputValue()).toBe("");

      const remove = page.getByRole("button", { name: "Remove booking for Biscuit", exact: true });
      await remove.waitFor();
      expect(await loc.removeButtons(page).count()).toBe(1);
      const del = page.waitForResponse((r) => r.request().method() === "DELETE");
      await remove.click();
      expect((await del).status()).toBe(204);
      await expect.poll(async () => (await listBookings(kennel)).length).toBe(0);
      await expect.poll(() => page.getByRole("button", { name: /^Remove booking for/ }).count()).toBe(0);
    } finally {
      await close();
    }
  });

  it("every button and radio is at least 24x24 px", async () => {
    await postBooking(kennel, validBooking());
    const { page, close } = await openBook(kennel);
    try {
      await loc.removeButtons(page).first().waitFor();
      const boxes = await page.locator('button, input[type="radio"]').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { el: el.outerHTML.slice(0, 80), w: r.width, h: r.height };
        }),
      );
      expect(boxes.length).toBeGreaterThanOrEqual(7);
      expect(boxes.filter((b) => b.w < 24 || b.h < 24)).toEqual([]);
    } finally {
      await close();
    }
  });

  it("email helper text is associated and has at least 4.5:1 contrast", async () => {
    const { page, close } = await openBook(kennel);
    try {
      const hint = loc.emailHint(page);
      expect(await hint.innerText()).toContain("We only use this to confirm your booking.");
      const id = await hint.getAttribute("id");
      expect(id).toBeTruthy();
      expect((await loc.email(page).getAttribute("aria-describedby")) ?? "").toContain(id!);
      expect(await textContrast(hint)).toBeGreaterThanOrEqual(4.5);
    } finally {
      await close();
    }
  });

  it("no loaded script contains secret-looking keys", async () => {
    const scripts = await loadedScripts(kennel);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(s.text, s.src).not.toMatch(LLM_KEY_RE);
      expect(jwtPayloads(s.text).filter((p) => p.role === "service_role"), s.src).toEqual([]);
      expect(s.text).not.toContain("service_role");
    }
  });
});

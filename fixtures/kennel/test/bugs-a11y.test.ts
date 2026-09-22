import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startKennel, type Kennel } from "./kennel.js";
import {
  bookThroughUi,
  closeBrowser,
  fillForm,
  horizontalOverflow,
  listBookings,
  loc,
  openBook,
  pasteAllowed,
  postBooking,
  probeFocus,
  textContrast,
  validBooking,
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

describe("A01: phone input uses a placeholder as its only label", () => {
  const ref = useKennel("A01");

  it("phone has no label, aria-label or aria-labelledby, only placeholder 'Phone'", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      expect(await page.getByLabel("Phone", { exact: true }).count()).toBe(0);
      const phone = page.getByPlaceholder("Phone", { exact: true });
      expect(await phone.count()).toBe(1);
      const info = await phone.evaluate((el) => ({
        labels: (el as HTMLInputElement).labels?.length ?? 0,
        ariaLabel: el.getAttribute("aria-label"),
        labelledBy: el.getAttribute("aria-labelledby"),
        title: el.getAttribute("title"),
      }));
      expect(info).toEqual({ labels: 0, ariaLabel: null, labelledBy: null, title: null });
      expect(await page.locator("label").filter({ hasText: /^\s*Phone\s*$/ }).count()).toBe(0);
    } finally {
      await close();
    }
  });

  it("spot check: other inputs keep their labels", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      expect(await loc.email(page).count()).toBe(1);
      expect(await loc.petName(page).count()).toBe(1);
    } finally {
      await close();
    }
  });
});

describe("A02: icon-only clear button has no accessible name", () => {
  const ref = useKennel("A02");

  it("the clear button exists and works but has no accessible name", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const clear = loc.clearButton(page);
      expect(await clear.count()).toBe(1);
      expect(await page.getByRole("button", { name: "Clear pet name" }).count()).toBe(0);
      const attrs = await clear.evaluate((el) => ({
        tag: el.tagName,
        ariaLabel: el.getAttribute("aria-label"),
        labelledBy: el.getAttribute("aria-labelledby"),
        title: el.getAttribute("title"),
        text: (el.textContent ?? "").trim(),
        svgTitle: el.querySelector("title")?.textContent ?? null,
      }));
      expect(attrs).toEqual({ tag: "BUTTON", ariaLabel: null, labelledBy: null, title: null, text: "", svgTitle: null });
      const snapshot = await clear.ariaSnapshot();
      expect(snapshot.trim()).toMatch(/^- button(?! ")/);
      await loc.petName(page).fill("Zed");
      await clear.click();
      expect(await loc.petName(page).inputValue()).toBe("");
    } finally {
      await close();
    }
  });

  it("spot check: remove buttons still have names", async () => {
    await postBooking(ref.k, validBooking({ petName: "Biscuit" }));
    const { page, close } = await openBook(ref.k);
    try {
      await page.getByRole("button", { name: "Remove booking for Biscuit" }).waitFor();
    } finally {
      await close();
    }
  });
});

describe("A03: pet-type picker is clickable divs", () => {
  const ref = useKennel("A03");

  it("there are no radios; options are plain divs that are not focusable", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      expect(await page.locator('input[type="radio"]').count()).toBe(0);
      expect(await page.getByRole("radio").count()).toBe(0);
      const picker = page.locator('[data-kennel="pet-type"]');
      expect(await picker.count()).toBe(1);
      for (const name of ["Dog", "Cat", "Other"]) {
        const option = picker.getByText(name, { exact: true });
        const info = await option.evaluate((el) => {
          const opt = el.closest("[data-kennel='pet-type'] > *") ?? el;
          return { tag: opt.tagName, role: opt.getAttribute("role"), tabIndex: (opt as HTMLElement).tabIndex, attr: opt.getAttribute("tabindex") };
        });
        expect(info.tag).toBe("DIV");
        expect(info.role).toBeNull();
        expect(info.attr).toBeNull();
        expect(info.tabIndex).toBe(-1);
      }
    } finally {
      await close();
    }
  });

  it("keyboard users cannot reach the pet type; Tab skips from the pet name controls to Start date", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const probes = await probeFocus(page);
      expect(probes.some((p) => /^(Dog|Cat|Other)$/.test(p.name))).toBe(false);
    } finally {
      await close();
    }
  });

  it("mouse users can still pick a type and book", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const data = validBooking({ petType: "cat" });
      await bookThroughUi(page, data, { petTypeAsDiv: true });
      const stored = await listBookings(ref.k);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.petType).toBe("cat");
    } finally {
      await close();
    }
  });
});

describe("A04: focus outline removed on inputs with no replacement", () => {
  const ref = useKennel("A04");

  it("text inputs and the textarea show no focus indicator; buttons still do", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const probes = await probeFocus(page);
      const invisible = probes.filter((p) => !p.visible);
      expect(invisible.some((p) => p.tag === "input" && (p.type === "text" || p.type === null))).toBe(true);
      expect(invisible.some((p) => p.tag === "input" && p.type === "email")).toBe(true);
      expect(invisible.some((p) => p.tag === "textarea")).toBe(true);
      const buttons = probes.filter((p) => p.tag === "button");
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((p) => p.visible)).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("A05: validation errors are red text only, never announced", () => {
  const ref = useKennel("A05");

  it("errors are visible but have no aria-invalid, no describedby link and no live announcement", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      await loc.book(page).click();
      await page.waitForTimeout(500);
      const errorTexts = await page.evaluate(() =>
        Array.from(document.querySelectorAll("form *"))
          .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim())
          .filter((el) => {
            const c = getComputedStyle(el).color.match(/\d+/g)!.map(Number);
            return c[0]! > 150 && c[1]! < 100 && c[2]! < 100; // red-ish
          })
          .map((el) => (el.textContent ?? "").trim()),
      );
      expect(errorTexts.length).toBeGreaterThan(0);

      for (const field of [loc.petName, loc.startDate, loc.endDate, loc.email]) {
        const el = field(page);
        expect(await el.getAttribute("aria-invalid")).not.toBe("true");
        const ids = ((await el.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter(Boolean);
        for (const id of ids) {
          const text = (await page.locator(`[id="${id}"]`).innerText().catch(() => "")).trim();
          expect(errorTexts).not.toContain(text);
        }
      }
      const announced = (await page.locator('[aria-live], [role="status"], [role="alert"]').allInnerTexts()).join(" ");
      for (const t of errorTexts) expect(announced).not.toContain(t);
    } finally {
      await close();
    }
  });

  it("spot check: server errors are still announced", async () => {
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

describe("A06: helper text contrast too low", () => {
  const ref = useKennel("A06");

  it("the email helper text is below 4.5:1 but still present and visible", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const hint = loc.emailHint(page);
      expect(await hint.isVisible()).toBe(true);
      expect(await hint.innerText()).toContain("We only use this to confirm your booking.");
      expect(await textContrast(hint)).toBeLessThan(4.5);
    } finally {
      await close();
    }
  });
});

describe("A07: paste blocked on the confirm-password field", () => {
  const ref = useKennel("A07");

  it("paste is prevented on Confirm password only", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      expect(await pasteAllowed(page, loc.confirmPassword(page))).toBe(false);
      expect(await pasteAllowed(page, loc.password(page))).toBe(true);
      expect(await pasteAllowed(page, loc.email(page))).toBe(true);
      expect(await loc.confirmPassword(page).getAttribute("autocomplete")).toBe("new-password");
    } finally {
      await close();
    }
  });
});

describe("A08: remove icon buttons are 16x16 px", () => {
  const ref = useKennel("A08");

  it("remove buttons render at 16x16 while other buttons stay >= 24px", async () => {
    await postBooking(ref.k, validBooking({ petName: "Biscuit" }));
    const { page, close } = await openBook(ref.k);
    try {
      const remove = page.getByRole("button", { name: "Remove booking for Biscuit" });
      await remove.waitFor();
      const box = (await remove.boundingBox())!;
      expect(Math.round(box.width)).toBe(16);
      expect(Math.round(box.height)).toBe(16);
      const clear = (await loc.clearButton(page).boundingBox())!;
      expect(clear.width).toBeGreaterThanOrEqual(24);
      expect(clear.height).toBeGreaterThanOrEqual(24);
    } finally {
      await close();
    }
  });
});

describe("A09: fixed-width form breaks at 320 px", () => {
  const ref = useKennel("A09");

  it("the page scrolls horizontally at 320x800", async () => {
    const { page, close } = await openBook(ref.k, { viewport: { width: 320, height: 800 } });
    try {
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth).toBeGreaterThan(clientWidth + 1);
    } finally {
      await close();
    }
  });

  it("spot check: no overflow at desktop width and booking still works", async () => {
    const { page, close } = await openBook(ref.k);
    try {
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      expect((await bookThroughUi(page, validBooking())).status()).toBe(201);
    } finally {
      await close();
    }
  });
});

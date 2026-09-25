/**
 * The /app/settings contract (CONTRACT.md "/app/settings Settings", "API", W04): the profile and notifications API,
 * the tabs, the Profile form (validation, pending state, errors, persistence), the auto-saving notification switches
 * and the Billing tab's Cancel subscription AlertDialog, in clean mode and with W04.
 */
import type { Page, Request, Route } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { TIME_ZONES } from "../server/routes/workspace.mjs";
import { TIME_ZONE_OPTIONS } from "../src/pages/app/constants";
import { api, axeViolations, closeBrowser, horizontalOverflow, openPage, STACK_RE, useFernway, type Fernway, type OpenedPage } from "./support.js";

afterAll(async () => {
  await closeBrowser();
});

const SEED_PROFILE = {
  displayName: "Alex Rivera",
  email: "alex@fernway.test",
  bio: "Studio lead at Fernway. I plan projects, keep timelines honest and make sure every client hears from us weekly.",
  timeZone: "America/New_York",
  avatar: 0,
};
const SEED_NOTIFICATIONS = { productUpdates: true, weeklyDigest: true, mentions: true, taskReminders: false };
const SWITCHES = ["Product updates", "Weekly digest", "Mentions", "Task reminders"];

const validProfile = (overrides: Record<string, unknown> = {}) => ({
  displayName: "Alex R.",
  email: "alex.rivera@example.test",
  bio: "Plans projects at Fernway.",
  timeZone: "Europe/London",
  ...overrides,
});

async function holdRequests(page: Page, path: string, method: string) {
  const waiting: (() => void)[] = [];
  const seen: Request[] = [];
  let released = false;
  await page.route(
    (url) => url.pathname === path,
    async (route: Route) => {
      if (route.request().method() !== method) return route.fallback();
      seen.push(route.request());
      if (!released) await new Promise<void>((resolve) => waiting.push(resolve));
      await route.fallback();
    },
  );
  return {
    seen,
    release() {
      released = true;
      for (const go of waiting.splice(0)) go();
    },
  };
}

function recordRequests(page: Page, path: string, method: string): Request[] {
  const list: Request[] = [];
  page.on("request", (req) => {
    if (req.method() === method && new URL(req.url()).pathname === path) list.push(req);
  });
  return list;
}

async function referencedText(page: Page, locator: ReturnType<Page["locator"]>, attr: string): Promise<string[]> {
  const ids = ((await locator.getAttribute(attr)) ?? "").split(/\s+/).filter(Boolean);
  const texts: string[] = [];
  for (const id of ids) {
    const el = page.locator(`[id="${id}"]`);
    expect(await el.count(), `${attr} target #${id} exists`).toBe(1);
    texts.push(((await el.textContent()) ?? "").trim());
  }
  return texts;
}

const profileForm = (page: Page) => page.getByRole("form", { name: "Profile" });
const field = (page: Page, name: string) => profileForm(page).getByRole("textbox", { name, exact: true });

async function openSettings(fw: Fernway, options: Parameters<typeof openPage>[2] = {}): Promise<OpenedPage> {
  const opened = await openPage(fw, "/app/settings", options);
  await opened.page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  // The profile has loaded once the form shows the saved display name.
  await expect.poll(() => field(opened.page, "Display name").inputValue()).not.toBe("");
  return opened;
}

async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
  await page.getByRole("tabpanel", { name }).waitFor();
}

// ---- API -----------------------------------------------------------------------------------------

describe("profile and notifications API (clean mode)", () => {
  const ref = useFernway("none");

  it("GET /api/profile answers the seeded profile", async () => {
    const res = await api(ref.fw, "/api/profile");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SEED_PROFILE);
  });

  it("PUT /api/profile saves the 4 fields (200) and GET answers them; unknown keys are ignored", async () => {
    const res = await api(ref.fw, "/api/profile", {
      method: "PUT",
      body: { ...validProfile(), avatar: 5, role: "owner", plan: "enterprise" },
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...validProfile(), avatar: 0 });
    expect((await api(ref.fw, "/api/profile")).body).toEqual({ ...validProfile(), avatar: 0 });
  });

  it("PUT /api/profile trims values, lower-cases the email and keeps the bio when it is not sent", async () => {
    const { bio: _bio, ...noBio } = validProfile({ displayName: "  Alex  ", email: " Alex@Example.TEST " });
    const res = await api(ref.fw, "/api/profile", { method: "PUT", body: noBio });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: "Alex", email: "alex@example.test", bio: SEED_PROFILE.bio });
  });

  it("an empty bio is allowed", async () => {
    const res = await api(ref.fw, "/api/profile", { method: "PUT", body: validProfile({ bio: "" }) });
    expect(res.status).toBe(200);
    expect(res.body.bio).toBe("");
  });

  it.each([
    [{ displayName: "" }, "displayName"],
    [{ displayName: "x".repeat(61) }, "displayName"],
    [{ email: "" }, "email"],
    [{ email: "not-an-email" }, "email"],
    [{ bio: "x".repeat(161) }, "bio"],
    [{ timeZone: "Mars/Olympus" }, "timeZone"],
    [{ timeZone: "" }, "timeZone"],
  ])("PUT /api/profile %j answers 400 for %s and changes nothing", async (override, key) => {
    const res = await api(ref.fw, "/api/profile", { method: "PUT", body: validProfile(override) });
    expect(res.status).toBe(400);
    expect(typeof res.body.errors[key]).toBe("string");
    expect((await api(ref.fw, "/api/profile")).body).toEqual(SEED_PROFILE);
  });

  it("PUT /api/profile with the display name Crash answers a bare 500", async () => {
    const res = await api(ref.fw, "/api/profile", { method: "PUT", body: validProfile({ displayName: "Crash" }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong" });
    expect(JSON.stringify(res.body)).not.toMatch(STACK_RE);
    expect((await api(ref.fw, "/api/profile")).body).toEqual(SEED_PROFILE);
  });

  it("GET /api/notifications answers the 4 settings; PATCH changes the ones sent and answers all of them", async () => {
    expect((await api(ref.fw, "/api/notifications")).body).toEqual(SEED_NOTIFICATIONS);
    const res = await api(ref.fw, "/api/notifications", { method: "PATCH", body: { weeklyDigest: false, taskReminders: true, unknown: true } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...SEED_NOTIFICATIONS, weeklyDigest: false, taskReminders: true });
    expect((await api(ref.fw, "/api/notifications")).body).toEqual(res.body);
  });

  it("PATCH /api/notifications rejects non-boolean values and bodies with no known setting", async () => {
    const bad = await api(ref.fw, "/api/notifications", { method: "PATCH", body: { mentions: "no" } });
    expect(bad.status).toBe(400);
    expect(typeof bad.body.errors.mentions).toBe("string");
    const empty = await api(ref.fw, "/api/notifications", { method: "PATCH", body: { nope: true } });
    expect(empty.status).toBe(400);
    expect(typeof empty.body.errors.body).toBe("string");
    expect((await api(ref.fw, "/api/notifications")).body).toEqual(SEED_NOTIFICATIONS);
  });

  it("POST /api/__reset restores the profile and notifications", async () => {
    await api(ref.fw, "/api/profile", { method: "PUT", body: validProfile() });
    await api(ref.fw, "/api/notifications", { method: "PATCH", body: { mentions: false } });
    await ref.fw.reset();
    expect((await api(ref.fw, "/api/profile")).body).toEqual(SEED_PROFILE);
    expect((await api(ref.fw, "/api/notifications")).body).toEqual(SEED_NOTIFICATIONS);
  });

  it("the client's time zone list is the server's", () => {
    expect(TIME_ZONE_OPTIONS.map((t) => t.value)).toEqual([...TIME_ZONES]);
  });
});

// ---- the page ------------------------------------------------------------------------------------

describe("/app/settings in a browser (clean mode)", () => {
  const ref = useFernway("none");

  it("loads with tabs (Profile selected) and the profile from the API, with no errors", async () => {
    const { page, events, close } = await openSettings(ref.fw);
    try {
      expect(await page.title()).toBe("Fernway: Settings");
      expect(await page.locator("h1").count()).toBe(1);
      expect(await page.getByRole("tab").allInnerTexts()).toEqual(["Profile", "Notifications", "Billing"]);
      expect(await page.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
      expect(await field(page, "Display name").inputValue()).toBe(SEED_PROFILE.displayName);
      expect(await profileForm(page).getByRole("textbox", { name: "Email" }).inputValue()).toBe(SEED_PROFILE.email);
      expect(await field(page, "Bio").inputValue()).toBe(SEED_PROFILE.bio);
      expect(await profileForm(page).getByRole("combobox", { name: "Time zone" }).textContent()).toContain("New York");
      expect(await profileForm(page).getByRole("img", { name: "Portrait of Alex Rivera" }).count()).toBe(1);
      expect(await profileForm(page).getByRole("textbox", { name: "Display name" }).getAttribute("autocomplete")).toBe("name");
      expect(await profileForm(page).getByRole("textbox", { name: "Email" }).getAttribute("autocomplete")).toBe("email");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("tabs work from the keyboard (arrow keys, Home/End)", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      // Radix moves roving focus on a timer, so each key is held like a person would (press delay).
      await page.getByRole("tab", { name: "Profile" }).focus();
      await page.keyboard.press("ArrowRight", { delay: 50 });
      await expect.poll(() => page.getByRole("tab", { name: "Notifications" }).getAttribute("aria-selected")).toBe("true");
      await page.getByRole("tabpanel", { name: "Notifications" }).waitFor();
      await page.keyboard.press("End", { delay: 50 });
      await page.getByRole("tabpanel", { name: "Billing" }).waitFor();
      await page.keyboard.press("Home", { delay: 50 });
      await page.getByRole("tabpanel", { name: "Profile" }).waitFor();
    } finally {
      await close();
    }
  });

  it("the bio counter follows the text", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      const counter = page.getByText(/^\d+\/160$/);
      expect(await counter.textContent()).toBe(`${SEED_PROFILE.bio.length}/160`);
      await field(page, "Bio").fill("Short bio.");
      await expect.poll(() => counter.textContent()).toBe("10/160");
    } finally {
      await close();
    }
  });

  it("invalid values: each field is marked invalid, described by a visible message, the first is focused and the form announces it", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      const puts = recordRequests(page, "/api/profile", "PUT");
      await field(page, "Display name").fill("");
      await profileForm(page).getByRole("textbox", { name: "Email" }).fill("nope");
      await field(page, "Bio").fill("x".repeat(161));
      await profileForm(page).getByRole("button", { name: "Save changes" }).click();
      const name = field(page, "Display name");
      await expect.poll(() => name.getAttribute("aria-invalid")).toBe("true");
      expect(await referencedText(page, name, "aria-describedby")).toContain("Enter your display name.");
      const email = profileForm(page).getByRole("textbox", { name: "Email" });
      expect(await email.getAttribute("aria-invalid")).toBe("true");
      expect((await referencedText(page, email, "aria-describedby")).join(" ")).toContain("Enter an email address like name@example.com.");
      const bio = field(page, "Bio");
      expect(await bio.getAttribute("aria-invalid")).toBe("true");
      expect((await referencedText(page, bio, "aria-describedby")).join(" ")).toContain("Keep your bio to 160 characters or fewer.");
      expect(await name.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await profileForm(page).getByRole("alert").first().textContent()).toMatch(/3 problems/);
      expect(puts).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("Save changes: pending (disabled, busy, same name), then a toast and a status; the values survive a reload", async () => {
    const { page, events, close } = await openSettings(ref.fw);
    try {
      await field(page, "Display name").fill("Alexandra Rivera");
      await profileForm(page).getByRole("textbox", { name: "Email" }).fill("alexandra@example.test");
      await field(page, "Bio").fill("Runs the studio's planning and weekly client check-ins.");
      // Time zone by keyboard.
      await profileForm(page).getByRole("combobox", { name: "Time zone" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("listbox").waitFor();
      await page.getByRole("option", { name: /London/ }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("listbox").waitFor({ state: "hidden" });

      const hold = await holdRequests(page, "/api/profile", "PUT");
      const save = profileForm(page).getByRole("button", { name: "Save changes" });
      await save.click();
      await expect.poll(() => hold.seen.length).toBe(1);
      expect(await save.isDisabled()).toBe(true);
      expect(await save.getAttribute("aria-busy")).toBe("true");
      expect(hold.seen[0]!.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.parse(hold.seen[0]!.postData() ?? "{}")).toEqual({
        displayName: "Alexandra Rivera",
        email: "alexandra@example.test",
        bio: "Runs the studio's planning and weekly client check-ins.",
        timeZone: "Europe/London",
      });
      hold.release();

      await profileForm(page).getByRole("status").filter({ hasText: "Profile saved" }).waitFor();
      await page.locator("[data-sonner-toast]").filter({ hasText: "Profile saved" }).waitFor();
      expect(await save.isEnabled()).toBe(true);

      await page.reload({ waitUntil: "networkidle" });
      await expect.poll(() => field(page, "Display name").inputValue()).toBe("Alexandra Rivera");
      expect(await profileForm(page).getByRole("textbox", { name: "Email" }).inputValue()).toBe("alexandra@example.test");
      expect(await field(page, "Bio").inputValue()).toBe("Runs the studio's planning and weekly client check-ins.");
      expect(await profileForm(page).getByRole("combobox", { name: "Time zone" }).textContent()).toContain("London");
      expect(events.consoleErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("a double click saves once", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      const puts = recordRequests(page, "/api/profile", "PUT");
      await field(page, "Display name").fill("Once only");
      await profileForm(page).getByRole("button", { name: "Save changes" }).dblclick();
      await profileForm(page).getByRole("status").filter({ hasText: "Profile saved" }).waitFor();
      await page.waitForTimeout(600);
      expect(puts).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("a server error (Crash) is announced inline and by toast; values are kept and the button re-enabled", async () => {
    const { page, events, close } = await openSettings(ref.fw);
    try {
      await field(page, "Display name").fill("Crash");
      await field(page, "Bio").fill("Kept after the error.");
      await profileForm(page).getByRole("button", { name: "Save changes" }).click();
      const alert = profileForm(page).getByRole("alert").filter({ hasText: "Profile not saved" });
      await alert.waitFor();
      expect(await alert.textContent()).toContain("Something went wrong on our side");
      await page.locator("[data-sonner-toast]").filter({ hasText: "Profile not saved" }).waitFor();
      expect(await field(page, "Display name").inputValue()).toBe("Crash");
      expect(await field(page, "Bio").inputValue()).toBe("Kept after the error.");
      expect(await profileForm(page).getByRole("button", { name: "Save changes" }).isEnabled()).toBe(true);
      expect(events.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("server field errors show on the field", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      await page.route(
        (url) => url.pathname === "/api/profile",
        (route) =>
          route.request().method() === "PUT"
            ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ errors: { email: "Another account uses this email." } }) })
            : route.fallback(),
      );
      await profileForm(page).getByRole("button", { name: "Save changes" }).click();
      const email = profileForm(page).getByRole("textbox", { name: "Email" });
      await expect.poll(() => email.getAttribute("aria-invalid")).toBe("true");
      expect(await referencedText(page, email, "aria-describedby")).toContain("Another account uses this email.");
    } finally {
      await close();
    }
  });

  it("notification switches: labelled, saved on toggle with a toast (mouse and Space), and kept after reload", async () => {
    const { page, events, close } = await openSettings(ref.fw);
    try {
      await openTab(page, "Notifications");
      const panel = page.getByRole("tabpanel", { name: "Notifications" });
      for (const name of SWITCHES) expect(await panel.getByRole("switch", { name }).count()).toBe(1);
      expect(await panel.getByRole("switch", { name: "Weekly digest" }).getAttribute("aria-checked")).toBe("true");
      expect(await panel.getByRole("switch", { name: "Task reminders" }).getAttribute("aria-checked")).toBe("false");

      const patches = recordRequests(page, "/api/notifications", "PATCH");
      await panel.getByRole("switch", { name: "Weekly digest" }).click();
      await page.locator("[data-sonner-toast]").filter({ hasText: "Weekly digest turned off" }).waitFor();
      expect(JSON.parse(patches[0]!.postData() ?? "{}")).toEqual({ weeklyDigest: false });
      expect(patches[0]!.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);

      await panel.getByRole("switch", { name: "Task reminders" }).focus();
      await page.keyboard.press("Space");
      await page.locator("[data-sonner-toast]").filter({ hasText: "Task reminders turned on" }).waitFor();
      await expect.poll(async () => (await api(ref.fw, "/api/notifications")).body).toEqual({ ...SEED_NOTIFICATIONS, weeklyDigest: false, taskReminders: true });

      await page.reload({ waitUntil: "networkidle" });
      await openTab(page, "Notifications");
      await expect.poll(() => page.getByRole("switch", { name: "Weekly digest" }).getAttribute("aria-checked")).toBe("false");
      expect(await page.getByRole("switch", { name: "Task reminders" }).getAttribute("aria-checked")).toBe("true");
      expect(events.consoleErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("a failed switch save reverts the switch and announces the error", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      await openTab(page, "Notifications");
      await page.route(
        (url) => url.pathname === "/api/notifications",
        (route) =>
          route.request().method() === "PATCH"
            ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong" }) })
            : route.fallback(),
      );
      const mentions = page.getByRole("switch", { name: "Mentions" });
      await mentions.click();
      await page.getByRole("tabpanel", { name: "Notifications" }).getByRole("alert").filter({ hasText: "Mentions" }).waitFor();
      await page.locator("[data-sonner-toast]").filter({ hasText: "Mentions" }).waitFor();
      await expect.poll(() => mentions.getAttribute("aria-checked")).toBe("true");
      expect(await mentions.isEnabled()).toBe(true);
    } finally {
      await close();
    }
  });

  it("Billing: the plan, a Change plan link to /#pricing and a Cancel subscription AlertDialog (Esc and Keep close it, focus returns)", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      await openTab(page, "Billing");
      const panel = page.getByRole("tabpanel", { name: "Billing" });
      expect(await panel.getByText("Studio plan").count()).toBeGreaterThan(0);
      expect(await panel.getByRole("link", { name: "Change plan" }).getAttribute("href")).toBe("/#pricing");
      const cancel = panel.getByRole("button", { name: "Cancel subscription" });
      await cancel.click();
      const dialog = page.getByRole("alertdialog", { name: "Cancel your subscription?" });
      await dialog.waitFor();
      expect(await dialog.getByRole("button", { name: "Keep subscription" }).count()).toBe(1);
      expect(await dialog.getByRole("button", { name: "Cancel subscription" }).count()).toBe(1);
      // The safe choice has focus first.
      expect(await dialog.getByRole("button", { name: "Keep subscription" }).evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await expect.poll(() => cancel.evaluate((el) => el === document.activeElement)).toBe(true);
      await cancel.click();
      await dialog.getByRole("button", { name: "Keep subscription" }).click();
      await dialog.waitFor({ state: "hidden" });
      // Confirming says what happens.
      await cancel.click();
      await dialog.getByRole("button", { name: "Cancel subscription" }).click();
      await dialog.waitFor({ state: "hidden" });
      await panel.getByRole("status").filter({ hasText: /stays active until/ }).waitFor();
      await panel.getByRole("button", { name: "Resume subscription" }).click();
      await panel.getByRole("button", { name: "Cancel subscription" }).waitFor();
    } finally {
      await close();
    }
  });

  it.each(["light", "dark"] as const)("passes axe in %s mode on every tab, with errors shown and with the AlertDialog open", async (colorScheme) => {
    const { page, close } = await openSettings(ref.fw, { colorScheme, reducedMotion: "reduce" });
    try {
      expect(await axeViolations(page), "profile").toEqual([]);
      await field(page, "Display name").fill("");
      await profileForm(page).getByRole("button", { name: "Save changes" }).click();
      await field(page, "Display name").and(page.locator("[aria-invalid=true]")).waitFor();
      expect(await axeViolations(page), "profile errors").toEqual([]);
      // An open Radix Select aria-hides the page and traps focus in the listbox (Tab is swallowed). axe only excuses
      // hidden focusable content while a dialog is open, so it reports aria-hidden-focus here; Run Hound's
      // axe-states never scans this state. Everything else must be clean, and focus must really stay in the list.
      await profileForm(page).getByRole("combobox", { name: "Time zone" }).click();
      await page.getByRole("listbox").waitFor();
      const open = await axeViolations(page);
      expect(open.filter((v) => !v.startsWith("aria-hidden-focus:")), "time zone list").toEqual([]);
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=listbox]"))).toBe(true);
      await page.keyboard.press("Escape");
      await page.getByRole("listbox").waitFor({ state: "hidden" });
      await openTab(page, "Notifications");
      expect(await axeViolations(page), "notifications").toEqual([]);
      await openTab(page, "Billing");
      expect(await axeViolations(page), "billing").toEqual([]);
      await page.getByRole("button", { name: "Cancel subscription" }).click();
      await page.getByRole("alertdialog").waitFor();
      expect(await axeViolations(page), "alertdialog").toEqual([]);
    } finally {
      await close();
    }
  });

  it("every tab reflows at 320px with no horizontal scroll", async () => {
    const { page, close } = await openSettings(ref.fw, { viewport: { width: 320, height: 800 } });
    try {
      for (const tab of ["Profile", "Notifications", "Billing"]) {
        await openTab(page, tab);
        expect(await horizontalOverflow(page), tab).toBe(false);
      }
    } finally {
      await close();
    }
  });
});

// ---- planted bug ---------------------------------------------------------------------------------

describe("W04: the Profile form drops Bio before sending but shows it as saved", () => {
  const ref = useFernway("W04");

  it("the toast and status say saved, the request has no bio, and after reload the old bio is back", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      const puts = recordRequests(page, "/api/profile", "PUT");
      await field(page, "Display name").fill("Alex Rivera-Stone");
      await field(page, "Bio").fill("A brand new bio that never reaches the server.");
      await profileForm(page).getByRole("button", { name: "Save changes" }).click();
      await profileForm(page).getByRole("status").filter({ hasText: "Profile saved" }).waitFor();
      await page.locator("[data-sonner-toast]").filter({ hasText: "Profile saved" }).waitFor();
      expect(await field(page, "Bio").inputValue()).toBe("A brand new bio that never reaches the server.");
      const body = JSON.parse(puts[0]!.postData() ?? "{}");
      expect(body).not.toHaveProperty("bio");
      expect(body.displayName).toBe("Alex Rivera-Stone");

      await page.reload({ waitUntil: "networkidle" });
      await expect.poll(() => field(page, "Display name").inputValue()).toBe("Alex Rivera-Stone");
      expect(await field(page, "Bio").inputValue()).toBe(SEED_PROFILE.bio);
    } finally {
      await close();
    }
  });
});

describe("W04 off (other bugs on): the bio is saved", () => {
  const ref = useFernway("W03,W05");

  it("the bio survives a reload", async () => {
    const { page, close } = await openSettings(ref.fw);
    try {
      await field(page, "Bio").fill("This bio is kept.");
      await profileForm(page).getByRole("button", { name: "Save changes" }).click();
      await profileForm(page).getByRole("status").filter({ hasText: "Profile saved" }).waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await expect.poll(() => field(page, "Bio").inputValue()).toBe("This bio is kept.");
    } finally {
      await close();
    }
  });
});

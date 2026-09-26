/**
 * Contract tests for /onboarding (CONTRACT.md "/onboarding Wizard", "Page requirements", "API"): the slug and
 * onboarding endpoints (server/routes/onboarding.mjs) and the three-step wizard in a browser.
 */
import type { Locator, Page } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { api, axeViolations, closeBrowser, horizontalOverflow, openPage, STACK_RE, useFernway, type Fernway } from "./support.js";

afterAll(closeBrowser);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORKSPACE = { workspaceName: "Juniper Studio", slug: "juniper-studio", useCase: "client", invites: ["priya@juniper.test"] };

// ---- helpers ---------------------------------------------------------------------------------------

async function describedBy(page: Page, control: Locator): Promise<string> {
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter(Boolean);
  const texts: string[] = [];
  for (const id of ids) {
    const target = page.locator(`[id="${id}"]`);
    expect(await target.count(), `#${id} exists`).toBe(1);
    if (await target.isVisible()) texts.push(((await target.textContent()) ?? "").trim());
  }
  return texts.join(" | ");
}

async function hold(page: Page, path: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${path}`, async (route) => {
    await gate;
    await route.continue();
  });
  return { release };
}

const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const stepper = (page: Page) => page.getByRole("list", { name: "Setup progress" });

async function currentStep(page: Page): Promise<string | null> {
  const current = stepper(page).locator('li[aria-current="step"]');
  return (await current.count()) === 1 ? ((await current.textContent()) ?? "").trim() : null;
}

async function openWizard(fw: Fernway, options: Parameters<typeof openPage>[2] = {}) {
  const opened = await openPage(fw, "/onboarding", { reducedMotion: "reduce", ...options });
  await opened.page.getByRole("heading", { level: 1, name: "Set up your workspace" }).waitFor();
  return opened;
}

/** Fills step 1 and waits for the slug check to settle. */
async function fillWorkspace(page: Page, name = WORKSPACE.workspaceName, slug?: string) {
  await page.getByLabel("Workspace name", { exact: true }).fill(name);
  if (slug !== undefined) await page.getByLabel("Workspace URL", { exact: true }).fill(slug);
}

const slugStatus = (page: Page) => page.locator("#workspace-url-status");

async function toStep2(page: Page) {
  await fillWorkspace(page);
  await slugStatus(page).filter({ hasText: "Available" }).waitFor();
  await button(page, "Continue").click();
  await page.getByRole("heading", { level: 2, name: "Invite teammates" }).waitFor();
}

// ---- API ---------------------------------------------------------------------------------------

describe("onboarding API (clean mode)", () => {
  const ref = useFernway("none");

  it("GET /api/slug-available answers { slug, available }: seeded slugs are taken, new ones free (case-insensitive)", async () => {
    for (const slug of ["acme", "admin", "app", "fernway", "studio", "ACME"]) {
      const res = await api(ref.fw, `/api/slug-available?slug=${slug}`);
      expect(res.status, slug).toBe(200);
      expect(res.body, slug).toEqual({ slug: slug.toLowerCase(), available: false });
    }
    const free = await api(ref.fw, "/api/slug-available?slug=juniper-studio");
    expect(free.body).toEqual({ slug: "juniper-studio", available: true });
  });

  it("GET /api/slug-available rejects a malformed slug with 400 on the slug field", async () => {
    for (const slug of ["", "ab", "-lead", "trail-", "has space", "UPPER_case!", "double--dash", "x".repeat(41)]) {
      const res = await api(ref.fw, `/api/slug-available?slug=${encodeURIComponent(slug)}`);
      expect(res.status, slug).toBe(400);
      expect(res.body, slug).toEqual({ errors: { slug: "Use 3–40 lowercase letters, numbers or hyphens." } });
    }
  });

  it("POST /api/onboarding creates the workspace (201); its slug is taken afterwards and a second one answers 409", async () => {
    const res = await api(ref.fw, "/api/onboarding", {
      body: { ...WORKSPACE, invites: [" Priya@Juniper.test ", "", "marcus@juniper.test", "priya@juniper.test"], role: "admin" },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspaceName: "Juniper Studio",
      slug: "juniper-studio",
      useCase: "client",
      invites: ["priya@juniper.test", "marcus@juniper.test"],
      url: "fernway.app/juniper-studio",
    });
    expect(res.body.id).toMatch(UUID_RE);
    expect(res.body).not.toHaveProperty("role");
    expect((await api(ref.fw, "/api/slug-available?slug=juniper-studio")).body.available).toBe(false);

    const again = await api(ref.fw, "/api/onboarding", { body: { ...WORKSPACE, workspaceName: "Other" } });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ errors: { slug: "That URL is already taken. Try another one." } });
    const seeded = await api(ref.fw, "/api/onboarding", { body: { ...WORKSPACE, slug: "acme" } });
    expect(seeded.status).toBe(409);
  });

  it("validates: name and slug required, slug format, use case, at most 3 valid invite emails", async () => {
    const empty = await api(ref.fw, "/api/onboarding", { body: {} });
    expect(empty.status).toBe(400);
    expect(empty.body.errors).toEqual({
      workspaceName: "Enter a workspace name.",
      slug: "Choose a workspace URL.",
      useCase: "Choose how you'll use Fernway.",
    });
    const bad = await api(ref.fw, "/api/onboarding", {
      body: { workspaceName: "x".repeat(61), slug: "Bad Slug", useCase: "fun", invites: ["a@b.co", "c@d.co", "e@f.co", "g@h.co"] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual({
      workspaceName: "Use 60 characters or fewer.",
      slug: "Use 3–40 lowercase letters, numbers or hyphens.",
      useCase: "Choose one of: client, internal, personal.",
      invites: "Invite up to 3 teammates for now.",
    });
    const badEmail = await api(ref.fw, "/api/onboarding", { body: { ...WORKSPACE, invites: ["not-an-email"] } });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.errors).toEqual({ invites: "Enter valid email addresses for your teammates." });
    const notList = await api(ref.fw, "/api/onboarding", { body: { ...WORKSPACE, invites: "a@b.co" } });
    expect(notList.status).toBe(400);
  });

  it("invites are optional", async () => {
    const res = await api(ref.fw, "/api/onboarding", { body: { ...WORKSPACE, invites: undefined } });
    expect(res.status).toBe(201);
    expect(res.body.invites).toEqual([]);
  });

  it("the workspace name 'Crash' answers a bare 500 and stores nothing", async () => {
    const res = await api(ref.fw, "/api/onboarding", { body: { ...WORKSPACE, workspaceName: "  Crash  " } });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong" });
    expect(JSON.stringify(res.body)).not.toMatch(STACK_RE);
    expect((await api(ref.fw, "/api/slug-available?slug=juniper-studio")).body.available).toBe(true);
  });

  it("a repeated Idempotency-Key replays the first answer instead of a 409", async () => {
    const headers = { "idempotency-key": "onboarding-1" };
    const first = await api(ref.fw, "/api/onboarding", { body: WORKSPACE, headers });
    const again = await api(ref.fw, "/api/onboarding", { body: WORKSPACE, headers });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
  });
});

// ---- the wizard in a browser ---------------------------------------------------------------------

describe("/onboarding wizard (clean mode)", () => {
  const ref = useFernway("none");

  it("step 1 on load: stepper with aria-current, the Workspace form with labelled fields and a radio group; no errors", async () => {
    const { page, events, close } = await openWizard(ref.fw);
    try {
      expect(await page.title()).toBe("Fernway: Set up your workspace");
      const items = stepper(page).getByRole("listitem");
      expect(await items.count()).toBe(3);
      expect(await currentStep(page)).toContain("Workspace");
      expect(await page.locator("form").count()).toBe(1);
      const form = page.getByRole("form", { name: "Name your workspace" });
      expect(await form.count()).toBe(1);
      const name = page.getByLabel("Workspace name", { exact: true });
      const url = page.getByLabel("Workspace URL", { exact: true });
      expect(await name.getAttribute("required")).not.toBeNull();
      expect(await name.getAttribute("autocomplete")).toBe("organization");
      expect(await url.getAttribute("required")).not.toBeNull();
      expect(await page.getByText("fernway.app/", { exact: true }).isVisible()).toBe(true);
      const group = page.getByRole("radiogroup", { name: "What will you use Fernway for?" });
      const radios = group.getByRole("radio");
      expect(await radios.count()).toBe(3);
      expect(await group.getByRole("radio", { name: "Client projects" }).getAttribute("aria-checked")).toBe("true");
      expect(await group.getByRole("radio", { name: "Internal work" }).getAttribute("aria-checked")).toBe("false");
      expect(await group.getByRole("radio", { name: "Personal" }).getAttribute("aria-checked")).toBe("false");
      expect(await button(page, "Continue").getAttribute("type")).toBe("submit");
      await page.waitForLoadState("networkidle");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("the URL follows the workspace name (as a slug) and a debounced check shows Available / Taken in a status", async () => {
    const { page, events, close } = await openWizard(ref.fw);
    try {
      const url = page.getByLabel("Workspace URL", { exact: true });
      await fillWorkspace(page, "Juniper Studio & Co.");
      expect(await url.inputValue()).toBe("juniper-studio-co");
      const status = slugStatus(page);
      expect(await status.getAttribute("role")).toBe("status");
      await status.filter({ hasText: "Available" }).waitFor();
      expect(await describedBy(page, url)).toContain("Available");

      // Typing is normalised into a slug; once edited by hand the URL no longer follows the name.
      await url.fill("ACME");
      expect(await url.inputValue()).toBe("acme");
      await status.filter({ hasText: "Taken" }).waitFor();
      await page.getByLabel("Workspace name", { exact: true }).fill("Something else");
      expect(await url.inputValue()).toBe("acme");

      await url.fill("Hello World_2");
      expect(await url.inputValue()).toBe("hello-world-2");
      await status.filter({ hasText: "Available" }).waitFor();

      const checks = events.requests.filter((r) => r.url().includes("/api/slug-available"));
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.length).toBeLessThanOrEqual(6);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("an empty Continue marks both fields invalid with linked messages, focuses the first and announces the errors", async () => {
    const { page, close } = await openWizard(ref.fw);
    try {
      await button(page, "Continue").click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "workspaceName");
      const name = page.getByLabel("Workspace name", { exact: true });
      const url = page.getByLabel("Workspace URL", { exact: true });
      expect(await name.getAttribute("aria-invalid")).toBe("true");
      expect(await url.getAttribute("aria-invalid")).toBe("true");
      expect(await describedBy(page, name)).toContain("Enter a workspace name.");
      expect(await describedBy(page, url)).toContain("Choose a workspace URL.");
      expect(await page.getByRole("alert").filter({ hasText: "There are 2 problems with this form" }).count()).toBe(1);
      expect(await currentStep(page)).toContain("Workspace");
    } finally {
      await close();
    }
  });

  it("a malformed or taken URL blocks Continue with a message on the field", async () => {
    const { page, close } = await openWizard(ref.fw);
    try {
      await fillWorkspace(page, "Acme", "ab");
      await button(page, "Continue").click();
      const url = page.getByLabel("Workspace URL", { exact: true });
      await page.waitForFunction(() => document.querySelector('[name="slug"]')?.getAttribute("aria-invalid") === "true");
      expect(await describedBy(page, url)).toContain("Use 3–40 lowercase letters, numbers or hyphens.");

      await url.fill("acme");
      await button(page, "Continue").click();
      await page.getByText("That URL is already taken. Try another one.").waitFor();
      expect(await describedBy(page, url)).toContain("That URL is already taken. Try another one.");
      expect(await url.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await currentStep(page)).toContain("Workspace");
    } finally {
      await close();
    }
  });

  it("the radio cards work with the keyboard (arrow keys)", async () => {
    const { page, close } = await openWizard(ref.fw);
    try {
      const group = page.getByRole("radiogroup", { name: "What will you use Fernway for?" });
      await group.getByRole("radio", { name: "Client projects" }).focus();
      // Radix moves roving focus in a setTimeout, so wait for each move.
      await page.keyboard.press("ArrowDown");
      await group.getByRole("radio", { name: "Internal work", checked: true }).waitFor();
      await page.keyboard.press("ArrowDown");
      await group.getByRole("radio", { name: "Personal", checked: true }).waitFor();
      expect(await group.getByRole("radio", { name: "Personal" }).evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await group.getByRole("radio", { checked: true }).count()).toBe(1);
      // Tab leaves the group and Shift+Tab comes back to the selected item.
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await page.waitForFunction(() => document.activeElement?.id === "use-case-personal");
      // Clicking the card (not just the dot) selects it too.
      await page.getByText("Timelines, approvals and budgets for client work").click();
      expect(await group.getByRole("radio", { name: "Client projects" }).getAttribute("aria-checked")).toBe("true");
    } finally {
      await close();
    }
  });

  it("golden path (signed in as Alex): 3 steps, Back keeps values, Finish setup is pending, then the ready view, a toast and the dashboard link; the workspace is renamed", async () => {
    const { page, events, close } = await openWizard(ref.fw, { as: "alex" });
    try {
      await fillWorkspace(page, "Juniper Studio");
      await page.getByRole("radio", { name: "Internal work" }).click();
      await slugStatus(page).filter({ hasText: "Available" }).waitFor();
      await button(page, "Continue").click();

      // Step 2: invites. Focus moves to the step heading.
      const heading2 = page.getByRole("heading", { level: 2, name: "Invite teammates" });
      await heading2.waitFor();
      expect(await heading2.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await currentStep(page)).toContain("Invite teammates");
      expect(await page.locator("form").count()).toBe(1);
      await page.getByLabel("Teammate 1 email", { exact: true }).fill("priya@juniper.test");
      await button(page, "Add another").click();
      const second = page.getByLabel("Teammate 2 email", { exact: true });
      expect(await second.evaluate((el) => el === document.activeElement)).toBe(true);
      await second.fill("marcus@juniper.test");
      await button(page, "Add another").click();
      await page.getByLabel("Teammate 3 email", { exact: true }).fill("sofia@juniper.test");
      expect(await button(page, "Add another").count()).toBe(0);
      await page.getByRole("button", { name: "Remove teammate 3" }).click();
      expect(await page.getByLabel("Teammate 3 email", { exact: true }).count()).toBe(0);

      // Back to step 1: values kept.
      await button(page, "Back").click();
      await page.getByRole("heading", { level: 2, name: "Name your workspace" }).waitFor();
      expect(await page.getByLabel("Workspace name", { exact: true }).inputValue()).toBe("Juniper Studio");
      expect(await page.getByLabel("Workspace URL", { exact: true }).inputValue()).toBe("juniper-studio");
      expect(await page.getByRole("radio", { name: "Internal work" }).getAttribute("aria-checked")).toBe("true");
      await button(page, "Continue").click();
      await heading2.waitFor();
      expect(await page.getByLabel("Teammate 1 email", { exact: true }).inputValue()).toBe("priya@juniper.test");
      expect(await page.getByLabel("Teammate 2 email", { exact: true }).inputValue()).toBe("marcus@juniper.test");
      await button(page, "Continue").click();

      // Step 3: review.
      await page.getByRole("heading", { level: 2, name: "Review and finish" }).waitFor();
      expect(await currentStep(page)).toContain("Review");
      const review = page.locator("main");
      for (const text of ["Juniper Studio", "fernway.app/juniper-studio", "Internal work", "priya@juniper.test", "marcus@juniper.test"]) {
        expect(await review.textContent(), text).toContain(text);
      }

      const { release } = await hold(page, "/api/onboarding");
      const request = page.waitForRequest((r) => r.url().endsWith("/api/onboarding") && r.method() === "POST");
      await button(page, "Finish setup").click();
      const sent = await request;
      expect(sent.headers()["idempotency-key"]).toMatch(UUID_RE);
      expect(JSON.parse(sent.postData() ?? "{}")).toEqual({
        workspaceName: "Juniper Studio",
        slug: "juniper-studio",
        useCase: "internal",
        invites: ["priya@juniper.test", "marcus@juniper.test"],
      });
      await page.locator("button[type=submit][aria-busy=true]:disabled").waitFor();
      expect(await button(page, "Finish setup").isDisabled()).toBe(true);
      release();

      await page.getByRole("heading", { level: 2, name: "Your workspace is ready" }).waitFor();
      await page.getByRole("status").filter({ hasText: "Juniper Studio is ready at fernway.app/juniper-studio" }).waitFor();
      await toast(page, "Workspace created").waitFor();
      expect(await currentStep(page)).toBeNull();

      // Persistence: the URL is taken now.
      expect((await api(ref.fw, "/api/slug-available?slug=juniper-studio")).body.available).toBe(false);

      await page.getByRole("link", { name: "Go to your dashboard" }).click();
      await page.waitForURL(`${ref.fw.url}/app`);
      await page.getByText("Signed in as Alex Rivera · Juniper Studio").first().waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Signed in as Alex Rivera · Juniper Studio").first().waitFor();

      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      // The reload cancels the dashboard's images still loading (net::ERR_ABORTED): the browser's doing, not a failure.
      expect(events.failedRequests.filter((f) => !/\/images\/\S+: net::ERR_ABORTED$/.test(f))).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("step 2 validates the emails, and Skip goes to the review with no invites", async () => {
    const { page, close } = await openWizard(ref.fw);
    try {
      await toStep2(page);
      const first = page.getByLabel("Teammate 1 email", { exact: true });
      await first.fill("not-an-email");
      await button(page, "Continue").click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "invites.0.email");
      expect(await first.getAttribute("aria-invalid")).toBe("true");
      expect(await describedBy(page, first)).toContain("Enter an email address like name@studio.com.");
      expect(await page.getByRole("alert").filter({ hasText: "There is 1 problem with this form" }).count()).toBe(1);

      await button(page, "Skip").click();
      await page.getByRole("heading", { level: 2, name: "Review and finish" }).waitFor();
      expect(await page.locator("main").textContent()).toContain("No teammates invited yet");
    } finally {
      await close();
    }
  });

  it("a server failure (workspace 'Crash') shows an alert and a toast on the review step; the button comes back; values kept", async () => {
    const { page, close } = await openWizard(ref.fw);
    try {
      await fillWorkspace(page, "Crash");
      await slugStatus(page).filter({ hasText: "Available" }).waitFor();
      await button(page, "Continue").click();
      await button(page, "Skip").click();
      await button(page, "Finish setup").click();
      const alert = page.getByRole("alert").filter({ hasText: "Couldn't finish setup" });
      await alert.waitFor();
      expect(await alert.textContent()).toContain("Something went wrong on our side. Please try again.");
      await toast(page, "Couldn't finish setup").waitFor();
      expect(await button(page, "Finish setup").isEnabled()).toBe(true);
      expect(await currentStep(page)).toContain("Review");
      await button(page, "Back").click();
      await button(page, "Back").click();
      expect(await page.getByLabel("Workspace name", { exact: true }).inputValue()).toBe("Crash");
    } finally {
      await close();
    }
  });

  it("a URL taken while the wizard was open sends you back to step 1 with the message on the field", async () => {
    const { page, close } = await openWizard(ref.fw);
    try {
      await toStep2(page);
      await button(page, "Skip").click();
      await page.getByRole("heading", { level: 2, name: "Review and finish" }).waitFor();
      expect((await api(ref.fw, "/api/onboarding", { body: WORKSPACE })).status).toBe(201);
      await button(page, "Finish setup").click();
      await page.getByRole("heading", { level: 2, name: "Name your workspace" }).waitFor();
      const url = page.getByLabel("Workspace URL", { exact: true });
      await page.waitForFunction(() => document.querySelector('[name="slug"]')?.getAttribute("aria-invalid") === "true");
      expect(await describedBy(page, url)).toContain("That URL is already taken. Try another one.");
      await toast(page, "Couldn't finish setup").waitFor();
    } finally {
      await close();
    }
  });

  it("keyboard only: fill step 1, Enter continues, Skip and Finish setup with Enter", async () => {
    const { page, close } = await openWizard(ref.fw);
    try {
      await page.getByLabel("Workspace name", { exact: true }).focus();
      await page.keyboard.type("Keyboard Co");
      await slugStatus(page).filter({ hasText: "Available" }).waitFor();
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { level: 2, name: "Invite teammates" }).waitFor();
      await button(page, "Skip").focus();
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { level: 2, name: "Review and finish" }).waitFor();
      await button(page, "Finish setup").focus();
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { level: 2, name: "Your workspace is ready" }).waitFor();
    } finally {
      await close();
    }
  });

  it.each(["light", "dark"] as const)("every step passes axe in %s mode", async (colorScheme) => {
    const { page, close } = await openWizard(ref.fw, { colorScheme });
    try {
      expect(await axeViolations(page), "step 1").toEqual([]);
      await button(page, "Continue").click();
      await page.getByRole("alert").filter({ hasText: "problems" }).waitFor();
      expect(await axeViolations(page), "step 1 errors").toEqual([]);
      await fillWorkspace(page, "Axe Studio");
      await slugStatus(page).filter({ hasText: "Available" }).waitFor();
      expect(await axeViolations(page), "step 1 available").toEqual([]);
      await button(page, "Continue").click();
      await page.getByRole("heading", { level: 2, name: "Invite teammates" }).waitFor();
      await button(page, "Add another").click();
      expect(await axeViolations(page), "step 2").toEqual([]);
      await button(page, "Skip").click();
      await page.getByRole("heading", { level: 2, name: "Review and finish" }).waitFor();
      expect(await axeViolations(page), "step 3").toEqual([]);
      await button(page, "Finish setup").click();
      await page.getByRole("heading", { level: 2, name: "Your workspace is ready" }).waitFor();
      expect(await axeViolations(page), "done").toEqual([]);
    } finally {
      await close();
    }
  });

  it("every step reflows at 320px (no horizontal scroll)", async () => {
    const { page, close } = await openWizard(ref.fw, { viewport: { width: 320, height: 800 } });
    try {
      expect(await horizontalOverflow(page), "step 1").toBe(false);
      await fillWorkspace(page, "A studio with a rather long workspace name");
      await slugStatus(page).filter({ hasText: "Available" }).waitFor();
      expect(await horizontalOverflow(page), "step 1 filled").toBe(false);
      await button(page, "Continue").click();
      await button(page, "Add another").click();
      await button(page, "Add another").waitFor();
      expect(await horizontalOverflow(page), "step 2").toBe(false);
      await page.getByLabel("Teammate 1 email", { exact: true }).fill("someone.with.a.long.address@a-long-studio-domain.test");
      await button(page, "Continue").click();
      await page.getByRole("heading", { level: 2, name: "Review and finish" }).waitFor();
      expect(await horizontalOverflow(page), "step 3").toBe(false);
      await button(page, "Finish setup").click();
      await page.getByRole("heading", { level: 2, name: "Your workspace is ready" }).waitFor();
      expect(await horizontalOverflow(page), "done").toBe(false);
    } finally {
      await close();
    }
  });

  it("buttons, radios and links are at least 24x24 on every step", async () => {
    const { page, close } = await openWizard(ref.fw);
    try {
      const small = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("main button, main [role=radio], main a")]
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && (r.width < 24 || r.height < 24))
            .map(({ el }) => el.outerHTML.slice(0, 120)),
        );
      expect(await small(), "step 1").toEqual([]);
      await toStep2(page);
      await button(page, "Add another").click();
      expect(await small(), "step 2").toEqual([]);
    } finally {
      await close();
    }
  });
});

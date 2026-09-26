/**
 * waitForCreates() runs right after a submit click. The click resolves before the page's save request reaches
 * the capture (Playwright delivers the request event asynchronously, later still on a busy machine), so
 * "no create request yet" must not be read as "every create request finished".
 */
import type { Page, Request } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../test-support/harness.js";
import { projectFields, projectForm, startWidgetApp, wizardForm, type WidgetApp } from "../../../test/fixtures/widgets/widget-app.js";
import { SIMULATED_RESPONSE_HEADER, type Capture, type DiscoveredForm, type FormField } from "../../core/types.js";
import { attachCapture } from "../../engine/capture.js";
import {
  CREATE_GRACE_MS,
  MULTI_STEP_NOTE,
  canaryValues,
  createRequests,
  fillForm,
  fillProblemsNote,
  isNextStep,
  isRefusedSignIn,
  isSignInForm,
  settingFor,
  simulatedResponse,
  submitForm,
  valueKept,
  waitForCreates,
  watchNextStep,
  type FormStep,
} from "./functional-form.js";

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

// ---------- 0.4.0: widgets (LOV-1) and multi-step forms (LOV-12) ----------

describe("canaryValues + settingFor: the fill policy for widgets (LOV-1)", () => {
  const form = projectForm("http://127.0.0.1:4100/projects");
  const values = canaryValues(form, "tok1", "keep");
  const by = (key: string) => values.find((v) => v.field.key === key)!;

  it("picks the first real option of every choice, widget or native", () => {
    expect(settingFor(by("teamSize"))).toEqual({ option: "1–5" });
    expect(settingFor(by("priority"))).toEqual({ option: "low" });
    expect(settingFor(by("region"))).toEqual({ option: "Europe" });
    // Choices that only exist once the list is open: the first one it shows.
    expect(settingFor(by("owner"))).toEqual({ option: "first" });
    expect(settingFor(by("city"))).toEqual({ option: "first" });
  });

  it("skips an option that means nothing chosen", () => {
    const region = { ...projectFields().region!, options: [{ label: "Select a region", selector: "#a" }, { label: "Europe", selector: "#b" }] };
    expect(canaryValues({ ...form, fields: [region] }, "tok1", "keep")[0]!.value).toBe("Europe");
  });

  it("checks consent and required checkboxes only; leaves optional switches and sliders as they are", () => {
    expect(settingFor(by("terms"))).toEqual({ checked: true });
    expect(settingFor(by("notify"))).toBeNull();
    expect(settingFor(by("budget"))).toBeNull();
    const notify = by("notify");
    expect(settingFor({ ...notify, field: { ...notify.field, required: true, requiredBy: "label" } })).toEqual({ checked: true });
  });

  it("types a canary into text fields; a required marker in the label is not part of the value", () => {
    expect(by("name").canary).toBe(true);
    expect(settingFor(by("name"))).toEqual({ text: by("name").value });
    expect(by("name").value).toBe("name tok1keep");
  });
});

describe("canaryValues + settingFor: the signed-in account's own email (0.4.1)", () => {
  const field = (key: string, extra: Partial<FormField> = {}): FormField => ({
    key,
    selector: `#${key}`,
    type: key === "email" ? "email" : "text",
    role: "textbox",
    accessibleName: key,
    label: key,
    required: true,
    ...extra,
  } as FormField);
  const form = (fields: FormField[]): DiscoveredForm => ({ url: "http://127.0.0.1:4100/settings", selector: "#profile", name: "Profile", fields, controls: [] });

  it("leaves an email field that holds the account's email alone, and still types canaries into the others", () => {
    const values = canaryValues(form([field("displayName"), field("email", { holdsAccountEmail: true })]), "tok1", "own");
    const email = values.find((v) => v.field.key === "email")!;
    expect(email).toMatchObject({ keep: true, canary: false });
    expect(settingFor(email)).toBeNull();
    expect(values.find((v) => v.field.key === "displayName")!.canary).toBe(true);
  });

  it("types a canary into an email field that doesn't hold the account's email", () => {
    const email = canaryValues(form([field("email")]), "tok1", "own")[0]!;
    expect(email.keep).toBeUndefined();
    expect(settingFor(email)).toEqual({ text: email.value });
  });
});

let widgetApp: WidgetApp | undefined;
const widgetPages: Page[] = [];

async function widgetPage(path: string): Promise<{ page: Page; capture: Capture; url: string }> {
  widgetApp ??= await startWidgetApp();
  const page = await (await getBrowser()).newPage();
  widgetPages.push(page);
  const capture = attachCapture(page);
  const url = `${widgetApp.url}${path}`;
  await page.goto(url, { waitUntil: "networkidle" });
  return { page, capture, url };
}

afterAll(async () => {
  await Promise.all(widgetPages.map((p) => p.close().catch(() => undefined)));
  await widgetApp?.close();
  await closeBrowser();
});

describe("fillForm on a Radix/shadcn form (LOV-1)", () => {
  it("sets every widget the form's rules need, so submitting it saves (201)", async () => {
    const { page, capture, url } = await widgetPage("/projects");
    const form = projectForm(url);
    const problems = await fillForm(page, canaryValues(form, "tok1", "keep"));
    expect(problems).toEqual([]);
    await submitForm(page, form);
    await waitForCreates(page, capture, url, 10_000, "tok1");
    expect(createRequests(capture, url, "tok1").map((r) => r.status)).toEqual([201]);
    const body = widgetApp!.posts("/api/projects").at(-1)!;
    expect(body).toMatchObject({ teamSize: "1-5", priority: "low", owner: "Alex Rivera", city: "Lisbon", region: "eu", terms: true, notify: false, budget: 5000 });
    expect(String(body["name"])).toContain("tok1keep");
  });

  it("keeps going past a field it can't set and returns it, named, instead of stopping", async () => {
    const { page, url } = await widgetPage("/projects");
    const form = projectForm(url);
    const broken: DiscoveredForm = {
      ...form,
      fields: form.fields.map((f) => (f.key === "owner" ? { ...f, accessibleName: "Assignee", label: "Assignee", selector: "#gone" } : f)),
    };
    const problems = await fillForm(page, canaryValues(broken, "tok1", "keep"));
    expect(problems.map((p) => p.field.key)).toEqual(["owner"]);
    expect(problems[0]!.message).toMatch(/^Couldn't set Assignee: /);
    // The fields after it were still set.
    expect(await page.locator("#f-terms").getAttribute("aria-checked")).toBe("true");
    expect(fillProblemsNote(problems)).toMatch(/^Run Hound could not set Assignee \(it was not on the page/);
    expect(fillProblemsNote([])).toBe("");
  });
});

describe("isNextStep (LOV-12)", () => {
  const step = (fields: string[], indicator: string | null = null): FormStep => ({ fields, step: indicator });

  it("is a next step when nothing was saved and new fields appeared, or the step indicator changed", () => {
    expect(isNextStep(step(["input|text|workspace|Workspace name"]), step(["input|email|email|Invite a teammate"]), 0)).toBe(true);
    expect(isNextStep(step(["input|text|a|A"], "step 1 of 3"), step(["input|text|a|A"], "step 2 of 3"), 0)).toBe(true);
  });

  it("is not when a save was sent, nothing changed, or the fields only went away (a thank-you message)", () => {
    expect(isNextStep(step(["a"]), step(["b"]), 1)).toBe(false);
    expect(isNextStep(step(["a"], "1. Workspace"), step(["a"], "1. Workspace"), 0)).toBe(false);
    expect(isNextStep(step(["a", "b"]), step([]), 0)).toBe(false);
    expect(isNextStep(step(["a"], "1. Workspace"), step([], null), 0)).toBe(false);
  });
});

describe("watchNextStep: telling a wizard's first step from a refused submit (LOV-12)", () => {
  const submitStepOne = async (path: string, fill: boolean) => {
    const { page, capture, url } = await widgetPage(path);
    const form = wizardForm(url);
    if (fill) expect(await fillForm(page, canaryValues(form, "tok1", "step"))).toEqual([]);
    const watch = await watchNextStep(page, capture, url, "tok1");
    await submitForm(page, form);
    await waitForCreates(page, capture, url, 10_000, "tok1");
    return { moved: await watch.moved(), page };
  };

  it("sees the move to step 2 (new fields, aria-current=step moved) when step 1 sent nothing", async () => {
    const { moved, page } = await submitStepOne("/wizard", true);
    expect(await page.getByLabel("Invite a teammate").isVisible()).toBe(true);
    expect(moved).toBe(true);
  });

  it("sees it with a 'Step 1 of 2' text indicator too", async () => {
    expect((await submitStepOne("/wizard?indicator=text", true)).moved).toBe(true);
  });

  it("is not a next step when the first step refused an empty submit", async () => {
    expect((await submitStepOne("/wizard", false)).moved).toBe(false);
  });

  it("is not a next step when the submit saved, or when the form's rules refused it", async () => {
    const saved = await widgetPage("/projects");
    const form = projectForm(saved.url);
    await fillForm(saved.page, canaryValues(form, "tok1", "saved"));
    const watchSaved = await watchNextStep(saved.page, saved.capture, saved.url, "tok1");
    await submitForm(saved.page, form);
    await waitForCreates(saved.page, saved.capture, saved.url, 10_000, "tok1");
    expect(await watchSaved.moved()).toBe(false);

    const refused = await widgetPage("/projects");
    const watchRefused = await watchNextStep(refused.page, refused.capture, refused.url, "tok1");
    await submitForm(refused.page, projectForm(refused.url));
    await waitForCreates(refused.page, refused.capture, refused.url, 10_000, "tok1");
    expect(await watchRefused.moved()).toBe(false);
  });

  it("MULTI_STEP_NOTE says what happened in plain words", () => {
    expect(MULTI_STEP_NOTE).toMatch(/^Skipped: /);
    expect(MULTI_STEP_NOTE).toMatch(/multi-step form/);
    expect(MULTI_STEP_NOTE).toMatch(/first step/);
  });
});

describe("valueKept: is what fillForm set still there? (widgets included)", () => {
  it("reads text, native and widget choices, radios and checkboxes; null for what fillForm left alone", async () => {
    const { page, url } = await widgetPage("/projects");
    const values = canaryValues(projectForm(url), "tok1", "kept");
    expect(await fillForm(page, values)).toEqual([]);
    const kept = async () => Object.fromEntries(await Promise.all(values.map(async (v) => [v.field.key, await valueKept(page, v)] as const)));
    expect(await kept()).toEqual({
      name: true,
      teamSize: true,
      priority: true,
      // The first option a picker showed, or a slider and switch fillForm never touched: nothing to compare.
      budget: null,
      notify: null,
      owner: null,
      city: null,
      region: true,
      terms: true,
    });

    // The page wipes the form (as some apps do after a failed save).
    await page.locator("#f-name").fill("");
    await page.locator("#f-region").selectOption("");
    await page.locator("#f-terms").click();
    await page.locator("#f-p-medium").click();
    await page.locator("#f-team + select").selectOption("21-50", { force: true });
    const after = await kept();
    expect([after["name"], after["region"], after["terms"], after["priority"], after["teamSize"]]).toEqual([false, false, false, false, false]);
    // A field that is gone is not kept.
    expect(await valueKept(page, { ...values[0]!, field: { ...values[0]!.field, selector: "#gone" } })).toBe(false);
  });
});

/**
 * The Settings page's structure and wording (D10), driven in real Chromium. The page is renderUi's document and every
 * /api/* call is answered by a stub (page.route), so these tests pin the client. The desktop's preload marks
 * <html data-shell="desktop" data-platform="darwin|linux|win32"> before any script runs (desktop/src/chrome.ts); an
 * init script does the same here. Pinned:
 * - Five cards in order, each a region named by its heading: AI model, Test accounts, Keys and passwords, Run defaults,
 *   About. A nav "On this page" links to each: a click (or Enter) scrolls the card into view and focuses its heading,
 *   and the route stays #/settings.
 * - Each test account has a status chip from GET /api/accounts: Ready, Not set up, or what is missing. A saved
 *   password is never shown; the password field has a Show / Hide button for what is being typed. Test sign-in's answer
 *   is a notice (success, error, or the in-progress one), never plain text.
 * - How keys and passwords are kept is said once, in the Keys and passwords card, for each secretProtection value, with
 *   the platform's keychain note on the desktop.
 * - With a key saved, the AI card lists no models on its own (listing uses the key, and the OS may ask for keychain
 *   access just because Settings opened): Refresh does.
 * - No console errors, and nothing scrolls sideways at the desktop's minimum size or on a phone.
 */
import { chromium, type Browser, type Page, type Request, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountId } from "../../../src/types/accounts.js";
import type { AccountStatus, AccountsStatus } from "../../../src/interfaces/accounts.js";
import type { AiModelList, AiStatus } from "../../../src/ai/types.js";
import type { SecretProtection } from "../../../src/types/secrets.js";
import { renderUi } from "../../../src/server/ui/index.js";

const ORIGIN = "http://rh.test";
const HTML = renderUi({ version: "0.7.0", canShowBrowser: true });
const LOGIN_URL = "http://127.0.0.1:5173/login";
const CONFIG_DIR = "/home/me/.config/run-hound";

const slot = (id: AccountId, extra: Partial<AccountStatus> = {}): AccountStatus => ({
  id,
  label: id === "a" ? "Account A" : "Account B",
  loginUrl: "",
  username: "",
  hasPassword: false,
  ready: false,
  sources: { label: "default", loginUrl: "default", username: "default", password: "default" },
  problem: null,
  ...extra,
});
const READY = (id: AccountId): AccountStatus => slot(id, { loginUrl: LOGIN_URL, username: "alex@fernway.test", hasPassword: true, ready: true, sources: { label: "default", loginUrl: "file", username: "file", password: "file" } });

function accounts(a: AccountStatus, b: AccountStatus, secretProtection?: SecretProtection): AccountsStatus {
  return { isolated: true, isolatedSource: "default", accounts: { a, b }, file: CONFIG_DIR + "/accounts.json", ...(secretProtection ? { secretProtection } : {}) };
}

function ai(extra: Partial<AiStatus> = {}): AiStatus {
  return {
    enabled: true,
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "ornith-1.5:9b",
    region: null,
    allowRemote: false,
    features: { review: true, suggest: true, explain: true },
    timeoutMs: 120_000,
    hasKey: false,
    remote: false,
    host: "127.0.0.1",
    problem: null,
    sources: { enabled: "file", provider: "file", baseUrl: "file", model: "file", apiKey: "default", region: "default", allowRemote: "default", features: "default", timeoutMs: "default" },
    file: CONFIG_DIR + "/ai.json",
    ...extra,
  };
}
/** Anthropic with a key saved: the case where listing models would use the key. */
const KEYED = (extra: Partial<AiStatus> = {}): AiStatus =>
  ai({
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-saved-1",
    remote: true,
    host: "api.anthropic.com",
    allowRemote: true,
    hasKey: true,
    sources: { ...ai().sources, apiKey: "file" },
    ...extra,
  });

const MODELS: AiModelList = { models: [{ id: "claude-saved-1", details: null, suitable: true }, { id: "claude-new-2", details: "newest", suitable: true }], error: null };

type Json = Record<string, unknown>;
interface Stub {
  accounts: AccountsStatus;
  ai: AiStatus;
  test: (body: Json) => unknown;
  /** Holds the answer to POST /api/accounts/test until released, to look at the in-progress notice. */
  gateTest?: Promise<void>;
}
interface Opened {
  page: Page;
  errors: string[];
  calls: { method: string; path: string; body: Json | null }[];
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

/** Applies a PUT /api/accounts patch the way the server would. */
function applyPatch(current: AccountsStatus, body: Json): AccountsStatus {
  const next = JSON.parse(JSON.stringify(current)) as AccountsStatus;
  const patch = (body.accounts ?? {}) as Partial<Record<AccountId, Record<string, string>>>;
  for (const id of ["a", "b"] as const) {
    const p = patch[id];
    if (!p) continue;
    const s = next.accounts[id];
    if (typeof p.loginUrl === "string") s.loginUrl = p.loginUrl;
    if (typeof p.username === "string") s.username = p.username;
    if (typeof p.password === "string") s.hasPassword = p.password !== "";
    s.ready = Boolean(s.loginUrl && s.username && s.hasPassword);
  }
  return next;
}

interface OpenOptions {
  width?: number;
  height?: number;
  /** Mark the page as the desktop app, on this platform. */
  desktop?: "darwin" | "linux" | "win32";
  /** Set data-platform without data-shell: a browser never has it, and must not show a desktop note. */
  platformOnly?: string;
}

async function open(stub: Partial<Stub>, opts: OpenOptions = {}): Promise<Opened> {
  const s: Stub = {
    accounts: accounts(READY("a"), slot("b")),
    ai: ai(),
    test: () => ({ id: "a", ok: true, landedOn: "/notes", message: "Signed in; landed on /notes." }),
    ...stub,
  };
  const page = await browser.newPage({ viewport: { width: opts.width ?? 1280, height: opts.height ?? 900 } });
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  const calls: Opened["calls"] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  if (opts.desktop || opts.platformOnly) {
    // As desktop/src/chrome.ts does: the script runs before there is an <html>, so it waits for the element itself.
    await page.addInitScript(
      ({ shell, platform }) => {
        const mark = () => {
          if (!document.documentElement) return false;
          if (shell) document.documentElement.dataset.shell = "desktop";
          document.documentElement.dataset.platform = platform;
          return true;
        };
        if (!mark()) new MutationObserver((_r, observer) => { if (mark()) observer.disconnect(); }).observe(document, { childList: true });
      },
      { shell: Boolean(opts.desktop), platform: opts.desktop ?? opts.platformOnly ?? "" },
    );
  }
  await page.route(`${ORIGIN}/**`, async (route: Route, req: Request) => {
    const url = new URL(req.url());
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    const body = req.postData() ? (JSON.parse(req.postData()!) as Json) : null;
    calls.push({ method: req.method(), path: url.pathname, body });
    if (url.pathname === "/api/accounts" && req.method() === "GET") return json(s.accounts);
    if (url.pathname === "/api/accounts" && req.method() === "PUT") {
      s.accounts = applyPatch(s.accounts, body ?? {});
      return json(s.accounts);
    }
    if (url.pathname === "/api/accounts/test") {
      if (s.gateTest) await s.gateTest;
      return json(s.test(body ?? {}));
    }
    if (url.pathname === "/api/ai" && req.method() === "GET") return json(s.ai);
    if (url.pathname === "/api/ai" && req.method() === "PUT") {
      s.ai = { ...s.ai, ...(body as Partial<AiStatus>), hasKey: s.ai.hasKey };
      return json(s.ai);
    }
    if (url.pathname === "/api/ai/models") return json(MODELS);
    if (url.pathname === "/api/settings") return json({ version: "0.7.0", runsDir: "/home/me/run-hound/runs", allowedHosts: [], serverHosts: [], ai: s.ai });
    return json({ error: "not stubbed" }, 404);
  });
  await page.goto(`${ORIGIN}/#/settings`);
  return { page, errors, calls };
}

const modelCalls = (o: Opened) => o.calls.filter((c) => c.path === "/api/ai/models");
const account = (page: Page, name: string | RegExp) => page.getByRole("region", { name: "Test accounts" }).getByRole("group", { name });
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

describe("Settings: structure and the section nav", () => {
  it("lists five cards in order: AI model, Test accounts, Keys and passwords, Run defaults, About", async () => {
    const o = await open({});
    const { page } = o;
    await page.getByRole("region", { name: "About" }).waitFor();
    expect(await page.locator("#view h1").innerText()).toBe("Settings");
    expect(await page.locator("#view .page > section h2").allInnerTexts()).toEqual(["AI model", "Test accounts", "Keys and passwords", "Run defaults", "About"]);
    for (const name of ["AI model", "Test accounts", "Keys and passwords", "Run defaults", "About"]) expect(await page.getByRole("region", { name }).count(), name).toBe(1);
    // Help and feedback moved into About; the old card names are gone.
    expect(await page.getByRole("region", { name: "About" }).getByRole("link", { name: /Send feedback/ }).getAttribute("href")).toContain("github.com/rahul-bharati/run-hound/issues");
    for (const gone of ["Help and feedback", "This computer", "This server"]) expect(await page.getByRole("heading", { name: gone }).count(), gone).toBe(0);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("has a nav 'On this page' whose links, by click or keyboard, scroll to a card and focus its heading", async () => {
    const o = await open({});
    const { page } = o;
    const nav = page.getByRole("navigation", { name: "On this page" });
    await nav.waitFor();
    const names = ["AI model", "Test accounts", "Keys and passwords", "Run defaults", "About"];
    expect(await nav.getByRole("link").allInnerTexts()).toEqual(names);
    const heading = { "AI model": "ai-h", "Test accounts": "accounts-h", "Keys and passwords": "keys-h", "Run defaults": "defaults-h", About: "about-h" } as const;
    for (const [i, name] of names.entries()) {
      const link = nav.getByRole("link", { name, exact: true });
      if (i % 2 === 0) await link.click();
      else {
        await link.focus();
        await page.keyboard.press("Enter");
      }
      await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id), { message: name }).toBe(heading[name as keyof typeof heading]);
      // The card is on screen (the page may not scroll far enough to put the last ones at the top).
      const top = await page.getByRole("region", { name, exact: true }).evaluate((el) => el.getBoundingClientRect().top);
      expect(top, name).toBeLessThan(900);
      expect(top, name).toBeGreaterThan(-5);
      // Still the Settings route: a plain #anchor would have sent the router to New Run.
      expect(await page.evaluate(() => location.hash)).toBe("#/settings");
    }
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("fits the desktop's minimum size (960 x 600) and a phone (375 px) without sideways scrolling", async () => {
    for (const size of [{ width: 960, height: 600 }, { width: 375, height: 740 }]) {
      const o = await open({ accounts: accounts(READY("a"), slot("b", { loginUrl: "http://127.0.0.1:5173/a/very/long/sign-in/path/that/keeps/going/and/going", username: "somebody.with.a.long.name@example.test" }), "os-keychain"), ai: KEYED({ secretProtection: "os-keychain" }) }, { ...size, desktop: "darwin" });
      await o.page.getByRole("region", { name: "About" }).waitFor();
      await expect.poll(() => o.page.locator("#keys-card .keys-lead").count()).toBe(1);
      await o.page.locator("#acct-a-status").waitFor();
      expect(await noSidewaysScroll(o.page), String(size.width)).toBe(true);
      expect(o.errors).toEqual([]);
      await o.page.close();
    }
  });
});

describe("Settings → Test accounts: status, password and test results", () => {
  it("shows Ready, Not set up, and what is missing, on each account's card", async () => {
    const o = await open({
      accounts: accounts(READY("a"), slot("b")),
    });
    const { page } = o;
    await expect.poll(() => page.locator("#acct-a-status").innerText()).toBe("Ready");
    expect(await page.locator("#acct-b-status").innerText()).toBe("Not set up");
    await page.close();

    const partial = await open({
      accounts: accounts(slot("a", { loginUrl: LOGIN_URL, username: "alex@fernway.test" }), slot("b", { username: "sam@fernway.test" })),
    });
    await expect.poll(() => partial.page.locator("#acct-a-status").innerText()).toBe("Needs a password");
    expect(await partial.page.locator("#acct-b-status").innerText()).toBe("Needs a sign-in page and a password");
    expect(await account(partial.page, /Account A/).getByText("Add what is missing, then choose Save.").count()).toBe(1);
    await partial.page.close();

    const noPage = await open({ accounts: accounts(slot("a", { username: "alex@fernway.test", hasPassword: true }), slot("b", { loginUrl: LOGIN_URL, hasPassword: true })) });
    await expect.poll(() => noPage.page.locator("#acct-a-status").innerText()).toBe("Needs a sign-in page");
    expect(await noPage.page.locator("#acct-b-status").innerText()).toBe("Needs a username");
    await noPage.page.close();
    expect(o.errors).toEqual([]);
    expect(partial.errors).toEqual([]);
    expect(noPage.errors).toEqual([]);
  });

  it("turns Not set up into Ready once the missing pieces are saved", async () => {
    const o = await open({});
    const { page } = o;
    const b = account(page, /Account B/);
    await expect.poll(() => page.locator("#acct-b-status").innerText()).toBe("Not set up");
    await b.getByLabel("Sign-in page URL").fill(LOGIN_URL);
    await b.getByLabel("Username (or email)").fill("sam@fernway.test");
    await b.getByLabel("Password", { exact: true }).fill("typed-secret-5678");
    await b.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(() => page.locator("#acct-b-status").innerText()).toBe("Ready");
    expect(await page.content()).not.toContain("typed-secret-5678");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("orders the fields: sign-in page, username, password, then the optional name", async () => {
    const o = await open({});
    const a = account(o.page, /Account A/);
    await a.waitFor();
    const labels = await a.locator("label.field-label").allInnerTexts();
    expect(labels).toEqual(["Sign-in page URL", "Username (or email)", "Password", "Name in plans and reports (optional)"]);
    await o.page.close();
  });

  it("toggles the typed password between hidden and shown, and never shows a saved one", async () => {
    const o = await open({});
    const { page } = o;
    const a = account(page, /Account A/);
    const password = a.getByLabel("Password", { exact: true });
    await password.waitFor();
    expect(await password.getAttribute("type")).toBe("password");
    // A saved password is not in the field, so showing the field shows nothing of it.
    const toggle = a.getByRole("button", { name: /Show password/ });
    await toggle.click();
    expect(await password.getAttribute("type")).toBe("text");
    expect(await password.inputValue()).toBe("");
    await password.fill("typed-secret-9999");
    expect(await a.getByRole("button", { name: /Hide password for Account A/ }).count()).toBe(1);
    await a.getByRole("button", { name: /Hide password/ }).click();
    expect(await password.getAttribute("type")).toBe("password");
    expect(await password.inputValue()).toBe("typed-secret-9999");
    expect(await a.getByRole("button", { name: /Show password for Account A/ }).count()).toBe(1);
    // After a save the field is empty and hidden again.
    await a.getByRole("button", { name: /Show password/ }).click();
    await a.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(() => account(page, /Account A/).getByLabel("Password", { exact: true }).inputValue()).toBe("");
    expect(await account(page, /Account A/).getByLabel("Password", { exact: true }).getAttribute("type")).toBe("password");
    expect(await page.content()).not.toContain("typed-secret-9999");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("shows Test sign-in's progress and answer as notices: info, then success or error", async () => {
    let release = () => {};
    const gateTest = new Promise<void>((resolve) => { release = resolve; });
    let answer: unknown = { id: "a", ok: true, landedOn: "/notes", message: "Signed in; landed on /notes." };
    const o = await open({ gateTest, test: () => answer });
    const { page } = o;
    const a = account(page, /Account A/);
    const result = page.locator("#acct-a-test-result");
    await a.waitFor();
    expect(await result.count()).toBe(1);
    expect(await result.isVisible()).toBe(false);
    // What was typed since the last save isn't used by the test: the notice says so.
    await a.getByLabel("Username (or email)").fill("someone-else@fernway.test");
    await a.getByRole("button", { name: "Test sign-in" }).click();
    await expect.poll(() => result.getAttribute("class")).toBe("notice acct-test info");
    expect(await result.innerText()).toContain("Signing in with the saved details.");
    expect(await result.innerText()).toContain("What you have typed since you last saved isn't used.");
    release();
    await expect.poll(() => result.getAttribute("class")).toBe("notice acct-test ok");
    expect(await result.innerText()).toBe("Signed in; landed on /notes.");
    expect(await result.locator(".ic").count()).toBe(1);

    answer = { id: "a", ok: false, message: "Email or password is incorrect" };
    await a.getByRole("button", { name: "Test sign-in" }).click();
    await expect.poll(() => result.getAttribute("class")).toBe("notice acct-test err");
    expect(await result.innerText()).toBe("Email or password is incorrect");
    expect(o.errors).toEqual([]);
    await page.close();
  });
});

describe("Settings → Keys and passwords", () => {
  const keysText = (page: Page) => page.locator("#keys-card").innerText();

  it("says once that keys and passwords are encrypted with the system keychain, kept on this machine and never shown again", async () => {
    const o = await open({ ai: KEYED({ secretProtection: "os-keychain" }) });
    const { page } = o;
    await expect.poll(() => keysText(page)).toContain("encrypted with your system keychain");
    const text = await keysText(page);
    expect(text).toContain("Your API keys and test-account passwords are encrypted with your system keychain.");
    expect(text).toContain("They are stored only on this machine.");
    expect(text).toContain("They are never shown again after you save them.");
    expect(text).toContain("Encrypted with your system keychain");
    // Where they are kept: the settings folder, from the status's file path.
    expect(await page.locator("#keys-card code").innerText()).toBe(CONFIG_DIR);
    // A browser has no platform note.
    expect(await page.locator("#keys-platform-note").count()).toBe(0);
    // Said once: neither the AI card nor the accounts card repeats it.
    for (const id of ["#ai-card", "#accounts-card"]) expect(await page.locator(id).innerText(), id).not.toMatch(/encrypted|keychain/i);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("says it is encrypted by Run Hound, readable only by your user account, when no system keychain was available", async () => {
    const o = await open({ ai: ai({ secretProtection: "run-hound" }) });
    await expect.poll(() => keysText(o.page)).toContain("encrypted by Run Hound");
    const text = await keysText(o.page);
    expect(text).toContain("Your API keys and test-account passwords are encrypted by Run Hound on this machine, and only your user account can read them.");
    expect(text).toContain("No system keychain was available.");
    expect(text).toContain("They are never shown again after you save them.");
    await o.page.close();
  });

  it("says keys and passwords aren't saved here when only the environment sets them", async () => {
    const o = await open({ ai: ai({ secretProtection: "environment" }), accounts: accounts(READY("a"), slot("b"), "environment") });
    await expect.poll(() => keysText(o.page)).toContain("aren't saved here");
    const text = await keysText(o.page);
    expect(text).toContain("API keys and test-account passwords aren't saved here: set them with environment variables when you start the container.");
    expect(text).toContain("Not saved here");
    expect(text).not.toContain("Encrypted files");
    await o.page.close();
  });

  it("takes the protection from the accounts status when the AI status has none, and says it plainly when neither does", async () => {
    const fromAccounts = await open({ accounts: accounts(READY("a"), slot("b"), "run-hound") });
    await expect.poll(() => keysText(fromAccounts.page)).toContain("encrypted by Run Hound");
    await fromAccounts.page.close();
    const neither = await open({});
    await expect.poll(() => keysText(neither.page)).toContain("are kept on this machine");
    expect(await keysText(neither.page)).not.toMatch(/\b(null|undefined)\b/);
    await neither.page.close();
  });

  it("on the desktop says 'this computer', and on macOS that the keychain may ask: choose Always Allow", async () => {
    const o = await open({ ai: ai({ secretProtection: "os-keychain" }) }, { desktop: "darwin" });
    const note = o.page.locator("#keys-platform-note");
    await note.waitFor();
    expect(await note.innerText()).toBe("The first time Run Hound needs them, macOS may ask whether Run Hound can use your keychain. Choose Always Allow.");
    const text = await keysText(o.page);
    expect(text).toContain("They are stored only on this computer.");
    expect(text).not.toContain("this machine");
    // The AI card's key field points here in the same words.
    expect(await o.page.getByRole("link", { name: "Kept safe on this computer" }).count()).toBeGreaterThan(0);
    expect(o.errors).toEqual([]);
    await o.page.close();
  });

  it("on Linux says the system may ask to unlock the keyring", async () => {
    const o = await open({ ai: ai({ secretProtection: "os-keychain" }) }, { desktop: "linux" });
    const note = o.page.locator("#keys-platform-note");
    await note.waitFor();
    expect(await note.innerText()).toBe("Your system may ask you to unlock your keyring the first time Run Hound needs them.");
    await o.page.close();
  });

  it("on Windows adds no note, and neither do other protections or a page that isn't the desktop app", async () => {
    const win = await open({ ai: ai({ secretProtection: "os-keychain" }) }, { desktop: "win32" });
    await expect.poll(() => keysText(win.page)).toContain("encrypted with your system keychain");
    expect(await win.page.locator("#keys-platform-note").count()).toBe(0);
    await win.page.close();

    const ownStore = await open({ ai: ai({ secretProtection: "run-hound" }) }, { desktop: "darwin" });
    await expect.poll(() => keysText(ownStore.page)).toContain("encrypted by Run Hound");
    expect(await ownStore.page.locator("#keys-platform-note").count()).toBe(0);
    await ownStore.page.close();

    const browserPage = await open({ ai: ai({ secretProtection: "os-keychain" }) }, { platformOnly: "darwin" });
    await expect.poll(() => keysText(browserPage.page)).toContain("encrypted with your system keychain");
    expect(await browserPage.page.locator("#keys-platform-note").count()).toBe(0);
    await browserPage.page.close();
  });
});

describe("Settings → AI model: no listing of models just because Settings opened", () => {
  it("lists nothing on load when a key is saved, shows the saved model and a hint, and lists on Refresh", async () => {
    const o = await open({ ai: KEYED() });
    const { page } = o;
    const select = page.getByLabel("Model", { exact: true });
    await select.waitFor();
    await page.waitForTimeout(700);
    expect(modelCalls(o)).toHaveLength(0);
    expect(await select.inputValue()).toBe("claude-saved-1");
    expect(await page.locator("#ai-model option").allTextContents()).toEqual(["claude-saved-1", "Other…"]);
    expect(await page.locator("#ai-models-msg").innerText()).toBe("Choose Refresh to list the models your key can use.");
    expect(await page.locator("#ai-models-msg").getAttribute("class")).toBe("field-hint");

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => modelCalls(o).length).toBe(1);
    await expect.poll(() => page.locator("#ai-model option").allTextContents()).toEqual(["claude-saved-1", "claude-new-2 — newest", "Other…"]);
    expect(await page.locator("#ai-models-msg").innerText()).toBe("2 models on this server.");
    expect(modelCalls(o)).toHaveLength(1);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("lists on load when there is no saved key (a local provider), and again on a provider change and after Save", async () => {
    const o = await open({ ai: ai() });
    const { page } = o;
    await expect.poll(() => modelCalls(o).length).toBe(1);
    await page.locator("#ai-provider").selectOption("lmstudio");
    await expect.poll(() => modelCalls(o).length).toBe(2);

    // With a key saved, a provider change and Save list too (the user asked for them).
    const keyed = await open({ ai: KEYED() });
    await keyed.page.locator("#ai-model").waitFor();
    await keyed.page.waitForTimeout(600);
    expect(modelCalls(keyed)).toHaveLength(0);
    await keyed.page.locator("#ai-card").getByRole("button", { name: "Save" }).click();
    await expect.poll(() => keyed.calls.some((c) => c.method === "PUT" && c.path === "/api/ai")).toBe(true);
    await expect.poll(() => modelCalls(keyed).length).toBe(1);
    await keyed.page.locator("#ai-provider").selectOption("openai");
    await expect.poll(() => modelCalls(keyed).length).toBe(2);
    expect(o.errors).toEqual([]);
    expect(keyed.errors).toEqual([]);
    await page.close();
    await keyed.page.close();
  });

  it("says nothing about Refresh when the model is set by the environment (Refresh is off)", async () => {
    const o = await open({ ai: KEYED({ sources: { ...ai().sources, apiKey: "file", model: "env" } }) });
    await o.page.locator("#ai-model").waitFor();
    await o.page.waitForTimeout(600);
    expect(modelCalls(o)).toHaveLength(0);
    expect(await o.page.locator("#ai-models-msg").innerText()).toBe("");
    expect(await o.page.getByRole("button", { name: "Refresh" }).isDisabled()).toBe(true);
    await o.page.close();
  });
});

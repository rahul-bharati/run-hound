/**
 * The routes only the desktop app has (docs/onboarding-spec.md): GET/POST /api/onboarding and POST /api/data/delete,
 * mounted by createDesktopApp and nowhere else; and the helper model in the Settings API.
 *
 * Contract these tests pin down (interpretations marked *):
 * - createApp (the command line's `serve`, the Docker image) has none of these routes: 404.
 * - GET /api/onboarding → { show: true } when the settings folder has no current onboarding.json and the AI settings are
 *   not usable yet; { show: false } otherwise. Settings the command line import brought that are already usable write
 *   the marker with outcome "imported". * Settings from the environment count as usable and are not recorded.
 * - POST /api/onboarding { outcome: "configured" | "skipped" } writes { version, completedAt, outcome }; anything else
 *   is 400. A marker of an older version shows onboarding again.
 * - POST /api/data/delete { includeRuns } deletes only the files Run Hound saves in the settings folder (and leftover
 *   temp files of theirs), the finished report folders only when asked, and nothing in the command line's folder. It
 *   refuses (409) when the settings folder is the command line's.
 * - Both sit behind the guards of /api/ai: X-Run-Hound, Sec-Fetch-Site, Origin, JSON only.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../support/fake-llm.js";
import { resolveAiConfig, saveAiConfig } from "../../../src/ai/config.js";
import type { AiModelList, AiStatus } from "../../../src/ai/types.js";
import { saveAccounts } from "../../../src/operations/accounts-storage.js";
import { readOnboarding } from "../../../src/operations/onboarding-storage.js";
import { DATA_FILES } from "../../../src/operations/data-delete.js";
import { importCliSettingsOnce } from "../../../src/operations/settings-import.js";
import { readSecrets, writeSecrets } from "../../../src/operations/secret-store.js";
import { createApp } from "../../../src/server/app.js";
import { commandLineConfigDir, createDesktopApp } from "../../../src/server/desktop-app.js";
import { RunsModel } from "../../../src/server/models/runs.js";
import { forgetFinishedRuns } from "../../../src/server/models/runs.js";

const RH = { "x-run-hound": "1" };
const KEY = "desktop-test-key-6d5c4b3a2f1e0987";

let tmp: string;
let desktopDir: string;
let cliDir: string;
let runsDir: string;
let saved: NodeJS.ProcessEnv;
let app: Hono;
let fake: FakeLlm;

beforeAll(async () => {
  fake = await startFakeLlm({ models: [{ id: "alpha:1b", capabilities: ["completion"] }, { id: "embed-model", capabilities: ["embedding"] }] });
});
afterAll(async () => {
  await fake?.close();
});

beforeEach(async () => {
  saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_AI") || k.startsWith("RUNHOUND_ACCOUNT")) delete process.env[k];
  tmp = await mkdtemp(join(tmpdir(), "rh-desktop-"));
  desktopDir = join(tmp, "desktop");
  cliDir = join(tmp, "cli");
  runsDir = join(tmp, "runs");
  // The desktop's main process points the engine at its own settings folder before the engine loads.
  process.env.RUNHOUND_CONFIG_DIR = desktopDir;
  app = createDesktopApp({ canShowBrowser: false, runsDir, cliConfigDir: cliDir });
});
afterEach(async () => {
  await resolveAiConfig(); // drops the redaction a test registered
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await rm(tmp, { recursive: true, force: true });
});

function send(method: string, path: string, body: unknown = {}, headers: Record<string, string> = RH, target: Hono = app) {
  return target.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const get = (path: string, headers: Record<string, string> = RH, target: Hono = app) => target.request(path, { headers });
const exists = (path: string) => stat(path).then(() => true, () => false);

describe("the desktop-only routes", () => {
  it("do not exist in the app the command line and Docker use", async () => {
    const plain = createApp({ canShowBrowser: false, runsDir });
    expect((await get("/api/onboarding", RH, plain)).status).toBe(404);
    expect((await send("POST", "/api/onboarding", { outcome: "skipped" }, RH, plain)).status).toBe(404);
    expect((await send("POST", "/api/data/delete", { includeRuns: false }, RH, plain)).status).toBe(404);
  });

  it("answer behind the same guards as /api/ai", async () => {
    for (const [method, path, body] of [["GET", "/api/onboarding", undefined], ["POST", "/api/onboarding", { outcome: "skipped" }], ["POST", "/api/data/delete", { includeRuns: false }]] as const) {
      const call = (headers: Record<string, string>) => app.request(path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
      expect((await call({})).status, `${method} ${path} without X-Run-Hound`).toBe(403);
      expect((await call({ ...RH, "sec-fetch-site": "cross-site" })).status, `${method} ${path} cross-site`).toBe(403);
      expect((await call({ ...RH, "sec-fetch-site": "same-site" })).status, `${method} ${path} same-site`).toBe(403);
      if (method === "POST") {
        expect((await call({ ...RH, origin: "https://evil.example" })).status, `${method} ${path} from another origin`).toBe(403);
        expect((await app.request(path, { method, headers: { ...RH, "content-type": "text/plain" }, body: JSON.stringify(body) })).status, `${method} ${path} as text/plain`).toBe(415);
      }
    }
    // Nothing the refused calls asked for happened.
    expect(await readOnboarding(desktopDir)).toBeNull();
  });
});

describe("GET /api/onboarding", () => {
  it("shows on a first launch: no marker and nothing usable set up", async () => {
    const res = await get("/api/onboarding");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ show: true });
  });

  it("does not show again after Skip or Done, and the marker says how it ended", async () => {
    const now = Date.now();
    const posted = await send("POST", "/api/onboarding", { outcome: "skipped" });
    expect(posted.status).toBe(200);
    const marker = (await posted.json()) as { version: number; completedAt: string; outcome: string };
    expect(marker).toMatchObject({ version: 1, outcome: "skipped" });
    expect(Math.abs(Date.parse(marker.completedAt) - now)).toBeLessThan(60_000);
    expect(JSON.parse(await readFile(join(desktopDir, "onboarding.json"), "utf8"))).toEqual(marker);
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: false });

    await send("POST", "/api/onboarding", { outcome: "configured" });
    expect((await readOnboarding(desktopDir))?.outcome).toBe("configured");
  });

  it("shows again for a marker of an older version, or one that is not a marker", async () => {
    await mkdir(desktopDir, { recursive: true });
    await writeFile(join(desktopDir, "onboarding.json"), JSON.stringify({ version: 0, completedAt: new Date().toISOString(), outcome: "skipped" }));
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: true });
    await writeFile(join(desktopDir, "onboarding.json"), "not json");
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: true });
    await writeFile(join(desktopDir, "onboarding.json"), JSON.stringify({ version: 1, completedAt: "now", outcome: "mystery" }));
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: true });
  });

  it("does not show, and records 'imported', when the command line's settings came over usable", async () => {
    // The command line saved a provider with a key; the desktop's start-up import brings both across.
    const cliEnv = { RUNHOUND_CONFIG_DIR: cliDir };
    await saveAiConfig({ enabled: true, provider: "anthropic", model: "claude-opus-5-5", allowRemote: true, apiKey: KEY }, { env: cliEnv });
    const imported = await importCliSettingsOnce(cliDir, desktopDir);
    expect(imported?.files).toContain("ai.json");
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: false });
    expect(await readOnboarding(desktopDir)).toMatchObject({ version: 1, outcome: "imported" });
  });

  it("shows when an imported provider still needs a key", async () => {
    await saveAiConfig({ enabled: false, provider: "openai", model: "gpt-6-sol" }, { env: { RUNHOUND_CONFIG_DIR: cliDir } });
    await importCliSettingsOnce(cliDir, desktopDir);
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: true });
    expect(await readOnboarding(desktopDir)).toBeNull();
  });

  it("does not show for settings that only the environment makes usable, and records nothing", async () => {
    process.env.RUNHOUND_AI_PROVIDER = "anthropic";
    process.env.RUNHOUND_AI_API_KEY = KEY;
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: false });
    expect(await readOnboarding(desktopDir)).toBeNull();
  });

  it("does not show for a local provider, which needs no key", async () => {
    await saveAiConfig({ provider: "ollama", baseUrl: fake.baseUrl, model: "alpha:1b" });
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: false });
  });
});

describe("POST /api/onboarding", () => {
  it("accepts only configured and skipped", async () => {
    for (const body of [{ outcome: "imported" }, { outcome: "done" }, { outcome: 1 }, {}, [], "skipped"]) {
      const res = await send("POST", "/api/onboarding", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await app.request("/api/onboarding", { method: "POST", headers: { "content-type": "application/json", ...RH }, body: "{oops" })).status).toBe(400);
    expect(await readOnboarding(desktopDir)).toBeNull();
  });
});

describe("POST /api/data/delete", () => {
  /** Puts a recognisable file under each name Run Hound saves in a settings folder, plus one that is not Run Hound's. */
  async function populate(dir: string) {
    await mkdir(dir, { recursive: true });
    for (const name of DATA_FILES) await writeFile(join(dir, name), `${name} of ${dir}`);
    await writeFile(join(dir, ".ai.json.1234.abcdef012345.tmp"), "leftover");
    await writeFile(join(dir, "notes.txt"), "not Run Hound's");
    await mkdir(join(dir, "subfolder"));
    await writeFile(join(dir, "subfolder", "keep.txt"), "kept");
  }
  const names = async (dir: string) => (await readdir(dir)).sort();

  async function addRuns() {
    for (const id of ["20261017-run-a", "20261017-run-b"]) {
      await mkdir(join(runsDir, id, "evidence"), { recursive: true });
      await writeFile(join(runsDir, id, "report.json"), "{}");
      await writeFile(join(runsDir, id, "evidence", "shot.png"), "png");
    }
    await mkdir(join(runsDir, "20261017-unfinished"), { recursive: true });
    await writeFile(join(runsDir, "20261017-unfinished", "progress.txt"), "still running");
    await writeFile(join(runsDir, "stray.txt"), "not a run");
  }

  it("deletes the files Run Hound saved and nothing else, keeps the reports and leaves the command line's folder alone", async () => {
    await populate(desktopDir);
    await populate(cliDir);
    await addRuns();
    const cliBefore = await names(cliDir);

    const res = await send("POST", "/api/data/delete", { includeRuns: false });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { files: string[]; runs: number };
    expect(result.files.sort()).toEqual([...DATA_FILES, ".ai.json.1234.abcdef012345.tmp"].sort());
    expect(result.runs).toBe(0);

    expect(await names(desktopDir)).toEqual(["notes.txt", "subfolder"]);
    expect(await readFile(join(desktopDir, "subfolder", "keep.txt"), "utf8")).toBe("kept");
    expect(await names(cliDir)).toEqual(cliBefore);
    expect(await readFile(join(cliDir, "ai.json"), "utf8")).toBe(`ai.json of ${cliDir}`);
    expect((await readdir(runsDir)).sort()).toEqual(["20261017-run-a", "20261017-run-b", "20261017-unfinished", "stray.txt"]);
  });

  it("deletes the finished reports too when asked, and only those", async () => {
    await populate(desktopDir);
    await addRuns();
    const res = await send("POST", "/api/data/delete", { includeRuns: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { runs: number }).runs).toBe(2);
    expect((await readdir(runsDir)).sort()).toEqual(["20261017-unfinished", "stray.txt"]);
    expect(await exists(join(desktopDir, "notes.txt"))).toBe(true);
  });

  it("removes saved keys and passwords for good: the store opens nothing afterwards", async () => {
    await saveAiConfig({ provider: "anthropic", model: "claude-opus-5-5", allowRemote: true, apiKey: KEY });
    await saveAccounts({ accounts: { a: { label: "A", loginUrl: "http://127.0.0.1/login", username: "alice", password: "pw-correct-horse-battery" } } });
    expect(Object.keys((await readSecrets(desktopDir)).values).length).toBeGreaterThan(1);
    await send("POST", "/api/onboarding", { outcome: "configured" });

    expect((await send("POST", "/api/data/delete", { includeRuns: false })).status).toBe(200);
    expect(await readdir(desktopDir)).toEqual([]);
    expect((await readSecrets(desktopDir)).values).toEqual({});
    const status = (await (await get("/api/ai")).json()) as AiStatus;
    expect(status).toMatchObject({ provider: null, hasKey: false, savedKeys: [] });
    expect(await (await get("/api/onboarding")).json()).toEqual({ show: true });
    // A store started again works: the forgotten key is not mixed into it.
    await writeSecrets(desktopDir, { "ai.key.openai": "new-key-0123456789abcdef" });
    expect((await readSecrets(desktopDir)).values).toEqual({ "ai.key.openai": "new-key-0123456789abcdef" });
  });

  it("tells the secret store to forget the settings folder's key once the files are gone, and never before", async () => {
    const forgotten: { dir: string; keyFileThere: boolean }[] = [];
    const watched = createDesktopApp({
      canShowBrowser: false,
      runsDir,
      cliConfigDir: cliDir,
      forgetStoreKey: (dir) => forgotten.push({ dir, keyFileThere: existsSync(join(dir, "secrets.key")) }),
    });
    await populate(desktopDir);
    expect((await send("POST", "/api/data/delete", { includeRuns: false }, RH, watched)).status).toBe(200);
    expect(forgotten).toEqual([{ dir: desktopDir, keyFileThere: false }]);
    // A refusal deletes nothing and forgets nothing.
    const shared = createDesktopApp({ canShowBrowser: false, runsDir, cliConfigDir: desktopDir, forgetStoreKey: (dir) => forgotten.push({ dir, keyFileThere: false }) });
    expect((await send("POST", "/api/data/delete", {}, RH, shared)).status).toBe(409);
    expect(forgotten).toHaveLength(1);
  });

  it("works on a folder that has nothing in it", async () => {
    const res = await send("POST", "/api/data/delete", { includeRuns: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [], runs: 0 });
  });

  it("treats a missing includeRuns as no, and refuses a value that is not true or false", async () => {
    await addRuns();
    expect((await send("POST", "/api/data/delete", {})).status).toBe(200);
    expect((await readdir(runsDir)).length).toBe(4);
    expect((await send("POST", "/api/data/delete", { includeRuns: "yes" })).status).toBe(400);
    expect((await send("POST", "/api/data/delete", [])).status).toBe(200);
    expect((await readdir(runsDir)).length).toBe(4);
  });

  it("refuses, deleting nothing, when the settings folder is the command line's folder", async () => {
    const shared = createDesktopApp({ canShowBrowser: false, runsDir, cliConfigDir: desktopDir });
    await populate(desktopDir);
    const before = await names(desktopDir);
    const res = await send("POST", "/api/data/delete", { includeRuns: false }, RH, shared);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/command line/);
    expect(await names(desktopDir)).toEqual(before);
  });

  it("finds the command line's folder without RUNHOUND_CONFIG_DIR, which names the desktop's own", () => {
    expect(commandLineConfigDir({ RUNHOUND_CONFIG_DIR: "/somewhere/desktop", XDG_CONFIG_HOME: "/xdg" }, "/home/me").replace(/\\/g, "/")).toBe("/xdg/run-hound");
    expect(commandLineConfigDir({ RUNHOUND_CONFIG_DIR: "/somewhere/desktop" }, "/home/me").replace(/\\/g, "/")).toBe("/home/me/.config/run-hound");
    expect(commandLineConfigDir({}, "/home/me").replace(/\\/g, "/")).toBe("/home/me/.config/run-hound");
  });

  it("makes the runs list forget the finished runs it deleted, and keeps a run in progress", () => {
    const model = new RunsModel({ runsDir, maxConcurrentRuns: 2 });
    model.runs.set("done-1", { status: "done" } as never);
    model.runs.set("error-1", { status: "error" } as never);
    model.runs.set("live-1", { status: "running" } as never);
    forgetFinishedRuns(join(tmp, "elsewhere"));
    expect([...model.runs.keys()]).toEqual(["done-1", "error-1", "live-1"]);
    forgetFinishedRuns(runsDir);
    expect([...model.runs.keys()]).toEqual(["live-1"]);
  });
});

describe("the helper model in the Settings API", () => {
  it("is saved with PUT /api/ai and shown by GET /api/ai and GET /api/settings; an empty value clears it", async () => {
    const put = await send("PUT", "/api/ai", { enabled: true, provider: "ollama", baseUrl: fake.baseUrl, model: "alpha:1b", helperModel: "embed-model" });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ model: "alpha:1b", helperModel: "embed-model" });
    expect(await (await get("/api/ai")).json()).toMatchObject({ model: "alpha:1b", helperModel: "embed-model", sources: { helperModel: "file" } });
    expect(((await (await get("/api/settings")).json()) as { ai: AiStatus }).ai.helperModel).toBe("embed-model");

    expect(((await (await send("PUT", "/api/ai", { helperModel: "" })).json()) as AiStatus).helperModel).toBe("");
    expect((await send("PUT", "/api/ai", { helperModel: 3 })).status).toBe(400);
    process.env.RUNHOUND_AI_HELPER_MODEL = "from-env";
    const locked = await send("PUT", "/api/ai", { helperModel: "other" });
    expect(locked.status).toBe(400);
    expect(((await locked.json()) as { error: string }).error).toMatch(/RUNHOUND_AI_HELPER_MODEL/);
  });

  it("is listed with the recommended pair: GET /api/ai/models names the model to start each select on", async () => {
    await saveAiConfig({ provider: "ollama", baseUrl: fake.baseUrl, model: "alpha:1b" });
    const list = (await (await get("/api/ai/models")).json()) as AiModelList;
    expect(list.models.map((m) => m.id)).toEqual(["alpha:1b", "embed-model"]);
    // The embedding model can't generate text, so the first usable model is both.
    expect(list.recommended).toEqual({ main: "alpha:1b", helper: "alpha:1b" });
  });
});

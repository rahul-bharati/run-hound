/**
 * Evidence never carries a registered secret (0.4.0, docs/v2-spec.md "Test accounts"): file names are made from the
 * redacted label, and labels are redacted, for frames, cards, screenshots and recordings.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { createCheckContext, type RunningCheckContext } from "./context.js";
import { emptyForm } from "./discover.js";
import { registerSecretLiterals } from "./redact.js";

const PASSWORD = "alice-pass-1234";

let server: FixtureServer;
let dir: string;
let ctx: RunningCheckContext;
let unregister: () => void;

beforeAll(async () => {
  server = await startFixtureServer({ pages: { "/": "<!doctype html><title>Page</title><h1>Hello</h1>" } });
});
afterAll(async () => {
  await server?.close();
  await closeBrowser();
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rh-context-secrets-"));
  unregister = registerSecretLiterals([PASSWORD]);
  ctx = createCheckContext({ browser: await getBrowser(), form: emptyForm(`${server.url}/`), targetUrl: `${server.url}/`, artifactsDir: dir, runToken: "t3st" });
});
afterEach(async () => {
  unregister();
  await ctx.dispose();
  await rm(dir, { recursive: true, force: true });
});

describe("evidence labels and file names", () => {
  it("never name a file after a registered secret", async () => {
    const { page } = await ctx.openPage();
    const evidence = [
      await ctx.capture(page, `Frame ${PASSWORD}`),
      await ctx.captureCard(`Card ${PASSWORD}`, { title: "t", lines: [{ text: "x" }] }),
      await ctx.screenshot(page, `Shot ${PASSWORD}`),
    ];
    const recording = ctx.record(page, `Gif ${PASSWORD}`);
    await recording.step("one");
    evidence.push(await recording.finish());

    for (const e of evidence) {
      expect(e.label).not.toContain(PASSWORD);
      expect(e.label).toContain("[REDACTED:account-secret]");
      expect(e.path).not.toContain(PASSWORD);
      expect(e.path).not.toContain("alice");
    }
    const files = await readdir(dir);
    expect(files).toHaveLength(4);
    for (const name of files) expect(name).not.toContain("pass-1234");
  });
});

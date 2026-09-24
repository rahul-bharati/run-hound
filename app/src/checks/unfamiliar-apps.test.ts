/**
 * Checks on apps Run Hound was never tuned for (docs/v0-spec.md, "Tester release (0.1.0)" > "Unfamiliar apps"), using
 * the well-built samples in fixtures/samples/: a classic form post that redirects, a sign-in form and a form whose
 * API is on another origin. Every sample is correct, so a check must pass, or skip with a plain reason; it must never
 * report a finding or error.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Check, CheckResult } from "../core/types.js";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { startSample, type Sample, type SampleName } from "../../test-support/samples.js";
import { check as axeStates } from "./axe-states.js";
import { check as clientOnlyValidation } from "./client-only-validation.js";
import { check as consoleNetworkErrors } from "./console-network-errors.js";
import { check as doubleSubmit } from "./double-submit.js";
import { check as errorAnnouncement } from "./error-announcement.js";
import { check as keyboardCompletion } from "./keyboard-completion.js";
import { PAGE_POST_NOTE, SIGN_IN_NOTE } from "./lib/functional-form.js";
import { check as persistence } from "./persistence.js";
import { check as piiLeak } from "./pii-leak.js";
import { check as silentFailure } from "./silent-failure.js";
import { check as verboseErrors } from "./verbose-errors.js";

const samples = new Map<SampleName, Sample>();

beforeAll(async () => {
  for (const name of ["classic-post", "login", "cross-origin-api"] as const) samples.set(name, await startSample(name));
}, 60_000);

afterAll(async () => {
  await Promise.all([...samples.values()].map((s) => s.stop()));
  await closeBrowser();
});

async function run(check: Check, name: SampleName): Promise<CheckResult> {
  const { results } = await runCheck(check, samples.get(name)!.url);
  expect(results).toHaveLength(1);
  const result = results[0]!;
  // Whatever happened, a well-built app gets no finding, and nothing breaks.
  expect(result.findings.map((f) => f.title), `${check.id} findings on ${name}`).toEqual([]);
  expect(result.status, `${check.id} on ${name}: ${result.notes}`).not.toBe("error");
  return result;
}

describe("classic form post that answers 303 and redirects to a thank-you page", () => {
  it("persistence counts the redirect as saved and finds every value on the page it leads to", async () => {
    const r = await run(persistence, "classic-post");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/\/signup\/thanks\//);
  });

  it("keyboard-completion counts the 303 as a completed submit", async () => {
    const r = await run(keyboardCompletion, "classic-post");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/submit status 303/);
  });

  it("axe-states scans the thank-you page after two submissions and skips the simulated server error with a reason", async () => {
    const r = await run(axeStates, "classic-post");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/success/);
    expect(r.notes).toMatch(/server error state not scanned: the form is sent as a regular page post/);
  });

  it("silent-failure and client-only-validation skip, saying the form is a regular page post", async () => {
    for (const check of [silentFailure, clientOnlyValidation]) {
      const r = await run(check, "classic-post");
      expect(r.status, check.id).toBe("skipped");
      expect(r.notes, check.id).toBe(PAGE_POST_NOTE);
    }
  });
});

describe("sign-in form that refuses made-up credentials with 401", () => {
  it("console-network-errors does not count the refused sign-in (401 and its console line) as an error", async () => {
    const r = await run(consoleNetworkErrors, "login");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/sign-in was refused \(401\)/);
  });

  it("keyboard-completion takes the 401 as proof the form was sent", async () => {
    const r = await run(keyboardCompletion, "login");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/401 \(a sign-in form/);
  });

  it("persistence and double-submit are planned as skipped and skip with a plain reason", async () => {
    const p = await runCheck(persistence, samples.get("login")!.url);
    expect(p.scenarios[0]!.description).toMatch(/Will be skipped: .* sign-in form/);
    expect(p.results[0]!.status).toBe("skipped");
    expect(p.results[0]!.notes).toBe(SIGN_IN_NOTE);
    const d = await run(doubleSubmit, "login");
    expect(d.status).toBe("skipped");
    expect(d.notes).toMatch(/sign-in form/);
  });

  it("verbose-errors reads the replayed request's answer even though the page never reads error bodies", async () => {
    const r = await run(verboseErrors, "login");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/Checked [1-9]\d* responses/);
  });
});

describe("form whose API is on another origin (another port, with CORS)", () => {
  it("persistence, keyboard-completion and double-submit recognise the save request on the other origin", async () => {
    expect((await run(persistence, "cross-origin-api")).status).toBe("pass");
    expect((await run(keyboardCompletion, "cross-origin-api")).notes).toMatch(/submit status 201/);
    expect((await run(doubleSubmit, "cross-origin-api")).notes).toMatch(/POST \/api\/rsvps/);
  });

  it("pii-leak does not treat the app's own API as a third party", async () => {
    const r = await run(piiLeak, "cross-origin-api");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/its own API at localhost:\d+, which is not counted as a third party/);
  });

  it("silent-failure simulates the 500 on the other origin (with CORS) and finds the announced error", async () => {
    const r = await run(silentFailure, "cross-origin-api");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/Error announced/);
  });

  it("client-only-validation captures and replays the save request to the other origin", async () => {
    const r = await run(clientOnlyValidation, "cross-origin-api");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/Server answered 400/);
  });

  it("error-announcement leaves out a required field that already holds a valid default", async () => {
    const r = await run(errorAnnouncement, "cross-origin-api");
    expect(r.status).toBe("pass");
    expect(r.notes).toMatch(/left out "Number of people, including you", which already had a value/);
  });
});

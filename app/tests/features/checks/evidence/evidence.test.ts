/**
 * Evidence contract for every check (docs/v0-spec.md, "Evidence" and "Required evidence per check").
 * Each test reuses the BAD fixture from that check's own test file and asserts that the finding carries
 * credible evidence: an annotated frame, card or GIF on disk, with the URL, capture time, the highlighted
 * element and the facts behind the finding, and no secret in any evidence text.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Finding } from "../core/types.js";
import { closeBrowser, overallStatus } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import { startBookingApp, type ApiOptions, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import * as axeFixtures from "../../test/fixtures/checks/axe-states/variants.js";
import * as bundleFixtures from "../../test/fixtures/checks/bundle-secrets/variants.js";
import * as credentialFixtures from "../../test/fixtures/checks/credential-fields/variants.js";
import * as errorFixtures from "../../test/fixtures/checks/error-announcement/variants.js";
import * as focusFixtures from "../../test/fixtures/checks/focus-visible/variants.js";
import * as keyboardFixtures from "../../test/fixtures/checks/keyboard-completion/variants.js";
import * as piiFixtures from "../../test/fixtures/checks/pii-leak/variants.js";
import * as reflowFixtures from "../../test/fixtures/checks/reflow-320/variants.js";
import {
  DEAD_CONTROL_BUTTONS,
  DEAD_CONTROL_HANDLERS,
  HELP_PAGE,
  allHighlights,
  evidenceOfKind,
  expectCredibleEvidence,
  expectFact,
  expectHighlight,
  expectKinds,
  expectNoSecretsInEvidence,
  runCheckKeepingArtifacts,
  type KeptRun,
} from "../../test/fixtures/checks/evidence/support.js";
import { check as axeStates } from "./axe-states.js";
import { check as bundleSecrets } from "./bundle-secrets.js";
import { check as clientOnlyValidation } from "./client-only-validation.js";
import { check as consoleNetworkErrors } from "./console-network-errors.js";
import { check as credentialFields } from "./credential-fields.js";
import { check as deadControl } from "./dead-control.js";
import { check as doubleSubmit } from "./double-submit.js";
import { check as errorAnnouncement } from "./error-announcement.js";
import { check as focusVisible } from "./focus-visible.js";
import { check as keyboardCompletion } from "./keyboard-completion.js";
import { check as persistence } from "./persistence.js";
import { check as piiLeak } from "./pii-leak.js";
import { check as reflow320 } from "./reflow-320.js";
import { check as silentFailure } from "./silent-failure.js";
import { check as verboseErrors } from "./verbose-errors.js";
import type { Check } from "../core/types.js";

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

/** Serves a booking-page.ts variant (the accessibility/security check fixtures) and returns its /book URL. */
async function servePage(variant: BookingVariant): Promise<{ url: string; origin: string }> {
  const server = await startFixtureServer(bookingApp(variant).options);
  servers.push(server);
  return { url: `${server.url}/book`, origin: server.url };
}

/** Serves a _behavior/booking-app.ts variant (the behaviour check fixtures) and returns its /book URL. */
async function serveBehavior(
  client: ClientOptions = {},
  api: ApiOptions = {},
  extra: Parameters<typeof startBookingApp>[2] = {},
): Promise<{ url: string; origin: string }> {
  const app = await startBookingApp(client, api, extra);
  servers.push(app.server);
  return { url: app.url, origin: app.server.url };
}

/**
 * Runs the check on a BAD fixture and checks what every finding must have (a failing result, at least one
 * finding, credible visual evidence, no secrets), then hands the findings to `more` for the per-check table row.
 */
async function expectEvidence(
  check: Check,
  target: { url: string; origin: string },
  more: (findings: Finding[], run: KeptRun) => void,
  planted: string[] = [],
) {
  await runCheckKeepingArtifacts(check, target.url, (run) => {
    const detail = JSON.stringify(run.results.map((r) => ({ status: r.status, notes: r.notes })));
    expect(overallStatus(run.results), detail).toBe("fail");
    expect(run.findings.length).toBeGreaterThan(0);
    for (const f of run.findings) expectCredibleEvidence(f, run.artifactsDir, target.origin);
    expectNoSecretsInEvidence(run.findings, planted);
    more(run.findings, run);
  });
}

/** Every fact whose label matches has a value that says "nothing": 0, none or no. */
function expectZeroFact(f: Finding, keyword: RegExp) {
  const fact = expectFact(f, keyword);
  expect(fact.value, `${f.id}: "${fact.label}" should be 0`).toMatch(/^\s*(0\b|none\b|no\b)/i);
}

function factsText(f: Finding): string {
  return f.evidence.flatMap((e) => e.facts ?? []).map((x) => `${x.label}: ${x.value}`).join("\n");
}

describe("evidence: behaviour checks", () => {
  it("console-network-errors (F05): card of the errors, frame of the page, error counts as facts", async () => {
    await expectEvidence(consoleNetworkErrors, await serveBehavior({ availabilityUrl: "undefined/api/availability" }), (findings) => {
      for (const f of findings) {
        expectKinds(f, ["card", "frame"]);
        expectFact(f, /console/i);
        expectFact(f, /page error/i);
        expectFact(f, /request/i);
        // The card shows the failing request, and when it failed.
        expect(JSON.stringify(evidenceOfKind(f, "card"))).toContain("undefined/api/availability");
        expect(JSON.stringify(evidenceOfKind(f, "card"))).toMatch(/while loading|after submitting/);
        // The frame proves the form really was sent, and what the server answered.
        expect(expectFact(f, /form submitted/i).value).toMatch(/POST \/api\/bookings → 2\d\d/);
      }
    });
  });

  it("dead-control (F01): GIF before -> after the click, the control marked, all change counters at 0", async () => {
    const target = await serveBehavior({ extraHtml: DEAD_CONTROL_BUTTONS, extraScript: DEAD_CONTROL_HANDLERS }, {}, { pages: { "/help": HELP_PAGE } });
    await expectEvidence(deadControl, target, (findings) => {
      expect(findings).toHaveLength(1);
      const f = findings[0]!;
      expectKinds(f, ["gif"]);
      expect(evidenceOfKind(f, "gif")[0]!.frames).toBeGreaterThanOrEqual(2);
      expectHighlight(f, /nothing happened/i);
      expectZeroFact(f, /request/i);
      expectZeroFact(f, /dom/i);
      expectZeroFact(f, /storage/i);
      expectZeroFact(f, /focus|value/i);
    });
  });

  it("silent-failure (F02): GIF filled -> submit -> 5 s later, the form marked, injected status and wait as facts", async () => {
    await expectEvidence(silentFailure, await serveBehavior({ errorMode: "spinner" }), (findings) => {
      for (const f of findings) {
        expectKinds(f, ["gif"]);
        expect(evidenceOfKind(f, "gif")[0]!.frames).toBeGreaterThanOrEqual(3);
        expectHighlight(f, /no error shown/i);
        expect(expectFact(f, /status/i).value).toMatch(/5\d\d/);
        expect(expectFact(f, /wait/i).value).toMatch(/\d/);
        expectFact(f, /kept/i);
      }
    });
  });

  it("persistence (F03): GIF typed -> submitted -> after reload, the field then the list marked, canary facts", async () => {
    await expectEvidence(persistence, await serveBehavior({}, { dropFields: ["notes"] }), (findings) => {
      for (const f of findings) {
        expectKinds(f, ["gif"]);
        expect(evidenceOfKind(f, "gif")[0]!.frames).toBeGreaterThanOrEqual(3);
        // The typed field is context ("Typed …"), the empty list is the problem.
        const labels = allHighlights(f).map((h) => h.label).join("\n");
        expect(labels).toMatch(/typed/i);
        expectHighlight(f, /not found after reload/i);
        expect(expectFact(f, /canary/i).value).toContain("t3st");
        expect(expectFact(f, /field/i).value).toMatch(/special instructions|notes/i);
        expectFact(f, /search|where/i);
      }
    });
  });

  it("double-submit (F04): GIF of the double-click, card of the requests, each create request as a fact", async () => {
    await expectEvidence(doubleSubmit, await serveBehavior({ submitGuard: "none" }, { delayMs: 800 }), (findings) => {
      for (const f of findings) {
        expectKinds(f, ["gif", "card"]);
        expectHighlight(f, /clicked twice/i);
        const requestFacts = f.evidence.flatMap((e) => e.facts ?? []).filter((x) => /request/i.test(x.label));
        expect(requestFacts.length, factsText(f)).toBeGreaterThanOrEqual(2);
        const text = factsText(f);
        expect(text).toContain("POST");
        expect(text).toContain("/api/bookings");
        expect(text).toMatch(/\b201\b/);
        expect(text).toMatch(/\d+\s*ms/);
        expect(JSON.stringify(evidenceOfKind(f, "card"))).toContain("/api/bookings");
      }
    });
  });

  it("verbose-errors (S04): card of the response, frame with the on-page trace marked, status/request/pattern facts", async () => {
    await expectEvidence(verboseErrors, await serveBehavior({ showStack: true }, { stackOnBadInput: true }), (findings) => {
      for (const f of findings) {
        expectKinds(f, ["card", "frame"]);
        // The trace is visible on the page, so the frame marks it.
        const frame = evidenceOfKind(f, "frame").find((e) => (e.highlights ?? []).length > 0);
        expect(frame, `${f.id}: a frame with the trace highlighted`).toBeDefined();
        expect(expectFact(f, /status/i).value).toMatch(/500/);
        expectFact(f, /request/i);
        expectFact(f, /pattern|match/i);
        expect(JSON.stringify(evidenceOfKind(f, "card"))).toMatch(/validateBooking|\/srv\/kennel/);
        // The card also shows the request that triggered the error, so the input is on record.
        const card = JSON.stringify(evidenceOfKind(f, "card"));
        expect(card).toMatch(/POST http:\/\/[^"]*\/api\/bookings/);
        expect(card).toMatch(/Response 500/);
      }
    });
  });

  it("client-only-validation (F06): card of the replayed request and response, field/value/status facts", async () => {
    await expectEvidence(clientOnlyValidation, await serveBehavior({ dateOrderCheck: true }, { checkDateOrder: false }), (findings) => {
      for (const f of findings) {
        expectKinds(f, ["card"]);
        expect(expectFact(f, /field/i).value).toMatch(/end ?date/i);
        expectFact(f, /value|sent/i);
        expect(expectFact(f, /status|response/i).value).toMatch(/2\d\d/);
        expect(JSON.stringify(evidenceOfKind(f, "card"))).toContain("/api/bookings");
      }
    });
  });
});

describe("evidence: accessibility checks", () => {
  it("axe-states (A02): a frame for the rule, every violating node marked with the rule id, rule facts", async () => {
    await expectEvidence(axeStates, await servePage(axeFixtures.bad.namelessIconButton.variant), (findings) => {
      expect(findings).toHaveLength(1);
      const f = findings[0]!;
      expectKinds(f, ["frame"]);
      expectHighlight(f, /button-name/);
      expect(expectFact(f, /rule/i).value).toContain("button-name");
      expectFact(f, /impact/i);
      expectFact(f, /wcag/i);
      expectFact(f, /state/i);
      expect(expectFact(f, /node/i).value).toMatch(/\d/);
      expectFact(f, /summary|failure/i);
    });
  });

  it("axe-states (A08): several violating nodes are each marked, up to 10", async () => {
    await expectEvidence(axeStates, await servePage(axeFixtures.bad.smallTargets.variant), (findings) => {
      const f = findings[0]!;
      const marked = allHighlights(f).filter((h) => /target-size/.test(h.label));
      // Two packed remove buttons in the fixture.
      expect(marked.length).toBeGreaterThanOrEqual(2);
      expect(marked.length).toBeLessThanOrEqual(10 * Math.max(1, evidenceOfKind(f, "frame").length));
    });
  });

  it("keyboard-completion (A03): GIF of the Tab sequence, the picker marked as never reached", async () => {
    await expectEvidence(keyboardCompletion, await servePage(keyboardFixtures.clickableDivPicker), (findings) => {
      const f = findings.find((x) => /pet type/i.test(`${x.title} ${x.location ?? ""}`)) ?? findings[0]!;
      expectKinds(f, ["gif"]);
      expect(evidenceOfKind(f, "gif")[0]!.frames).toBeGreaterThanOrEqual(3);
      expectHighlight(f, /never reached by tab/i);
      expect(expectFact(f, /tab stop/i).value).toMatch(/\d|pet name|email/i);
      expect(expectFact(f, /not reached|never reached|unreached/i).value).toMatch(/pet type/i);
    });
  });

  it("focus-visible (A04): GIF of the Tab sequence and a frame per failing control, styles at rest vs focused", async () => {
    await expectEvidence(focusVisible, await servePage(focusFixtures.outlineRemoved), (findings) => {
      for (const f of findings) {
        expectKinds(f, ["gif", "frame"]);
        expectHighlight(f, /no visible focus/i);
        for (const property of [/outline/i, /box-shadow/i, /border/i, /background/i]) expectFact(f, property);
        // Pixel proof: the area around the control looks the same focused and blurred.
        expect(expectFact(f, /pixels that change on focus/i).value).toMatch(/^0 of \d+/);
      }
      // Pet name and Owner email both lose their outline: one frame per failing control.
      const frames = findings.flatMap((f) => evidenceOfKind(f, "frame"));
      expect(frames.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("error-announcement (A05): frame after the empty submit, each unannounced error marked, ARIA facts", async () => {
    await expectEvidence(errorAnnouncement, await servePage(errorFixtures.redTextOnly), (findings) => {
      for (const f of findings) {
        expectKinds(f, ["frame"]);
        expectHighlight(f, /not announced/i);
        expectFact(f, /aria-invalid/i);
        expectFact(f, /aria-describedby/i);
        expectFact(f, /live region/i);
      }
      // Pet name, Pet type and Owner email are all required and all unannounced.
      const marked = findings.flatMap((f) => allHighlights(f)).filter((h) => /not announced/i.test(h.label));
      expect(marked.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("credential-fields (A07): frame after the paste, the field marked, pasted vs value length", async () => {
    await expectEvidence(credentialFields, await servePage(credentialFixtures.pasteBlocked), (findings) => {
      expect(findings).toHaveLength(1);
      const f = findings[0]!;
      expectKinds(f, ["frame"]);
      expectHighlight(f, /paste blocked/i);
      expect(expectFact(f, /pasted/i).value).toMatch(/[1-9]/);
      expect(expectFact(f, /^(?!.*pasted).*value/i).value).toMatch(/^\s*0\b/);
      expectFact(f, /autocomplete/i);
    });
  });

  it("reflow-320 (A09): full-page frame at 320 px, the widest element marked with how much wider it is", async () => {
    await expectEvidence(reflow320, await servePage(reflowFixtures.fixedWidth), (findings) => {
      expect(findings).toHaveLength(1);
      const f = findings[0]!;
      expectKinds(f, ["frame"]);
      const frame = evidenceOfKind(f, "frame")[0]!;
      expect(frame.viewport?.width).toBe(320);
      expectHighlight(f, /\d+\s*px wider than the screen/i);
      // The numbers add up: the element's right edge is where the page's scroll width comes from.
      expect(expectFact(f, /right edge/i).value).toMatch(/\d+ px from the left \(\d+ px past the screen\)/);
      expect(expectFact(f, /viewport/i).value).toMatch(/\b320\b/);
      expect(expectFact(f, /scroll ?width/i).value).toMatch(/\b6\d\d\b/);
    });
  });
});

describe("evidence: security checks", () => {
  it("bundle-secrets (S01): card with the redacted excerpt, script/line/column/key type facts, no key anywhere", async () => {
    await expectEvidence(
      bundleSecrets,
      await servePage(bundleFixtures.llmKey),
      (findings) => {
        expect(findings).toHaveLength(1);
        const f = findings[0]!;
        expectKinds(f, ["card"]);
        expect(expectFact(f, /script/i).value).toContain("/assets/app-config.js");
        expect(expectFact(f, /line/i).value).toMatch(/\d/);
        expect(expectFact(f, /column/i).value).toMatch(/\d/);
        expectFact(f, /key type|type|kind/i);
        // The excerpt around the key is there, with the key itself redacted.
        expect(JSON.stringify(evidenceOfKind(f, "card"))).toMatch(/openaiApiKey/);
        expect(JSON.stringify(evidenceOfKind(f, "card"))).toMatch(/REDACTED|…/);
      },
      [bundleFixtures.FAKE_LLM_KEY],
    );
  });

  it("bundle-secrets (S02): the service_role JWT never appears in any evidence text", async () => {
    const [, payload, signature] = bundleFixtures.FAKE_SERVICE_ROLE_JWT.split(".");
    await expectEvidence(
      bundleSecrets,
      await servePage(bundleFixtures.serviceRoleJwt),
      (findings) => {
        const f = findings[0]!;
        expectKinds(f, ["card"]);
        expectFact(f, /key type|type|kind/i);
        const text = JSON.stringify(f.evidence);
        expect(text).not.toContain(payload);
        expect(text).not.toContain(signature);
        // Why it is an admin key, from the token's own (non-secret) claims.
        expect(expectFact(f, /role claim/i).value).toBe("service_role");
      },
      [bundleFixtures.FAKE_SERVICE_ROLE_JWT],
    );
  });

  it("pii-leak (S03): card of the third-party request, frame of the page at submit, origin/where/hashed facts", async () => {
    const analytics = await startFixtureServer({
      routes: {
        "GET /collect": (_req, res) => {
          res.writeHead(204);
          res.end();
        },
        "POST /collect": (_req, res) => {
          res.writeHead(204);
          res.end();
        },
      },
    });
    servers.push(analytics);
    await expectEvidence(piiLeak, await servePage(piiFixtures.emailInQuery(analytics.url)), (findings) => {
      expect(findings).toHaveLength(1);
      const f = findings[0]!;
      expectKinds(f, ["card", "frame"]);
      expect(expectFact(f, /origin|third.party/i).value).toContain(new URL(analytics.url).host);
      expect(expectFact(f, /where|appeared|found in/i).value).toMatch(/url|query|body/i);
      expect(expectFact(f, /hash/i).value).toMatch(/\b(no|yes|sha-?256|plain)\b/i);
      expect(JSON.stringify(evidenceOfKind(f, "card"))).toContain("/collect");
      // Query parameters read as in the real URL: "?" before the first, "&" before the rest.
      const lines = evidenceOfKind(f, "card").flatMap((e) => ((e.data as { lines?: string[] } | undefined)?.lines ?? []).map((l) => l.replace(/^>?\s*/, "")));
      expect(lines.filter((l) => l.startsWith("?"))).toHaveLength(1);
      expect(lines.some((l) => /^&email=/.test(l))).toBe(true);
    });
  });
});

describe("evidence: GOOD fixtures still produce zero findings", () => {
  async function expectCleanRun(check: Check, target: { url: string }) {
    await runCheckKeepingArtifacts(check, target.url, (run) => {
      const detail = JSON.stringify(run.results.map((r) => ({ status: r.status, notes: r.notes, findings: r.findings.map((f) => f.title) })));
      expect(overallStatus(run.results), detail).toBe("pass");
      expect(run.findings).toEqual([]);
    });
  }

  it("double-submit: Book disabled while pending", async () => {
    await expectCleanRun(doubleSubmit, await serveBehavior({ submitGuard: "disable" }, { delayMs: 800 }));
  });

  it("focus-visible: every control shows an outline", async () => {
    await expectCleanRun(focusVisible, await servePage(focusFixtures.good));
  });

  it("bundle-secrets: only publishable keys in the bundle", async () => {
    await expectCleanRun(bundleSecrets, await servePage(bundleFixtures.good));
  });
});

/**
 * Fake check library for test/cli-groups.test.ts: five passing scenarios across the three groups, listed out of
 * order on purpose. No page is opened. Each result reports a fixed duration.
 *   Accessibility: axe-states "axe:fake" (1200 ms), focus-visible "fv:fake" (2500 ms)
 *   Features: dead-control "dc:fake" (1500 ms), client-only-validation "cov:fake" (42000 ms)
 *   Security: bundle-secrets "bs:fake" (72000 ms)
 */
function fakeCheck(checkId, category, scenarioId, durationMs) {
  return {
    id: checkId,
    title: `Fake ${checkId}`,
    category,
    plan: () => [
      { id: scenarioId, checkId, title: `Fake ${scenarioId}`, description: "Fake scenario for group tests; creates nothing.", kind: "golden", priority: "medium", destructive: false, defaultSelected: true },
    ],
    run: async (_ctx, s) => {
      await new Promise((r) => setTimeout(r, 5));
      return { checkId, scenarioId: s.id, status: "pass", findings: [], durationMs };
    },
  };
}

export const checks = [
  fakeCheck("bundle-secrets", "security", "bs:fake", 72_000),
  fakeCheck("dead-control", "broken-feature", "dc:fake", 1_500),
  fakeCheck("focus-visible", "accessibility", "fv:fake", 2_500),
  fakeCheck("client-only-validation", "validation", "cov:fake", 42_000),
  fakeCheck("axe-states", "accessibility", "axe:fake", 1_200),
];

/**
 * Splits the lab's default spec set across CI shards so the three heavy specs (motion-contract-1.spec.mjs,
 * motion-contract-2.spec.mjs, release-gate.spec.mjs) don't land in the same job as each other; each gets a shard of
 * its own to anchor.
 *
 * specWeights are measured minutes from one full `pnpm lab` run (CI's old single site-lab job, node:test's per-file
 * and per-describe durations; see docs/decisions/09-2026.md#2026-09-29-ci-parallel-jobs, "CI splits into parallel
 * jobs, and the site lab into 4 shards, instead of two ~50-minute serial jobs"). motion-contract.spec.mjs (~23.6 min
 * on its own, CI's critical path) was split into motion-contract-1.spec.mjs and motion-contract-2.spec.mjs along its
 * numbered describe groups so the two halves weigh about the same; see
 * site/scripts/lab/specs/motion-contract-1.spec.mjs's header. specWeights only steer `--shard`; they don't change
 * what a local `pnpm lab` runs. A spec missing from this table -- a newly added one, almost always -- gets
 * DEFAULT_WEIGHT, so it still lands in some shard instead of silently being skipped by every one.
 */
export const DEFAULT_WEIGHT = 1;

export const specWeights = {
  "404-legal.spec.mjs": 0.6,
  "checks.spec.mjs": 0.15,
  "cross-browser.spec.mjs": 0.65,
  "design.spec.mjs": 0.05,
  "docs.spec.mjs": 2,
  "flat-a.spec.mjs": 0.25,
  "flat-b.spec.mjs": 1.6,
  "footer.spec.mjs": 1.1,
  "header.spec.mjs": 0.2,
  "home.spec.mjs": 1.6,
  "lab-helpers.spec.mjs": 0.15,
  "motion-contract-1.spec.mjs": 11.0,
  "motion-contract-2.spec.mjs": 12.5,
  "release-gate.spec.mjs": 13.7,
  "search.spec.mjs": 0.65,
};

/**
 * Greedy longest-first bin packing (LPT): sort specs by weight descending, then drop each one into whichever shard
 * is currently lightest. Not optimal bin packing, but deterministic (ties break alphabetically, so the same spec set
 * always splits the same way) and simple enough for a handful of specs across a handful of shards.
 *
 * Returns `shardCount` arrays of spec file names (each spec in exactly one), sorted for a stable, readable order.
 */
export function packShards(specs, shardCount) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`packShards: shardCount must be a positive integer, got ${shardCount}`);
  }
  const weighted = [...specs]
    .sort((a, b) => a.localeCompare(b))
    .map((spec) => ({ spec, weight: specWeights[spec] ?? DEFAULT_WEIGHT }))
    .sort((a, b) => b.weight - a.weight);
  const shards = Array.from({ length: shardCount }, () => ({ specs: [], total: 0 }));
  for (const { spec, weight } of weighted) {
    const lightest = shards.reduce((min, shard) => (shard.total < min.total ? shard : min));
    lightest.specs.push(spec);
    lightest.total += weight;
  }
  return shards.map((shard) => shard.specs.sort());
}

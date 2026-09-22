# Kennel accepted responses (golden files)

One file per mode: `clean.json`, plus `<BUGID>.json` for every V0 bug in `../bugs.json`.
The acceptance suite (`tests/acceptance`) starts Kennel with `KENNEL_BUGS=<mode>` (`none` for clean),
resets it, runs `discoverAndPlan(<kennel>/book)`, approves every scenario (`allowDestructive: false`),
runs `runPlan` and compares the report with the file. These files are written and reviewed by hand;
the suite never writes them.

## Schema

```jsonc
{
  "mode": "F01",                       // "clean" or the bug id; must match the file name
  "mustFail": ["dead-control"],        // checks that must end "fail" with >= 1 finding; always includes bugs.json detectedBy
  "mustPass": "all-others",            // or an explicit list of check ids; "all-others" = every CHECK_ID not in
                                       // mustFail or allowedSideEffects. These must end "pass" with 0 findings.
  "allowedSideEffects": [              // checks that MAY fail in this mode (pass is also fine; error/skipped never is)
    { "checkId": "axe-states", "reason": "why this bug can legitimately trip this check" }
  ],
  "expectedFindings": [                // each entry must be matched by at least one observed finding
    { "checkId": "dead-control", "severity": "high", "titleIncludes": "Save draft" }  // titleIncludes optional, case-insensitive
  ],
  "notes": "optional free text: side effects considered and rejected, open questions (ignored by the comparison)"
}
```

Validated by `tests/acceptance/src/golden.ts` (`validateGolden`): unknown keys, unknown check ids, duplicates,
a check in two lists, expected findings for checks that are not allowed to fail, or a `mustFail` check without an
expected finding are all errors. Side-effect reasons must actually justify the side effect.

## Comparison rules (`compareToGolden`)

A check's status is collapsed over its scenarios: `fail` > `error` > `pass` > `skipped`.

1. Every check in `CHECK_IDS` must have planned and run at least one scenario that was not skipped.
2. No scenario may end in `error`.
3. A failed result carries at least one finding; a passed result carries none.
4. `mustFail` checks fail with at least one finding.
5. `mustPass` checks pass with zero findings.
6. `allowedSideEffects` checks pass or fail.
7. Any finding from a check outside `mustFail` and `allowedSideEffects` is a mismatch.
8. Every `expectedFindings` entry matches some finding by `checkId`, `severity` and (if given) a case-insensitive
   `titleIncludes` substring. Extra findings from `mustFail` checks are fine (axe may report several rules).

Ignored: run ids, finding ids, timings, evidence, artifact paths, meaning/impact/fix text.

## Severity conventions these files assume

- The finding from the detecting check has the bug's severity from `bugs.json`.
- `axe-states` maps axe impact to severity as **critical -> high, serious -> medium, moderate -> low, minor -> low**
  (accessibility findings top out at high). This yields `button-name` (critical) -> high for A02, `label` (critical) -> high
  for A01, `color-contrast` and `target-size` (serious) -> medium for A06 and A08.
- `axe-states` finding titles include the axe rule's `help` text, e.g. "Buttons must have discernible text".

## Reviewing changes

`UPDATE_GOLDEN=1 pnpm --filter acceptance test` (or `pnpm --filter acceptance update-golden`) prints, per mode, a diff
between the golden file and a golden-shaped summary of what was observed. Nothing is written: edit the file by hand,
and give every new side effect a real reason. Narrow a run with `ACCEPTANCE_MODES=clean,F01`.

## Known gaps (to reconcile during integration)

- **A01**: axe-core 4.13's `label` rule accepts a non-empty placeholder as a label, so the WCAG A/AA tag set does not
  flag a placeholder-only input. `axe-states` needs an extra assertion (or Kennel a different bug shape) to catch it.
- **A08**: `target-size` has a spacing exception; Kennel must place the 16x16 remove buttons close together.
  The buttons exist only once a booking is listed, so `axe-states` must run on the success state.
- **S04**: `verbose-errors` submits oversized and malformed input; Kennel must produce the stack trace on that path.
- Titles are only pinned for `dead-control` (names the control) and `axe-states` (axe help text).

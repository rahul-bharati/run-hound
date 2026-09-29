// checkedAgainst (0.6.1, docs/launch-spec.md §7): a check page's and the checks hub's "Checked against release …"
// label must show the run data's own version and date, not site.version/site.released — the findings a check page
// shows come from the 0.6.0 Kennel/Fernway extracts, so the label must keep saying 0.6.0 even once site.version moves
// past it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkedAgainst, extracts } from "@/components/checks/run-evidence";

describe("checkedAgainst", () => {
  test("its version equals every extract's own runHoundVersion", () => {
    assert.ok(extracts.length >= 2, "at least the Kennel and Fernway extracts");
    for (const extract of extracts) assert.equal(checkedAgainst.version, extract.runHoundVersion, extract.app);
  });

  test("its date is the earliest run's startedAt, formatted like site.released", () => {
    const started = extracts.flatMap((e) => e.runs.map((r) => r.startedAt)).sort();
    const earliest = new Date(started[0]!);
    assert.equal(checkedAgainst.date, new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(earliest));
    // Sanity: it reads like site.released ("30 September 2026"), not an ISO string or a different locale's order.
    assert.match(checkedAgainst.date, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
  });
});

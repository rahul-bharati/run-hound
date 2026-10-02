import { describe, expect, it } from "vitest";
import { formatDuration, groupOf } from "./format.js";
import { CHECK_GROUPS, type Category } from "./types.js";

describe("groupOf", () => {
  it.each([
    ["accessibility", "accessibility"],
    ["broken-feature", "features"],
    ["validation", "features"],
    ["security", "security"],
  ] as const)("puts %s in %s", (category, group) => {
    expect(groupOf(category)).toBe(group);
  });

  it("agrees with CHECK_GROUPS for every category", () => {
    for (const g of CHECK_GROUPS) for (const c of g.categories) expect(groupOf(c as Category)).toBe(g.id);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0.0 s"],
    [400, "0.4 s"],
    [999, "0.9 s"],
    [1_000, "1.0 s"],
    [4_200, "4.2 s"],
    [9_849, "9.8 s"],
    [9_999, "9.9 s"],
    [10_000, "10 s"],
    [42_000, "42 s"],
    [42_999, "42 s"],
    [59_900, "59 s"],
    [59_999, "59 s"],
    [60_000, "1 min"],
    [72_000, "1 min 12 s"],
    [119_999, "1 min 59 s"],
    [180_000, "3 min"],
    [3_599_999, "59 min 59 s"],
    [3_600_000, "1 h"],
    [3_659_000, "1 h"],
    [3_780_000, "1 h 3 min"],
    [7_200_000, "2 h"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it.each([-1, -60_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("throws RangeError for %d", (ms) => {
    expect(() => formatDuration(ms)).toThrow(RangeError);
  });
});

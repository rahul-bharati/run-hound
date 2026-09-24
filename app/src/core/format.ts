import { CHECK_GROUPS, type Category, type CheckGroup } from "./types.js";

/** The group a check category belongs to (see CHECK_GROUPS). */
export function groupOf(category: Category): CheckGroup {
  const group = CHECK_GROUPS.find((g) => g.categories.includes(category));
  if (!group) throw new RangeError(`No check group for category ${String(category)}`);
  return group.id;
}

/**
 * Human duration for reports, the CLI and the UI:
 *   under 10 s -> one decimal ("0.4 s", "9.8 s"); under 60 s -> whole seconds ("42 s");
 *   under 1 h -> "1 min 12 s" ("3 min" when seconds are 0); from 1 h -> "1 h 3 min" ("2 h" when minutes are 0).
 * Rounds down at each unit (59.9 s is "59 s", never "60 s"). Negative or non-finite input throws RangeError.
 */
export function formatDuration(ms: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) throw new RangeError(`Not a duration: ${ms}`);
  if (ms < 10_000) {
    const tenths = Math.floor(ms / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10} s`;
  }
  if (ms < 60_000) return `${Math.floor(ms / 1000)} s`;
  if (ms < 3_600_000) {
    const min = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return s ? `${min} min ${s} s` : `${min} min`;
  }
  const h = Math.floor(ms / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  return min ? `${h} h ${min} min` : `${h} h`;
}

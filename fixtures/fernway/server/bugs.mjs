// Fernway planted bugs (CONTRACT.md, "Planted bugs"). Node built-ins only.

/** The V1 bugs (W01-W10): each caught by an existing Run Hound check. */
export const V1_BUGS = Object.freeze(["W01", "W02", "W03", "W04", "W05", "W06", "W07", "W08", "W09", "W10"]);

/** The V2 bugs (V01-V05, docs/v2-spec.md "Fernway V2"): caught signed in, by access-control, mass-assignment, deep-links. */
export const V2_BUGS = Object.freeze(["V01", "V02", "V03", "V04", "V05"]);

/** Every bug id FERNWAY_BUGS knows, in order. */
export const ALL_BUGS = Object.freeze([...V1_BUGS, ...V2_BUGS]);

/** Thrown by parseBugs for an unknown id; the message names the known ids. */
export class BugConfigError extends Error {}

/**
 * Parses FERNWAY_BUGS: "none" (default), "all", or a comma list such as "W01,V02" (case-insensitive, whitespace
 * ignored). Returns the set of enabled ids; throws BugConfigError for an unknown id.
 * @param {string | undefined} raw
 * @returns {Set<string>}
 */
export function parseBugs(raw = "none") {
  const value = String(raw ?? "none").replace(/\s+/g, "").toUpperCase();
  if (value === "" || value === "NONE") return new Set();
  if (value === "ALL") return new Set(ALL_BUGS);
  const bugs = new Set();
  for (const id of value.split(",").filter(Boolean)) {
    if (!ALL_BUGS.includes(id)) {
      throw new BugConfigError(`unknown bug id "${id}" in FERNWAY_BUGS (known: ${ALL_BUGS.join(", ")})`);
    }
    bugs.add(id);
  }
  return bugs;
}

/**
 * Scenario-identity matching for write-access: `identityOf` reads the scenario id the way runner.needsOtherAccount
 * decides whether Account B signs in; `markValue` builds the run-token marker a write carries. The salt and
 * identity-name table live in `constants/write-access-constants.ts`. The id-pattern regex lives in `./id-pattern.ts`.
 */
import type { Scenario } from "../../core/types.js";
import { WHO } from "../../constants/write-access-constants.js";
import type { Who } from "../../types/write-access.js";
import { idEndingIn } from "./id-pattern.js";

const SCENARIO_ID: Record<Who, RegExp> = { other: idEndingIn(WHO.other.slug), "signed-out": idEndingIn(WHO["signed-out"].slug) };

/**
 * Who a write-access scenario sends its writes as, decided from the scenario the way runner.needsOtherAccount decides
 * that Account B signs in for it: "other" for the other-account scenario on any form and under any collision suffix,
 * "signed-out" for the signed-out one. Null for an id that names neither (such a scenario is skipped, never run as a
 * guessed identity).
 */
export function identityOf(scenario: Pick<Scenario, "id">): Who | null {
  if (SCENARIO_ID.other.test(scenario.id)) return "other";
  if (SCENARIO_ID["signed-out"].test(scenario.id)) return "signed-out";
  return null;
}

/** `value` with `tag` inserted right after the run token (`key`), or appended with the token when it has none. */
export function markValue(value: string, key: string, tag: string): string {
  const i = value.toLowerCase().indexOf(key);
  if (i < 0) return `${value} ${key}${tag}`;
  return `${value.slice(0, i + key.length)}${tag}${value.slice(i + key.length)}`;
}

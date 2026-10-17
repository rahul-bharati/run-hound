/**
 * The recommended main and helper model from a provider's live model list (docs/onboarding-spec.md "Recommended models"):
 * the first pattern of RECOMMENDED_MODELS that matches any listed model wins, and the newest match is taken. With no
 * pattern for the provider, or none that matches, both are the first usable model of the list.
 */
import { RECOMMENDED_MODELS } from "../constants/ai-constants.js";
import type { AiModelInfo, AiProvider, RecommendedModels } from "./types.js";

/** A snapshot suffix: a trailing -YYYYMMDD or -YYYY-MM-DD, which an alias without it beats. */
const SNAPSHOT = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

/** The numbers in an id, without its snapshot date: "claude-opus-5-5" is [5, 5], "gpt-6.1-sol" is [6, 1]. */
function versionOf(id: string): number[] {
  return (id.replace(SNAPSHOT, "").match(/\d+/g) ?? []).map(Number);
}

/**
 * Orders ids newest first, by the numbers in them ("claude-opus-5-5" before "claude-opus-4-5-…" and before the older
 * "claude-3-7-…" naming, "gpt-6.1-sol" before "gpt-6-sol"), a version with more numbers before the one it extends, the
 * alias before its dated snapshot of the same version, and then by id.
 */
function newestFirst(a: string, b: string): number {
  const left = versionOf(a);
  const right = versionOf(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return right[i]! - left[i]!;
  }
  if (left.length !== right.length) return right.length - left.length;
  const dated = Number(SNAPSHOT.test(a)) - Number(SNAPSHOT.test(b));
  return dated !== 0 ? dated : a < b ? -1 : a > b ? 1 : 0;
}

/** The pair to preselect, or nulls when the list holds no usable model (an embedding model, say, is not usable). */
export function recommendModels(provider: AiProvider | null, models: readonly AiModelInfo[]): RecommendedModels {
  const usable = models.filter((model) => model.suitable !== false);
  const first = usable[0]?.id ?? null;
  const patterns = provider ? RECOMMENDED_MODELS[provider] : undefined;
  const pick = (list: readonly RegExp[] | undefined): string | null => {
    for (const pattern of list ?? []) {
      const matches = usable.filter((model) => pattern.test(model.id)).map((model) => model.id);
      if (matches.length > 0) return matches.sort(newestFirst)[0]!;
    }
    return first;
  };
  return { main: pick(patterns?.main), helper: pick(patterns?.helper) };
}

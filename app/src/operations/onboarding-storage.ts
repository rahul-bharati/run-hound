/**
 * The onboarding marker (docs/onboarding-spec.md "When it shows"): onboarding.json in the desktop settings folder,
 * `{ "version": 1, "completedAt": "<ISO time>", "outcome": "…" }`. This module is the only place that reads or writes it.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ONBOARDING_FILE, ONBOARDING_VERSION } from "../constants/onboarding-constants.js";
import type { OnboardingMarker, OnboardingOutcome } from "../interfaces/onboarding.js";

const OUTCOMES: readonly string[] = ["configured", "skipped", "imported"];

/** The marker in `dir`, or null when there is none or it is not one (missing, unreadable, corrupt or a stranger's file). */
export async function readOnboarding(dir: string): Promise<OnboardingMarker | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, ONBOARDING_FILE), "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const marker = raw as Record<string, unknown>;
  if (typeof marker.version !== "number" || !Number.isFinite(marker.version)) return null;
  if (typeof marker.completedAt !== "string" || typeof marker.outcome !== "string" || !OUTCOMES.includes(marker.outcome)) return null;
  return { version: marker.version, completedAt: marker.completedAt, outcome: marker.outcome as OnboardingOutcome };
}

/** True when the marker says onboarding has run in this version or a later one. */
export const onboardingDone = (marker: OnboardingMarker | null): boolean => marker !== null && marker.version >= ONBOARDING_VERSION;

/** Writes the marker (0600, atomically; the folder is created 0700) and returns it. */
export async function writeOnboarding(dir: string, outcome: OnboardingOutcome, now: Date = new Date()): Promise<OnboardingMarker> {
  const marker: OnboardingMarker = { version: ONBOARDING_VERSION, completedAt: now.toISOString(), outcome };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${ONBOARDING_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temp, 0o600).catch(() => undefined);
    await rename(temp, join(dir, ONBOARDING_FILE));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return marker;
}

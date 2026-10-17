/**
 * Interfaces for the desktop's onboarding and data removal (docs/onboarding-spec.md): the marker file, and what the
 * desktop flow needs from the app around it.
 */

/** How onboarding ended: finished with a working setup, skipped, or not needed because the import brought a usable one. */
export type OnboardingOutcome = "configured" | "skipped" | "imported";

/** onboarding.json in the desktop settings folder. */
export interface OnboardingMarker {
  version: number;
  /** ISO time. */
  completedAt: string;
  outcome: OnboardingOutcome;
}

/** The answer of GET /api/onboarding. */
export interface OnboardingStatus {
  show: boolean;
}

/** What "Delete all keys and data" removed. */
export interface DataDeleteResult {
  /** The files deleted from the settings folder, by name. */
  files: string[];
  /** The finished runs (report folders) deleted from the runs folder; 0 unless asked. */
  runs: number;
}

export type DataDeleteOutcome = { ok: true; result: DataDeleteResult } | { ok: false; status: 400 | 409 | 500; message: string };

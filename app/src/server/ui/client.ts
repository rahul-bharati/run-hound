import { HELPERS } from "./client/helpers.js";
import { NEW_RUN } from "./client/new-run.js";
import { NEW_RUN_BRIEF } from "./client/new-run-brief.js";
import { REPORT } from "./client/report.js";
import { ROUTING } from "./client/routing.js";
import { RUNS } from "./client/runs.js";
import { RUN_LIVE } from "./client/run-live.js";
import { SETTINGS } from "./client/settings.js";
import { SETTINGS_ACCOUNTS } from "./client/settings-accounts.js";
import { SETTINGS_AI } from "./client/settings-ai.js";

// Sections share one browser scope; preserve their initialization order.
export const CLIENT = HELPERS + ROUTING + NEW_RUN + NEW_RUN_BRIEF + RUNS + SETTINGS + SETTINGS_ACCOUNTS + SETTINGS_AI + RUN_LIVE + REPORT;

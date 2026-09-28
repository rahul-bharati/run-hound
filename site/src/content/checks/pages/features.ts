/**
 * The Features group's check pages (C2b: console-network-errors, dead-control, silent-failure, persistence,
 * client-only-validation, page-controls, deep-links; double-submit from C1), in the hub's order. One file per group, so
 * C2a, C2b and C2c never edit the same file; ./index.ts joins the three. To add a page: write ./<id>.ts, add its id to
 * `expectedIds` (pages.test.ts then fails until the page exists), then import it and list it in `pages` in the hub's
 * order.
 */
import { page as clientOnlyValidation } from "./client-only-validation";
import { page as consoleNetworkErrors } from "./console-network-errors";
import { page as deadControl } from "./dead-control";
import { page as deepLinks } from "./deep-links";
import { page as doubleSubmit } from "./double-submit";
import { page as pageControls } from "./page-controls";
import { page as persistence } from "./persistence";
import { page as silentFailure } from "./silent-failure";
import type { CheckPage } from "./types";

/** The group these pages belong to (content/checks/data.ts): pages.test.ts holds every page here to it. */
export const group = "Features";

/** The checks whose page must exist (pages.test.ts). */
export const expectedIds: readonly string[] = [
  "console-network-errors",
  "dead-control",
  "silent-failure",
  "persistence",
  "double-submit",
  "client-only-validation",
  "page-controls",
  "deep-links",
];

/** The group's pages, in the hub's order. `as const` keeps each id a literal type (./index.ts). */
export const pages = [
  consoleNetworkErrors,
  deadControl,
  silentFailure,
  persistence,
  doubleSubmit,
  clientOnlyValidation,
  pageControls,
  deepLinks,
] as const satisfies readonly CheckPage[];

/**
 * The Accessibility group's check pages (C2a: axe-states, keyboard-completion, focus-visible, error-announcement,
 * credential-fields, reflow-320), in the hub's order. One file per group, so C2a, C2b and C2c never edit the same file;
 * ./index.ts joins the three. To add a page: write ./<id>.ts, add its id to `expectedIds` (pages.test.ts then fails
 * until the page exists), then import it and list it in `pages` in the hub's order.
 */
import { page as axeStates } from "./axe-states";
import { page as credentialFields } from "./credential-fields";
import { page as errorAnnouncement } from "./error-announcement";
import { page as focusVisible } from "./focus-visible";
import { page as keyboardCompletion } from "./keyboard-completion";
import { page as reflow320 } from "./reflow-320";
import type { CheckPage } from "./types";

/** The group these pages belong to (content/checks/data.ts): pages.test.ts holds every page here to it. */
export const group = "Accessibility";

/** The checks whose page must exist (pages.test.ts). */
export const expectedIds: readonly string[] = [
  "axe-states",
  "keyboard-completion",
  "focus-visible",
  "error-announcement",
  "credential-fields",
  "reflow-320",
];

/** The group's pages, in the hub's order. `as const` keeps each id a literal type (./index.ts). */
export const pages = [axeStates, keyboardCompletion, focusVisible, errorAnnouncement, credentialFields, reflow320] as const satisfies readonly CheckPage[];

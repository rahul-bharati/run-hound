/**
 * Fixed values for goal-driven agent runs (A1, docs/agent-spec.md): the built-in checks the agent may run on a page it
 * reached, and the action classes each one needs from the grant. Data only; A3 enforces it.
 */

import type { CheckId } from "../core/types.js";
import type { ActionClass } from "../types/grant.js";

/**
 * The functional checks, which run as the run's own account on one page. The security checks that act as a second
 * account or a visitor (access-control, write-access, csrf, mass-assignment, paywall-trust) are not agent tools yet.
 */
export const AGENT_CHECK_CLASSES = {
  "deep-links": ["observation"],
  // These fill and submit the page's forms, so each submit can create a record.
  "console-network-errors": ["observation", "test-data-creation"],
  "dead-control": ["observation", "test-data-creation"],
  "silent-failure": ["observation", "test-data-creation"],
  "client-only-validation": ["observation", "test-data-creation"],
  "double-submit": ["observation", "test-data-creation"],
  // Clicks every button outside the forms: a toggle that saves (a task's "done" box) changes a record, then sets it back.
  "page-controls": ["observation", "test-data-creation", "modification"],
  // A canary typed into an existing record (a profile's bio, say) changes that record.
  persistence: ["observation", "test-data-creation", "modification"],
} as const satisfies Partial<Record<CheckId, readonly ActionClass[]>>;

/** Roles whose value is the user's input: an observation says whether they're filled, never what they hold. */
export const AGENT_EDITABLE_ROLES: readonly string[] = ["textbox", "searchbox", "combobox", "spinbutton", "slider"];

/** Roles an observation checks with isDestructiveControl, so a click on them can be refused. */
export const AGENT_CONTROL_ROLES: readonly string[] = ["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio"];

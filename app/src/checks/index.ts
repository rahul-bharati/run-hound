import type { Check } from "../core/types.js";
import { check as consoleNetworkErrors } from "./console-network-errors.js";
import { check as deadControl } from "./dead-control.js";
import { check as silentFailure } from "./silent-failure.js";
import { check as persistence } from "./persistence.js";
import { check as doubleSubmit } from "./double-submit.js";
import { check as axeStates } from "./axe-states.js";
import { check as keyboardCompletion } from "./keyboard-completion.js";
import { check as focusVisible } from "./focus-visible.js";
import { check as errorAnnouncement } from "./error-announcement.js";
import { check as credentialFields } from "./credential-fields.js";
import { check as bundleSecrets } from "./bundle-secrets.js";
import { check as piiLeak } from "./pii-leak.js";
import { check as verboseErrors } from "./verbose-errors.js";
import { check as reflow320 } from "./reflow-320.js";
import { check as clientOnlyValidation } from "./client-only-validation.js";

/** Every V0 check, in CHECK_IDS order. */
export const checks: Check[] = [
  consoleNetworkErrors,
  deadControl,
  silentFailure,
  persistence,
  doubleSubmit,
  axeStates,
  keyboardCompletion,
  focusVisible,
  errorAnnouncement,
  credentialFields,
  bundleSecrets,
  piiLeak,
  verboseErrors,
  reflow320,
  clientOnlyValidation,
];

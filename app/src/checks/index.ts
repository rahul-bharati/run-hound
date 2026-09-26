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
import { check as pageControls } from "./page-controls.js";
import { check as securityHeaders } from "./security-headers.js";
import { check as cookieFlags } from "./cookie-flags.js";
import { check as cors } from "./cors.js";
import { check as sourceMaps } from "./source-maps.js";
import { check as aiFlow } from "./ai-flow.js";
import { check as accessControl } from "./access-control.js";
import { check as massAssignment } from "./mass-assignment.js";
import { check as deepLinks } from "./deep-links.js";
import { check as writeAccess } from "./write-access.js";
import { check as csrf } from "./csrf.js";
import { check as paywallTrust } from "./paywall-trust.js";

/** Every check (V0, V1, the 0.3.0 AI flow runner and the 0.4.0 and 0.5.0 V2 checks), in CHECK_IDS order. */
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
  pageControls,
  securityHeaders,
  cookieFlags,
  cors,
  sourceMaps,
  aiFlow,
  accessControl,
  massAssignment,
  deepLinks,
  writeAccess,
  csrf,
  paywallTrust,
];

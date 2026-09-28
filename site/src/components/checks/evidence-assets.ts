/**
 * The pictures a check page can show (frames and GIFs from the run extracts, copied by scripts/extract-run.mjs into
 * src/assets/runs/0.6.0/), as static imports, keyed by the path the extract records ("assets/runs/0.6.0/…"): next/image
 * needs a static import for each, and a check module (plain data) can't hold one. evidence-assets.test.ts checks every
 * picture a featured finding records is here. Server-only; the request cards are shown as text listings instead.
 */
import type { StaticImageData } from "next/image";
import kennelAxeStatesFrame1 from "@/assets/runs/0.6.0/kennel/axe-states-frame-1.png";
import kennelConsoleNetworkErrorsFrame1 from "@/assets/runs/0.6.0/kennel/console-network-errors-frame-1.png";
import kennelCredentialFieldsFrame1 from "@/assets/runs/0.6.0/kennel/credential-fields-frame-1.png";
import kennelDeadControlGif1 from "@/assets/runs/0.6.0/kennel/dead-control-gif-1.gif";
import kennelDoubleSubmitGif1 from "@/assets/runs/0.6.0/kennel/double-submit-gif-1.gif";
import kennelErrorAnnouncementFrame1 from "@/assets/runs/0.6.0/kennel/error-announcement-frame-1.png";
import kennelFocusVisibleGif1 from "@/assets/runs/0.6.0/kennel/focus-visible-gif-1.gif";
import kennelKeyboardCompletionGif1 from "@/assets/runs/0.6.0/kennel/keyboard-completion-gif-1.gif";
import kennelPageControlsGif1 from "@/assets/runs/0.6.0/kennel/page-controls-gif-1.gif";
import kennelPersistenceGif1 from "@/assets/runs/0.6.0/kennel/persistence-gif-1.gif";
import kennelPiiLeakFrame1 from "@/assets/runs/0.6.0/kennel/pii-leak-frame-1.png";
import kennelReflow320Frame1 from "@/assets/runs/0.6.0/kennel/reflow-320-frame-1.png";
import kennelSilentFailureGif1 from "@/assets/runs/0.6.0/kennel/silent-failure-gif-1.gif";
import fernwayAccessControlFrame1 from "@/assets/runs/0.6.0/fernway/access-control-frame-1.png";
import fernwayDeepLinksFrame1 from "@/assets/runs/0.6.0/fernway/deep-links-frame-1.png";
import fernwayPaywallTrustFrame1 from "@/assets/runs/0.6.0/fernway/paywall-trust-frame-1.png";

export const evidenceAssets: Readonly<Record<string, StaticImageData>> = {
  "assets/runs/0.6.0/kennel/axe-states-frame-1.png": kennelAxeStatesFrame1,
  "assets/runs/0.6.0/kennel/console-network-errors-frame-1.png": kennelConsoleNetworkErrorsFrame1,
  "assets/runs/0.6.0/kennel/credential-fields-frame-1.png": kennelCredentialFieldsFrame1,
  "assets/runs/0.6.0/kennel/dead-control-gif-1.gif": kennelDeadControlGif1,
  "assets/runs/0.6.0/kennel/double-submit-gif-1.gif": kennelDoubleSubmitGif1,
  "assets/runs/0.6.0/kennel/error-announcement-frame-1.png": kennelErrorAnnouncementFrame1,
  "assets/runs/0.6.0/kennel/focus-visible-gif-1.gif": kennelFocusVisibleGif1,
  "assets/runs/0.6.0/kennel/keyboard-completion-gif-1.gif": kennelKeyboardCompletionGif1,
  "assets/runs/0.6.0/kennel/page-controls-gif-1.gif": kennelPageControlsGif1,
  "assets/runs/0.6.0/kennel/persistence-gif-1.gif": kennelPersistenceGif1,
  "assets/runs/0.6.0/kennel/pii-leak-frame-1.png": kennelPiiLeakFrame1,
  "assets/runs/0.6.0/kennel/reflow-320-frame-1.png": kennelReflow320Frame1,
  "assets/runs/0.6.0/kennel/silent-failure-gif-1.gif": kennelSilentFailureGif1,
  "assets/runs/0.6.0/fernway/access-control-frame-1.png": fernwayAccessControlFrame1,
  "assets/runs/0.6.0/fernway/deep-links-frame-1.png": fernwayDeepLinksFrame1,
  "assets/runs/0.6.0/fernway/paywall-trust-frame-1.png": fernwayPaywallTrustFrame1,
};

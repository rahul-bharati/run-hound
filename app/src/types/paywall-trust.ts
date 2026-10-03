/**
 * Type aliases for the paywall-trust check (canonical home).
 *
 * `PAYWALL_TRUST_ID` is the runtime literal for the check id and lives in `constants/paywall-trust-constants.ts`;
 * `PaywallTrustId` is the type-level alias declared here.
 */

import type { Dialog, Request, Route as PwRoute } from "playwright";
import type { CheckContext } from "../core/types.js";

export type PaywallTrustId = "paywall-trust";

/** How a route answered from the URL loader (matches the original `Outcome`). */
export type PaywallOutcome = "answered" | "not-found" | "sign-in" | "left" | "moved" | "not-loaded" | "stopped";

/** How a route was opened. */
export type PaywallRouteSource = "link" | "conventional" | "linked-page" | "tab";

/** What a hold's first stop reaction is, for a held route: route abort. */
export type PaywallHoldRoute = (route: PwRoute, request: Request) => Promise<void>;

/** The dialog handler from clickPlanControl that accepts go-aheads and dismisses offer-flavored confirm()s. */
export type PaywallDialogHandler = (dialog: Dialog) => void;

/** A session the check opened (the result of ctx.openPage), typed for narrow port access. */
export type PaywallSession = Awaited<ReturnType<CheckContext["openPage"]>>;
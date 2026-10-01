/**
 * UI controller: serves the local app shell HTML at GET / with its own CSP (only its own inline script and stylesheet,
 * images from this server and data: URIs, requests to itself). The CSP is computed once at startup from the rendered
 * HTML so its inline-script hashes match the page.
 */
import type { Hono } from "hono";
import { renderUi } from "../ui/index.js";
import { uiCsp } from "../middleware/security.js";
import type { Services } from "../models/services.js";

export interface UiControllerDeps {
  services: Services;
  /** Pre-rendered UI HTML (computed once in createApp so the CSP hashes match). */
  uiHtml: string;
  /** Pre-computed UI CSP. */
  uiPolicy: string;
}

export function registerUiRoutes(app: Hono, deps: UiControllerDeps): void {
  const { uiHtml, uiPolicy } = deps;
  app.get("/", (c) =>
    c.html(uiHtml, 200, { "content-security-policy": uiPolicy }),
  );
}

/** Build the UI HTML and its CSP from the services. */
export function buildUi(services: Services): { uiHtml: string; uiPolicy: string } {
  const uiHtml = renderUi({
    version: services.version,
    canShowBrowser: services.canShowBrowser,
  });
  const uiPolicy = uiCsp(uiHtml);
  return { uiHtml, uiPolicy };
}

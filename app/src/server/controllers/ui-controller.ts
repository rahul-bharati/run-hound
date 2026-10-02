/**
 * UI controller: GET / serves the local app shell HTML with its CSP (inline script/style hashes match the page).
 */
import type { Hono } from "hono";
import type { IUiFlow } from "../../interfaces/server.js";

export interface UiControllerDeps {
  flow: IUiFlow;
}

export function registerUiRoutes(app: Hono, deps: UiControllerDeps): void {
  app.get("/", (c) =>
    c.html(deps.flow.uiHtml(), 200, { "content-security-policy": deps.flow.uiPolicy() }),
  );
}
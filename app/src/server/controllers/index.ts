/**
 * Controllers barrel: each controller exports a `register…Routes(app, deps)` that wires the controller's routes onto
 * a Hono app. The composition root calls them in the same order as the pre-refactor app.ts to keep observable
 * behaviour identical.
 */
export { registerUiRoutes } from "./ui-controller.js";
export { registerPlanRoutes } from "./plan-controller.js";
export { registerRunsRoutes } from "./runs-controller.js";
export { registerAiRoutes } from "./ai-controller.js";
export { registerAccountsRoutes } from "./accounts-controller.js";export { registerBriefRoutes } from "./brief-controller.js";

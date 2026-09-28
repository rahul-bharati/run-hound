/**
 * The moment motion code may be requested (DESIGN.md §4.4): after the load event, then an idle callback with a 2 s
 * timeout, so GSAP never competes with the page's own resources. One shared promise for every island on a page.
 * Browsers without requestIdleCallback (Safari) get a timeout instead.
 */

/** Where the moment is kept: on the environment itself (the window), so there is one promise per page. */
const moment = Symbol();

export type AfterLoadEnv = {
  document: { readyState: string };
  addEventListener(type: "load", listener: () => void): void;
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => unknown;
  setTimeout(callback: () => void, ms?: number): unknown;
  [moment]?: Promise<void>;
};

export const idleTimeoutMs = 2000;

/**
 * The page's after-load-and-idle moment: one promise per environment (the browser's window), however many times the
 * gate runs (hydration, then a permission change) and however many islands wait on it.
 */
export function afterLoadIdle(env: AfterLoadEnv): Promise<void> {
  return (env[moment] ??= new Promise<void>((resolve) => {
    const idle = () => {
      if (env.requestIdleCallback) env.requestIdleCallback(() => resolve(), { timeout: idleTimeoutMs });
      else env.setTimeout(resolve, 1);
    };
    // The load event fires once, so the listener needs no { once }.
    if (env.document.readyState === "complete") idle();
    else env.addEventListener("load", idle);
  }));
}

/** The same moment, as a function of no arguments. */
export const createAfterLoadIdle = (env: AfterLoadEnv) => () => afterLoadIdle(env);

// The motion gate (DESIGN.md §4.4-4.5): motion is allowed only with no reduced-motion preference and Save-Data off;
// the server snapshot is "not allowed", so the server HTML and every reader before hydration get the finished frame;
// when motion isn't allowed, the CSS hold is released at hydration (Save-Data readers get the finished frame at once,
// not after the 3 s fallback); when it is, the islands mount only after the load event plus an idle callback. `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { html } from "@/components/primitives/test-render";
import { afterLoadIdle, createAfterLoadIdle } from "./after-load-idle";
import { type HoldRoot, releaseHolds, startGate } from "./gate-core";
import { getServerSnapshot, motionAllowed, subscribeMotionAllowed } from "./use-motion-allowed";

const { MotionGate } = await import("./motion-gate");

type Listener = () => void;
function fakeEnv({ reduce = false, saveData = false as boolean | undefined, readyState = "complete", idle = true } = {}) {
  const queries: { query: string; listeners: Set<Listener> }[] = [];
  const connectionListeners = new Set<Listener>();
  const windowListeners = new Map<string, Listener>();
  const idleCalls: { callback: Listener; timeout?: number }[] = [];
  const timeouts: Listener[] = [];
  const env = {
    matchMedia(query: string) {
      const entry = { query, listeners: new Set<Listener>() };
      queries.push(entry);
      return {
        matches: query === "(prefers-reduced-motion: no-preference)" ? !reduce : false,
        addEventListener: (_type: string, fn: Listener) => entry.listeners.add(fn),
        removeEventListener: (_type: string, fn: Listener) => entry.listeners.delete(fn),
      };
    },
    navigator: {
      connection:
        saveData === undefined
          ? undefined
          : { saveData, addEventListener: (_: string, fn: Listener) => connectionListeners.add(fn), removeEventListener: (_: string, fn: Listener) => connectionListeners.delete(fn) },
    },
    document: { readyState, querySelectorAll: (): HoldRoot[] => [] },
    addEventListener: (type: string, fn: Listener) => windowListeners.set(type, fn),
    requestIdleCallback: idle ? (callback: Listener, options?: { timeout?: number }) => idleCalls.push({ callback, timeout: options?.timeout }) : undefined,
    setTimeout: (fn: Listener) => timeouts.push(fn),
  };
  return { env, queries, connectionListeners, windowListeners, idleCalls, timeouts };
}
const flush = () => new Promise((r) => setImmediate(r));

describe("use-motion-allowed", () => {
  test("allowed with no reduced-motion preference and Save-Data off (or no connection API)", () => {
    assert.equal(motionAllowed(fakeEnv().env), true);
    assert.equal(motionAllowed(fakeEnv({ saveData: undefined }).env), true);
  });

  test("reduced motion blocks it; Save-Data blocks it", () => {
    assert.equal(motionAllowed(fakeEnv({ reduce: true }).env), false);
    assert.equal(motionAllowed(fakeEnv({ saveData: true }).env), false);
  });

  test("the server snapshot is false: the server renders the finished frame, and the gate renders nothing", () => {
    assert.equal(getServerSnapshot(), false);
    assert.equal(html(createElement(MotionGate, { islands: ["hero-run", "scroll"] })), "");
  });

  test("subscribes to the media query and to Save-Data changes, and unsubscribes", () => {
    const fake = fakeEnv();
    const onChange = () => {};
    const unsubscribe = subscribeMotionAllowed(onChange, fake.env);
    const query = fake.queries.find((q) => q.query === "(prefers-reduced-motion: no-preference)")!;
    assert.ok(query.listeners.has(onChange));
    assert.ok(fake.connectionListeners.has(onChange));
    unsubscribe();
    assert.equal(query.listeners.size, 0);
    assert.equal(fake.connectionListeners.size, 0);
  });
});

describe("after-load-idle", () => {
  test("waits for the load event, then an idle callback with a 2 s timeout; one shared moment", async () => {
    const fake = fakeEnv({ readyState: "loading" });
    const afterLoadIdle = createAfterLoadIdle(fake.env);
    let resolved = 0;
    const first = afterLoadIdle().then(() => (resolved += 1));
    assert.equal(afterLoadIdle(), afterLoadIdle(), "one promise for every island");
    await flush();
    assert.equal(fake.idleCalls.length, 0, "nothing before load");
    fake.windowListeners.get("load")!();
    assert.equal(fake.idleCalls.length, 1);
    assert.equal(fake.idleCalls[0].timeout, 2000);
    await flush();
    assert.equal(resolved, 0, "nothing before idle");
    fake.idleCalls[0].callback();
    await first;
    assert.equal(resolved, 1);
  });

  test("already loaded: straight to the idle callback; no requestIdleCallback (Safari): a timeout", async () => {
    const loaded = fakeEnv({ readyState: "complete" });
    createAfterLoadIdle(loaded.env)();
    assert.equal(loaded.idleCalls.length, 1);
    const safari = fakeEnv({ readyState: "complete", idle: false });
    const done = createAfterLoadIdle(safari.env)();
    assert.equal(safari.timeouts.length, 1);
    safari.timeouts[0]();
    await done;
  });
});

describe("gate-core", () => {
  function root(held: boolean, ready = false) {
    const attributes = new Map<string, string>(ready ? [["data-ready", ""]] : []);
    return {
      attributes,
      querySelector: (selector: string) => (selector === '[data-beat="late"]' && held ? {} : null),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      hasAttribute: (name: string) => attributes.has(name),
    };
  }

  test("releaseHolds sets data-ready on every unready root that holds late parts, and only those", () => {
    const hero = root(true);
    const trail = root(true);
    const cards = root(false);
    const already = root(true, true);
    const doc = {
      querySelectorAll: (selector: string) => {
        assert.equal(selector, "[data-motion]:not([data-ready])");
        return [hero, trail, cards];
      },
    };
    assert.equal(releaseHolds(doc), 2);
    assert.ok(hero.attributes.has("data-ready"));
    assert.ok(trail.attributes.has("data-ready"));
    assert.ok(!cards.attributes.has("data-ready"));
    assert.ok(already.attributes.has("data-ready"));
  });

  test("not allowed (Save-Data): the hold is released at once and nothing is scheduled", async () => {
    const fake = fakeEnv({ saveData: true });
    const hero = root(true);
    fake.env.document.querySelectorAll = () => [hero];
    let ready = 0;
    startGate(fake.env, () => (ready += 1));
    assert.ok(hero.attributes.has("data-ready"), "released at hydration");
    await flush();
    assert.equal(fake.idleCalls.length, 0);
    assert.equal(ready, 0);
  });

  test("allowed: the hold stays (the islands release it), and the islands mount after load plus idle", async () => {
    const fake = fakeEnv();
    const hero = root(true);
    fake.env.document.querySelectorAll = () => [hero];
    let ready = 0;
    startGate(fake.env, () => (ready += 1));
    assert.ok(!hero.attributes.has("data-ready"));
    assert.equal(ready, 0);
    fake.idleCalls[0].callback();
    await flush();
    assert.equal(ready, 1);
  });

  test("hydration and a later run of the gate wait on one shared load-plus-idle moment (§4.4: one promise per page)", async () => {
    const fake = fakeEnv();
    let ready = 0;
    const cancel = startGate(fake.env, () => (ready += 1));
    cancel(); // the permission changed: the effect re-runs
    startGate(fake.env, () => (ready += 1));
    assert.equal(fake.idleCalls.length, 1, "one idle callback for the page, not one per run");
    assert.equal(createAfterLoadIdle(fake.env)(), afterLoadIdle(fake.env), "the islands' moment is the gate's");
    fake.idleCalls[0].callback();
    await flush();
    assert.equal(ready, 1, "only the live run mounts the islands");
  });

  test("cancelled before idle (unmounted, or motion turned off): nothing mounts", async () => {
    const fake = fakeEnv();
    let ready = 0;
    const cancel = startGate(fake.env, () => (ready += 1));
    cancel();
    fake.idleCalls[0].callback();
    await flush();
    assert.equal(ready, 0);
  });
});

describe("what loads up front", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

  test("the gate imports no GSAP; the islands come in through next/dynamic with ssr: false", () => {
    const gate = read("./motion-gate.tsx");
    assert.doesNotMatch(gate, /from\s+["'](gsap|@gsap\/react)/);
    assert.equal((gate.match(/dynamic\(\(\) => import\("\.\/[\w-]+"\), \{ ssr: false \}\)/g) ?? []).length, 3);
    for (const file of ["./gate-core.ts", "./use-motion-allowed.ts", "./after-load-idle.ts", "./runtime-core.ts", "./scroll-runtime.tsx", "./motion-gate-loader.tsx"]) {
      assert.doesNotMatch(read(file), /^import[^;]*from\s+["'](gsap|@gsap\/react)[^"']*["']/m, `${file} imports GSAP statically`);
    }
  });

  // §4.6 #11: the gate is one chunk. A static import of it anywhere would merge a copy into that page's own chunk.
  test("the pages' MotionGate (the loader) imports the gate only through import(), starting at hydration", async () => {
    const loader = read("./motion-gate-loader.tsx");
    assert.doesNotMatch(loader, /^import(?!\s+type)[^;]*from\s+["']\.\/motion-gate["']/m, "a static import of the gate");
    assert.match(loader, /: import\("\.\/motion-gate"\)\.then\(/, "the gate is imported when the module is evaluated");
    const { MotionGateLoader } = await import("./motion-gate-loader");
    assert.equal(html(createElement(MotionGateLoader, { islands: ["hero-run", "scroll"] })), "", "nothing on the server");
  });

  // The homepage's after-load motion is the hero's and this shell (§5.2: 32,000 B); the runtime and the effects'
  // engine come when the first effect is near.
  test("the scroll runtime's island imports neither the runtime nor the engine up front", () => {
    const island = read("./scroll-runtime.tsx");
    assert.doesNotMatch(island, /^import[^;]*from\s+["']\.\/(runtime-core|scroll-effects|effects\/[\w-]+)["']/m);
    assert.match(island, /import\("\.\/scroll-effects"\)/);
    assert.doesNotMatch(read("./effects/engine.ts"), /^import[^;]*from\s+["']gsap\/(ScrollTrigger|DrawSVGPlugin)["']/m, "ScrollTrigger and DrawSVG stay out of the engine");
  });
});

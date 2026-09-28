/**
 * The lab's own helpers, checked in a real browser on small pages made here (no build needed): the text audit sees
 * text that GSAP or CSS moves and fades, in any element; the accent audit counts accent fills and borders on links (in
 * any colour syntax, Tailwind's color-mix() opacity modifiers included) and an icon once; the contrast sampler reads
 * such a text colour; the frame sampler times a fade and catches a flash; the filmstrip films; the pixel comparison sees
 * a one-unit change; the focus-ring probe tells a ring from a card's shadow and sees focus under stacked sticky bars;
 * the request log keeps the phase a request was made in and logs failures; the footer measured is the site's. The gates
 * of every other spec rest on these. Runs with the other specs (`pnpm lab`, which serves a build), or alone, with no
 * build: node --test scripts/lab/specs/lab-helpers.spec.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { accentAudit, contrastSample } from "../lib/audits.mjs";
import { launch, newPage, sleep } from "../lib/browser.mjs";
import { focusInfo, tabStops } from "../lib/keyboard.mjs";
import { installRafCounter, installTextAudit, rafDuring, readTextAudit } from "../lib/motion.mjs";
import { labOut } from "../lib/out.mjs";
import { measurePage } from "../lib/page-measures.mjs";
import { recordRequests, scriptsIn } from "../lib/requests.mjs";
import { compareImages } from "../lib/screenshots.mjs";
import { filmstrip, installFrameSampler, readFrameSampler } from "../lib/timeline.mjs";

const siteDir = join(import.meta.dirname, "..", "..", "..");
const gsap = readFileSync(join(siteDir, "node_modules", "gsap", "dist", "gsap.min.js"), "utf8");
const address = "http://lab-helpers.test/";

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/**
 * A page served at `address` with this body (and a dark background, as the site's). `install` runs before the page
 * loads (init scripts); `wait` is how far goto() waits.
 */
async function open(body, { head = "", audit = false, install, wait = "load" } = {}) {
  const { context, page } = await newPage(browser, { profile: "desktop", csp: false });
  await page.route(address, (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head>${head}</head><body style="margin:0;background:#0b0f12;color:#e6edf3">${body}</body></html>` }),
  );
  if (audit) await installTextAudit(page);
  if (install) await install(page);
  await page.goto(address, { waitUntil: wait });
  return { context, page };
}

describe("the text audit", () => {
  test("catches text GSAP moves (GSAP writes translate: none, and the transform beside it), CSS moves and fades", async () => {
    const { context, page } = await open(
      `<main>
        <p id="gsap-set">Set twenty pixels down by GSAP</p>
        <p id="gsap-rise">Risen into place by a GSAP tween</p>
        <p id="css-transition" class="low">Moved by a CSS transition</p>
        <p id="css-translate" class="low-translate">Moved by the translate property</p>
        <p id="faded" class="faded">Faded in by a CSS transition</p>
        <p id="inline" style="transform: translateY(20px)">Held down by an inline transform</p>
        <p id="static" class="centred">Centred with a transform that never changes</p>
        <p id="still">Never moves</p>
        <div aria-hidden="true"><p id="decor" class="low">Decoration nobody reads</p></div>
      </main>
      <style>
        .low { transform: translateY(12px); transition: transform 400ms linear; }
        .low-translate { translate: 0 12px; transition: translate 400ms linear; }
        .faded { opacity: 0.2; transition: opacity 400ms linear; }
        .centred { transform: translateX(-4px); }
        .settled { transform: none; translate: none; opacity: 1; }
      </style>
      <script>${gsap}</script>
      <script>
        gsap.set("#gsap-set", { y: 20 });
        gsap.from("#gsap-rise", { y: 16, duration: 0.5 });
        setTimeout(() => {
          for (const id of ["css-transition", "css-translate", "faded", "decor"]) document.getElementById(id).classList.add("settled");
        }, 150);
      </script>`,
      { audit: true },
    );
    await sleep(1200);
    const style = await page.evaluate(() => document.getElementById("gsap-set").getAttribute("style"));
    assert.match(style, /translate: none/, "GSAP writes translate: none beside its transform");
    const found = Object.fromEntries((await readTextAudit(page)).map((entry) => [entry.element.match(/«(.*)»/)[1], entry]));
    assert.equal(found["Set twenty pixels down by GSAP"]?.moved, true, "gsap.set");
    assert.equal(found["Risen into place by a GSAP tween"]?.moved, true, "gsap.from");
    assert.equal(found["Moved by a CSS transition"]?.moved, true, "a CSS class and transition");
    assert.equal(found["Moved by the translate property"]?.moved, true, "the translate property");
    assert.ok(found["Faded in by a CSS transition"]?.minOpacity < 1, "a fade");
    assert.equal(found["Held down by an inline transform"]?.moved, true, "an inline transform");
    assert.equal(found["Centred with a transform that never changes"], undefined, "a transform that stays put is layout");
    assert.equal(found["Never moves"], undefined);
    assert.equal(found["Decoration nobody reads"], undefined, "aria-hidden");
    await context.close();
  });

  test("sees words in any element: a div, a span faded inside a still paragraph, a code element, a strong", async () => {
    // Finding cards, stamps and commands are divs, spans and code elements, not paragraphs.
    const { context, page } = await open(
      `<main>
        <div class="fade">Two bookings for one click</div>
        <p>Stamp: <span class="fade">EVIDENCE captured</span></p>
        <code class="fade">docker run run-hound</code>
        <div><strong class="rise">Moved in a strong element</strong></div>
        <small>Still small print</small>
        <div aria-hidden="true"><span class="fade">Decoration in a span</span></div>
        <span class="sr-only fade" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Read out, never seen</span>
        <svg width="80" height="20"><text x="0" y="15" class="fade">Label</text></svg>
      </main>
      <style>
        .fade { opacity: 0; transition: opacity 400ms linear; }
        .rise { display: inline-block; transform: translateY(12px); transition: transform 400ms linear; }
        .on { opacity: 1; transform: none; }
      </style>
      <script>
        setTimeout(() => document.querySelectorAll(".fade, .rise").forEach((element) => element.classList.add("on")), 150);
      </script>`,
      { audit: true },
    );
    await sleep(1200);
    const caught = (await readTextAudit(page)).map((entry) => entry.element).sort();
    assert.deepEqual(caught, [
      "code «docker run run-hound»",
      "div «Two bookings for one click»",
      "span «EVIDENCE captured»",
      "strong «Moved in a strong element»",
    ]);
    await context.close();
  });
});

describe("the accent audit", () => {
  test("counts accent fills and borders on links and buttons; exempts link text, data-accent-exempt and hidden text", async () => {
    const { context, page } = await open(`<main>
      <a href="/a/" style="display:block;height:80px;border-top:4px solid #5EE6A3">Card link with an accent top bar</a>
      <a href="/b/" style="display:block;height:80px;background:#5EE6A3;color:#0b0f12">Accent-filled card link</a>
      <button style="display:block;height:48px;border:2px solid #5EE6A3;background:none;color:#e6edf3">Secondary button with an accent border</button>
      <div style="height:80px;border-top:4px solid #5EE6A3">Plain block with an accent top bar</div>
      <a href="/c/" style="display:block;font-size:32px;color:#5EE6A3">Large accent link text</a>
      <a href="/d/" data-accent-exempt style="display:inline-block;height:48px;background:#5EE6A3;color:#0b0f12">Primary button</a>
      <h1>Find the <span data-accent-exempt style="color:#5EE6A3;font-size:40px">bugs</span></h1>
      <p><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);color:#5EE6A3;font-size:40px">26 checks</span></p>
    </main>`);
    const result = await accentAudit(page);
    assert.deepEqual(
      result.objects.map((o) => o.reasons.join("+")),
      ["border-top ≥ 2px", "fill", "border-top ≥ 2px+border-right ≥ 2px+border-bottom ≥ 2px+border-left ≥ 2px", "border-top ≥ 2px"],
    );
    assert.equal(result.maxPerWindow, 4);
    await context.close();
  });

  test("reads every colour syntax: Tailwind's opacity modifiers compute to oklab(), and count from 35% opacity", async () => {
    // border-accent/60 and bg-accent compile to color-mix(in oklab, …), which Chromium reports as oklab(…).
    const { context, page } = await open(`<main>
      <div id="border" style="height:40px;border:2px solid color-mix(in oklab, #5EE6A3 60%, transparent)">Border at 60%</div>
      <div id="fill" style="height:40px;background:color-mix(in oklab, #5EE6A3 100%, transparent)">Fill at 100%</div>
      <div id="faint" style="height:40px;background:color-mix(in oklab, #5EE6A3 10%, transparent)">Fill at 10%</div>
      <div id="lch" style="height:40px;border-top:2px solid oklch(0.8327 0.1533 158.8)">An oklch border</div>
      <div id="rgb" style="height:40px;border:2px solid rgb(94 230 163 / 0.6)">An rgb border at 60%</div>
      <div id="other" style="height:40px;border:2px solid color-mix(in oklab, #e6edf3 60%, transparent)">Another colour</div>
    </main>`);
    const computed = await page.evaluate(() => getComputedStyle(document.getElementById("border")).borderTopColor);
    assert.match(computed, /^oklab\(/, "Chromium reports a color-mix() as oklab()");
    const result = await accentAudit(page);
    assert.deepEqual(
      result.objects.map((o) => `${o.element.split(".")[0]} ${o.reasons.join("+")}`),
      [
        "div border-top ≥ 2px+border-right ≥ 2px+border-bottom ≥ 2px+border-left ≥ 2px",
        "div fill",
        "div border-top ≥ 2px",
        "div border-top ≥ 2px+border-right ≥ 2px+border-bottom ≥ 2px+border-left ≥ 2px",
      ],
    );
    assert.equal(result.objects.length, 4, "the 10% fill and the other colour are not accents");
    await context.close();
  });

  test("an accent icon is one object, however many shapes it draws", async () => {
    // A lucide-style icon: the <svg> carries the stroke, and each shape inherits it.
    const { context, page } = await open(`<main style="padding:40px">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5EE6A3" stroke-width="2"><path d="M20 6 9 17l-5-5"/><path d="M4 4h16"/><circle cx="12" cy="12" r="3"/></svg>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e6edf3" stroke-width="2"><path d="M4 4h16"/><path d="M4 12h16" stroke="#5EE6A3"/><path d="M4 20h16" stroke="#5EE6A3"/></svg>
      <!-- lucide's key-round at 16 px, as the home page draws it: a 1.75 stroke and a 0.67 px filled dot are not strong. -->
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EE6A3" stroke-width="1.75"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="#5EE6A3"/></svg>
    </main>`);
    const result = await accentAudit(page);
    assert.deepEqual(
      result.objects.map((o) => `${o.element} ${o.reasons.join("+")}`),
      ["svg. stroke ≥ 2px", "svg. stroke ≥ 2px"],
      "each icon once, named by its <svg>; a thin stroke and a sub-pixel dot are not strong",
    );
    assert.deepEqual(Object.keys(result.objects[0]).sort(), ["bottom", "element", "reasons", "top"]);
    assert.equal(result.maxPerWindow, 2);
    await context.close();
  });
});

describe("the contrast sampler", () => {
  test("reads a text colour in oklab() (a Tailwind opacity modifier) as the colour it is", async () => {
    // Text over a gradient: axe can't judge it (incomplete), so the sampler measures it against the pixels.
    const { context, page } = await open(`<main style="padding:20px">
      <p id="mixed" style="font-size:16px;padding:12px;background-image:linear-gradient(#0b0f12, #0b0f12);color:color-mix(in oklab, #e6edf3 70%, transparent)">Text at 70% of the foreground colour</p>
      <p id="plain" style="font-size:16px;padding:12px;background-image:linear-gradient(#0b0f12, #0b0f12);color:rgb(230 237 243 / 0.7)">The same colour written as rgb()</p>
    </main>`);
    const nodes = await contrastSample(page);
    const byId = Object.fromEntries(nodes.map((node) => [node.target.replace(/^#/, ""), node]));
    assert.ok(byId.mixed && byId.plain, JSON.stringify(nodes.map((n) => n.target)));
    // Both are the same colour: ~9:1 over #0b0f12 (read as r, g, b, the oklab numbers were near black, about 1:1).
    assert.ok(byId.plain.ratio > 7, `rgb(): ${byId.plain.ratio}`);
    assert.ok(Math.abs(byId.mixed.ratio - byId.plain.ratio) < 0.3, `oklab() ${byId.mixed.ratio}, rgb() ${byId.plain.ratio}`);
    assert.equal(byId.mixed.passes, true);
    await context.close();
  });
});

describe("the frame sampler and the filmstrip", () => {
  test("times a fade, catches a flash, and stops its frame loop when its time is up", async () => {
    const { context, page } = await open(
      `<main>
        <p id="fade" class="fade">Fades in over 600 ms after a 200 ms delay</p>
        <p id="flash" class="flash">Shown, hidden for a moment, then shown again</p>
        <p id="still">Never changes</p>
      </main>
      <style>
        .fade { animation: fade 600ms linear 200ms both; }
        .flash { animation: flash 900ms linear both; }
        @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes flash { 0%, 30% { opacity: 1; } 31%, 60% { opacity: 0; } 61%, 100% { opacity: 1; } }
      </style>`,
      {
        install: async (page) => {
          await installRafCounter(page);
          await installFrameSampler(page, ["#fade", "#flash", "#still", "#missing"], { ms: 2000 });
        },
      },
    );
    await sleep(2600);
    const frames = await readFrameSampler(page);
    const { fade, flash, still, missing } = {
      fade: frames["#fade"],
      flash: frames["#flash"],
      still: frames["#still"],
      missing: frames["#missing"],
    };
    // The fade crosses 0.5 about 500 ms after the element appears, and rests at 1 about 800 ms after.
    assert.ok(fade.frames > 20, `${fade.frames} frames`);
    assert.ok(fade.firstVisibleMs - fade.firstSeenMs >= 300 && fade.firstVisibleMs - fade.firstSeenMs <= 1200, JSON.stringify(fade));
    assert.ok(fade.restMs > fade.firstVisibleMs && fade.restMs - fade.firstSeenMs >= 650, JSON.stringify(fade));
    assert.equal(fade.flash, false);
    assert.equal(flash.flash, true, JSON.stringify(flash));
    assert.equal(still.flash, false);
    assert.equal(still.firstVisibleMs, still.firstSeenMs, "visible from its first frame");
    assert.equal(still.restMs, still.firstSeenMs);
    assert.deepEqual(missing, { frames: 0, firstSeenMs: null, firstVisibleMs: null, restMs: null, flash: false });
    // The loop stopped after 2 s: nothing runs at rest (the motion contract counts requestAnimationFrame callbacks).
    assert.equal(await rafDuring(page, 500), 0);
    await context.close();
  });

  test("the filmstrip saves a frame every step, each with its time, and a frames.json", async () => {
    const { context, page } = await open(`<main><p>Frame</p></main>`);
    const dir = labOut("lab-helpers", "filmstrip");
    rmSync(dir, { recursive: true, force: true });
    const frames = await filmstrip(page, dir, { frames: 4, stepMs: 150 });
    assert.equal(frames.length, 4);
    for (const [i, frame] of frames.entries()) {
      assert.ok(frame.file && existsSync(frame.file), `frame ${i}`);
      if (i > 0) assert.ok(frame.t >= frames[i - 1].t + 100, `frame ${i} at ${frame.t} ms`);
      assert.equal(typeof frame.pageMs, "number");
    }
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "frames.json"), "utf8")), frames);
    await context.close();
  });
});

describe("the pixel comparison", () => {
  test("sees a one-unit change at the default threshold, and reports the largest difference", async () => {
    const { context, page } = await open(`<main style="padding:20px"><div id="box" style="width:40px;height:40px;background:rgb(100,100,100)"></div></main>`);
    const dir = labOut("lab-helpers");
    mkdirSync(dir, { recursive: true });
    const [a, same, b] = ["a.png", "same.png", "b.png"].map((name) => join(dir, name));
    writeFileSync(a, await page.screenshot());
    writeFileSync(same, await page.screenshot());
    await page.evaluate(() => (document.getElementById("box").style.background = "rgb(101,100,100)"));
    writeFileSync(b, await page.screenshot());
    const unchanged = await compareImages(page, a, same);
    assert.equal(unchanged.differentPixels, 0);
    assert.equal(unchanged.maxChannelDiff, 0);
    const changed = await compareImages(page, a, b);
    assert.equal(changed.differentPixels, 1600);
    assert.equal(changed.maxChannelDiff, 1);
    assert.equal((await compareImages(page, a, b, { threshold: 2 })).differentPixels, 0);
    await context.close();
  });
});

describe("the focus-ring probe", () => {
  test("a focus outline or a focus shadow is a ring; a card's resting shadow and a removed outline are not", async () => {
    const { context, page } = await open(`<main>
      <a id="ringed" href="/a/">Link with the site's ring</a>
      <a id="shadow-card" href="/b/" class="card">Card link whose shadow is always there</a>
      <button id="tailwind-ring" class="tw-ring">Button with a focus shadow</button>
      <a id="thin" href="/c/" class="thin">Link with a 1 px outline</a>
    </main>
    <style>
      :focus-visible { outline: 2px solid #5EE6A3; outline-offset: 3px; }
      .card { box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
      .card:focus-visible { outline: none; }
      .tw-ring:focus-visible { outline: none; box-shadow: 0 0 0 2px #5EE6A3; }
      .thin:focus-visible { outline: 1px solid #5EE6A3; }
    </style>`);
    const stops = await tabStops(page);
    const ring = Object.fromEntries(stops.map((s) => [s.name, s.ring]));
    assert.deepEqual(ring, {
      "Link with the site's ring": true,
      "Card link whose shadow is always there": false,
      "Button with a focus shadow": true,
      "Link with a 1 px outline": false,
    });
    // The probe never moves focus.
    await page.keyboard.press("Tab");
    const before = await page.evaluate(() => document.activeElement.id);
    await focusInfo(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), before);
    await context.close();
  });

  test("a sticky bar stacked under the header hides focus too (the docs bar, §3.5); a bar beside it doesn't", async () => {
    const { context, page } = await open(`
      <header style="position:sticky;top:0;height:56px;background:#111;z-index:2">Header</header>
      <div style="position:sticky;top:56px;height:48px;background:#222;z-index:2">Docs bar</div>
      <aside style="position:fixed;top:0;right:0;width:120px;height:400px;background:#333;z-index:2">Side panel</aside>
      <main><div style="height:1200px"></div><a id="target" href="#x" style="display:inline-block;line-height:20px">Target link</a><div style="height:1200px"></div></main>`);
    /** Scrolls the link's top to `top` px from the top of the viewport, focuses it there and probes it. */
    const at = async (top) => {
      await page.evaluate((y) => {
        const link = document.getElementById("target");
        window.scrollTo(0, link.getBoundingClientRect().top + scrollY - y);
        link.focus({ preventScroll: true });
      }, top);
      const box = await page.evaluate(() => {
        const r = document.getElementById("target").getBoundingClientRect();
        return [Math.round(r.top), Math.round(r.bottom)];
      });
      return { box, ...(await focusInfo(page)) };
    };
    const under = await at(70);
    assert.deepEqual([under.fullyObscured, under.partlyObscured], [true, false], `under the docs bar (56-104 px): ${JSON.stringify(under.box)}`);
    const across = await at(95);
    assert.deepEqual([across.fullyObscured, across.partlyObscured], [false, true], `across the docs bar's edge: ${JSON.stringify(across.box)}`);
    const clear = await at(200);
    assert.deepEqual([clear.fullyObscured, clear.partlyObscured], [false, false], `below both bars, beside the side panel: ${JSON.stringify(clear.box)}`);
    await context.close();
  });
});

describe("the request log", () => {
  test("labels a request with the phase it was made in, not the one it finished in, and logs failed requests", async () => {
    let log;
    const { context, page } = await open(`<main><p>A page that asks for scripts after it loads</p></main>`, {
      install: async (page) => {
        await page.route(`${address}lazy.js`, async (route) => {
          await sleep(800);
          await route.fulfill({ contentType: "text/javascript", body: "window.lazy = 1;" });
        });
        await page.route(`${address}gone.js`, (route) => route.abort());
        log = recordRequests(page);
      },
    });
    await sleep(200);
    // After load, the page asks for a lazy chunk (answered 800 ms later) and one that fails...
    await page.evaluate(() => {
      for (const src of ["/lazy.js", "/gone.js"]) document.head.append(Object.assign(document.createElement("script"), { src }));
    });
    await sleep(100);
    // ...and the spec starts the approach phase before the chunk arrives.
    log.phase("approach");
    await sleep(1500);
    const byPath = Object.fromEntries(log.requests.map((r) => [r.path, r]));
    assert.equal(byPath["/"]?.phase, "load", JSON.stringify(log.requests));
    assert.equal(byPath["/lazy.js"]?.phase, "after-load", "requested after load, answered during the approach");
    assert.equal(byPath["/lazy.js"].failed, null);
    assert.ok(byPath["/lazy.js"].gzip > 0);
    assert.equal(byPath["/gone.js"]?.phase, "after-load", "a failed request is logged too");
    assert.match(byPath["/gone.js"].failed, /net::/);
    assert.deepEqual(
      { count: scriptsIn(log.requests, "after-load").count, failed: scriptsIn(log.requests, "after-load").failed },
      { count: 2, failed: 1 },
    );
    await context.close();
  });
});

describe("the page measures", () => {
  test("the footer is the site's footer (contentinfo), not a card's footer inside <main>", async () => {
    const { context, page } = await open(`<main>
        <article><p>A card</p><footer style="height:40px">The card's footer</footer></article>
        <blockquote><p>A quote</p><footer style="height:30px">Its source</footer></blockquote>
      </main>
      <div><footer style="height:300px;margin:0">The site's footer</footer></div>`);
    assert.equal((await measurePage(page)).footerHeight, 300);
    await context.close();
  });
});

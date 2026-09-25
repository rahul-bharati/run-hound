/**
 * focus-visible: Tab through every focusable element on the page and check that each one shows a
 * visible focus indicator: an outline (non-"none", width > 0, not transparent), or a box-shadow,
 * border, background or text-decoration that differs from its unfocused style (WCAG 2.4.7).
 */
import { PNG } from "pngjs";
import type { Page } from "playwright";
import type { Box, Check, CheckContext, DiscoveredForm, DiscoveredPage, Evidence, Fact, Scenario } from "../core/types.js";
import { checkResult, clip, evalIn, fieldName, FindingList, guarded, listOf, playwrightSpec, plural, scenarioFor, uniquePlaces } from "./lib/a11y-common.js";

const MAX_TABS = 300;
/** At most this many failing controls get their own frame (the finding still lists every one). */
const MAX_FRAMES = 6;
/** Evidence is recorded at this size: the desktop layout, with the facts panel still readable once a GIF is scaled. */
const RECORD_VIEWPORT = { width: 1024, height: 720 };
/**
 * A focus change this large (pixels that differ, and their share of the area around the control) is visible even
 * when no computed style changed. A text caret is hidden in the comparison, so it never counts.
 */
const VISIBLE_PIXELS = 40;
const VISIBLE_SHARE = 0.005;
/** Gap between a control and the mark drawn around it, so the control's own edge (and any focus style) stays visible. */
const MARK_GAP = 8;

/** The focused element's box in viewport pixels, grown by MARK_GAP on every side; null when nothing is focused. */
const FOCUSED_BOX = `(gap) => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x - gap, y: r.y - gap, width: r.width + 2 * gap, height: r.height + 2 * gap };
}`;

/** The style properties a page can use to show focus, as computed values. */
interface FocusStyle {
  outline: string;
  boxShadow: string;
  border: string;
  background: string;
  textDecoration: string;
}

interface FocusStep {
  /** Index of the element in the page's focus bookkeeping; -1 when focus is on the body. */
  index: number;
  selector: string;
  name: string;
  visible: boolean;
  focused: FocusStyle;
  unfocused: FocusStyle | null;
  /** 1-based position in the Tab order (set by tabThrough). */
  n: number;
  /** True for a dev-server overlay or toolbar (not part of the app; never reported). */
  devTool?: boolean;
}

type Known = { selector: string; name: string }[];

/**
 * Records resting styles, then presses Tab until focus wraps (or MAX_TABS) and describes each new tab stop.
 * `onStop` runs while focus is on the stop.
 */
async function tabThrough(page: Page, known: Known, onStop?: (step: FocusStep) => Promise<void>): Promise<FocusStep[]> {
  await evalIn(page, SNAPSHOT);
  const stops: FocusStep[] = [];
  const visited = new Set<number>();
  let previous = -2;
  let bodyHits = 0;
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press("Tab");
    const step = await evalIn<FocusStep>(page, STEP, known);
    if (step.index === -1) {
      if (++bodyHits > 1 || visited.size > 0) break;
      continue;
    }
    // Tab can stay on one element (date inputs have several segments); wrapping to an earlier one ends the pass.
    if (step.index === previous) continue;
    if (visited.has(step.index)) break;
    visited.add(step.index);
    previous = step.index;
    step.n = stops.length + 1;
    stops.push(step);
    await onStop?.(step);
  }
  return stops;
}

/**
 * Pixel proof for a frame: screenshots the area around the focused control, blurs it, screenshots the same area at
 * rest, and puts focus back. Counts pixels that differ by more than a faint anti-aliasing change. Null when the area
 * is off screen or the screenshots fail. The caret is hidden and transitions are finished in both screenshots.
 */
async function pixelsChangedByFocus(page: Page, box: Box): Promise<{ changed: number; total: number } | null> {
  const viewport = page.viewportSize();
  if (!viewport) return null;
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const clip = { x, y, width: Math.min(viewport.width, Math.ceil(box.x + box.width)) - x, height: Math.min(viewport.height, Math.ceil(box.y + box.height)) - y };
  if (clip.width < 2 || clip.height < 2) return null;
  try {
    const focused = PNG.sync.read(await page.screenshot({ clip, caret: "hide", animations: "disabled" }));
    await page.evaluate(`(() => { window.__rhRefocus = document.activeElement; document.activeElement?.blur?.(); })()`);
    const rest = PNG.sync.read(await page.screenshot({ clip, caret: "hide", animations: "disabled" }));
    if (focused.width !== rest.width || focused.height !== rest.height) return null;
    let changed = 0;
    for (let i = 0; i < focused.data.length; i += 4) {
      const d = Math.max(Math.abs(focused.data[i]! - rest.data[i]!), Math.abs(focused.data[i + 1]! - rest.data[i + 1]!), Math.abs(focused.data[i + 2]! - rest.data[i + 2]!));
      if (d > 24) changed++;
    }
    return { changed, total: focused.width * focused.height };
  } catch {
    return null;
  } finally {
    await page.evaluate(`window.__rhRefocus?.focus?.({ preventScroll: true })`).catch(() => undefined);
  }
}

/** Resting vs focused value of each style property that can show focus. */
function styleFacts(step: FocusStep): Fact[] {
  const rows: [string, keyof FocusStyle][] = [
    ["Outline", "outline"],
    ["Box-shadow", "boxShadow"],
    ["Border", "border"],
    ["Background", "background"],
  ];
  return rows.flatMap(([label, key]) => [
    { label: `${label} at rest`, value: clip(step.unfocused?.[key] ?? "unknown", 70) },
    { label: `${label} focused`, value: clip(step.focused[key], 70) },
  ]);
}

/**
 * Tabs through the page again on a fresh page: one annotated frame per failing control (up to MAX_FRAMES) and a GIF
 * of the Tab sequence around them. Returns the frames by tab position, and the GIF.
 */
async function recordEvidence(ctx: CheckContext, known: Known, stops: FocusStep[]): Promise<{ frames: Map<number, Evidence>; gif: Evidence }> {
  const failing = stops.filter((s) => !s.visible).map((s) => s.n);
  // The GIF shows the failing stops, plus the first stop and the stop before each failure as context, at most 12.
  const chosen = new Set<number>([1]);
  for (const n of failing) {
    if (chosen.size >= 11) break;
    if (n > 1 && chosen.size < 10) chosen.add(n - 1);
    chosen.add(n);
  }
  const names = stops.filter((s) => !s.visible).map((s) => s.name);
  const summary: Fact[] = [
    { label: "Tab stops", value: String(stops.length) },
    { label: "No visible focus on", value: clip(names.join(", "), 200) },
  ];

  const { page } = await ctx.openPage({ viewport: RECORD_VIEWPORT });
  ctx.step("Recording the Tab sequence", page);
  const recording = ctx.record(page, "Tab sequence");
  const frames = new Map<number, Evidence>();
  await tabThrough(page, known, async (step) => {
    const wanted = chosen.has(step.n);
    const failed = !step.visible && failing.includes(step.n);
    if (!wanted && !(failed && frames.size < MAX_FRAMES)) return;
    // A box around the control rather than its selector: the mark stays clear of the control's own edge.
    const box = await evalIn<Box | null>(page, FOCUSED_BOX, MARK_GAP);
    const label = `Tab ${step.n}: ${clip(step.name, 30)}`;
    ctx.step(label, page);
    const mark = box ? [{ box, label: "No visible focus" }] : [];
    if (failed && frames.size < MAX_FRAMES) {
      // Computed styles can miss a ring drawn some other way; comparing the pixels themselves settles it.
      const pixels = box ? await pixelsChangedByFocus(page, box) : null;
      const frame = await ctx.capture(page, `Focus on ${step.name}`, {
        step: `${label} (focused)`,
        highlights: mark,
        facts: [
          ...(pixels ? [{ label: "Pixels that change on focus", value: `${pixels.changed} of ${pixels.total} around the control (focused vs blurred screenshot)` }] : []),
          ...styleFacts(step),
          ...summary,
        ],
        caption: `"${step.name}" has keyboard focus, but its outline, shadow, border and background look the same as at rest.`,
      });
      frames.set(step.n, frame);
    }
    if (wanted) {
      await recording.step(failed ? `${label}: no visible focus` : `${label}: focus visible`, {
        // Only failures are marked, so a visible focus ring is never covered.
        highlights: failed ? mark : [],
        facts: summary,
      });
    }
  });
  return { frames, gif: await recording.finish({ label: "Tab sequence through the page" }) };
}

/**
 * Records every focusable element's resting styles before any Tab is pressed. Anything already focused
 * (autofocus) is blurred first, so a focused element's own focus ring is never taken for its resting style.
 */
const SNAPSHOT = `() => {
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement && active.blur) active.blur();
  const style = (el) => {
    const s = getComputedStyle(el);
    return {
      outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow,
      borderStyle: s.borderStyle, borderWidth: s.borderWidth, borderColor: s.borderColor,
      background: s.backgroundColor + " " + s.backgroundImage, textDecoration: s.textDecorationLine + " " + s.textDecorationColor,
    };
  };
  const map = new Map();
  const sel = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]';
  for (const el of document.querySelectorAll(sel)) map.set(el, style(el));
  window.__rhFocus = { baseline: map, ids: new Map() };
  return map.size;
}`;

/**
 * Hosts of dev-server overlays and toolbars (Next.js, Vite, Astro, Nuxt, webpack) that a dev build injects into the
 * page. They are not part of the app, so their focus styles are never reported.
 */
export const DEV_TOOL_HOSTS = ["nextjs-portal", "vite-error-overlay", "astro-dev-toolbar", "astro-dev-overlay", "nuxt-devtools-frame", "#__nuxt_devtools__", "#webpack-dev-server-client-overlay", "#__next-build-watcher", "[data-nextjs-toast]", "[data-nextjs-dev-tools-button]"];

/** Describes the focused element and whether its focus indicator is visible. */
const STEP = `(known) => {
  const empty = { outline: "", boxShadow: "", border: "", background: "", textDecoration: "" };
  const devHosts = ${JSON.stringify(DEV_TOOL_HOSTS.join(","))};
  let el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { index: -1, selector: "", name: "", visible: true, focused: empty, unfocused: null };
  // Dev-server overlays live in their own element (often with a shadow root): not the app, never reported.
  if (el.closest(devHosts)) {
    const state = window.__rhFocus;
    if (!state.ids.has(el)) state.ids.set(el, state.ids.size);
    return { index: state.ids.get(el), selector: el.tagName.toLowerCase(), name: el.tagName.toLowerCase() + " (dev tools)", visible: true, devTool: true, focused: empty, unfocused: null };
  }
  // Focus inside a component's shadow root: judge the element that really has focus.
  while (el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  const state = window.__rhFocus;
  if (!state.ids.has(el)) state.ids.set(el, state.ids.size);
  const s = getComputedStyle(el);
  const now = {
    outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow,
    borderStyle: s.borderStyle, borderWidth: s.borderWidth, borderColor: s.borderColor,
    background: s.backgroundColor + " " + s.backgroundImage, textDecoration: s.textDecorationLine + " " + s.textDecorationColor,
  };
  const before = state.baseline.get(el) || null;
  const transparent = (c) => c === "transparent" || /rgba\\([^)]*,\\s*0\\)$/.test(c);
  const outlineShown = now.outlineStyle !== "none" && parseFloat(now.outlineWidth) > 0 && !transparent(now.outlineColor);
  const outlineChanged = !before || before.outlineStyle === "none" || parseFloat(before.outlineWidth) === 0 ||
    before.outlineStyle !== now.outlineStyle || before.outlineWidth !== now.outlineWidth || before.outlineColor !== now.outlineColor;
  const changed = (key) => !!before && before[key] !== now[key];
  const shadowShown = now.boxShadow !== "none" && (!before || before.boxShadow !== now.boxShadow);
  // A border, background or underline change is a visible focus indicator too.
  const otherShown = changed("borderStyle") || changed("borderWidth") || changed("borderColor") || changed("background") || changed("textDecoration");
  let match = known.find((k) => { const t = document.querySelector(k.selector); return t && (t === el || t.contains(el)); });
  let name = match ? match.name : "";
  if (!name) {
    const labelled = el.getAttribute("aria-labelledby");
    name = el.getAttribute("aria-label") ||
      (labelled ? labelled.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ") : "") ||
      (el.labels && el.labels[0] ? el.labels[0].textContent : "") || el.getAttribute("placeholder") || el.textContent || el.getAttribute("title") || el.tagName.toLowerCase();
    name = name.replace(/\\s+/g, " ").trim().slice(0, 80);
  }
  const selector = el.id ? "#" + CSS.escape(el.id) : (match ? match.selector : el.tagName.toLowerCase());
  const fmt = (x) => ({
    outline: x.outlineStyle + " " + x.outlineWidth + " " + x.outlineColor,
    boxShadow: x.boxShadow,
    border: x.borderStyle + " " + x.borderWidth + " " + x.borderColor,
    background: x.background,
    textDecoration: x.textDecoration,
  });
  return {
    index: state.ids.get(el), selector, name,
    visible: (outlineShown && outlineChanged) || shadowShown || otherShown,
    focused: fmt(now),
    unfocused: before ? fmt(before) : null,
  };
}`;

export const check: Check = {
  id: "focus-visible",
  title: "Keyboard focus is always visible",
  category: "accessibility",
  // Tab walks the whole page, whatever form it starts from: once per page.
  scope: "page",

  plan(form: DiscoveredForm, page?: DiscoveredPage): Scenario[] {
    const anything = page
      ? page.forms.some((f) => f.fields.length > 0 || f.controls.length > 0) || page.controls.length > 0
      : form.fields.length > 0 || form.controls.length > 0;
    if (!anything) return [];
    return [
      scenarioFor("focus-visible", "tab-through", {
        title: "Tab through every control and look for a focus indicator",
        description: "Presses Tab through the whole page and checks each focused control shows a visible outline or focus ring.",
        priority: "high",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("focus-visible", scenario, async (startedAt) => {
      const findings = new FindingList("focus-visible", "accessibility");
      const { page } = await ctx.openPage();
      // Names for every control Run Hound discovered: all forms and the controls outside them (V1), else the form.
      const forms = ctx.discoveredPage?.forms ?? [ctx.form];
      const known = [
        ...forms.flatMap((form) => form.fields.map((f) => ({ selector: f.selector, name: fieldName(f) }))),
        ...forms.flatMap((form) => form.controls.map((c) => ({ selector: c.selector, name: c.accessibleName ?? c.text }))),
        ...(ctx.discoveredPage?.controls ?? []).map((c) => ({ selector: c.selector, name: c.accessibleName ?? c.text })),
      ];
      ctx.step("Pressing Tab through every control", page);
      // Computed styles miss native focus cues (a date field highlights its first segment): a control whose styles
      // look unchanged is only reported when its pixels don't change either.
      const stops = await tabThrough(page, known, async (step) => {
        if (step.visible) return;
        const box = await evalIn<Box | null>(page, FOCUSED_BOX, MARK_GAP);
        const pixels = box ? await pixelsChangedByFocus(page, box) : null;
        if (pixels && pixels.changed >= VISIBLE_PIXELS && pixels.changed / pixels.total >= VISIBLE_SHARE) step.visible = true;
      });
      const failing = stops.filter((s) => !s.visible);
      const { frames, gif } = failing.length > 0 ? await recordEvidence(ctx, known, stops) : { frames: new Map<number, Evidence>(), gif: null };

      if (failing.length > 0) {
        // One problem, however many controls it affects: one finding listing every control in Tab order.
        const places = uniquePlaces(failing.map((step) => ({ name: step.name, selector: step.selector })));
        const many = failing.length > 1;
        const evidence: Evidence[] = [
          {
            kind: "dom",
            label: many ? `Computed focus styles of the ${failing.length} controls` : `Computed focus styles of ${failing[0]!.selector}`,
            data: failing.map((step) => ({ tabStop: step.n, name: step.name, selector: step.selector, focused: step.focused, unfocused: step.unfocused })),
          },
        ];
        for (const step of failing) {
          const frame = frames.get(step.n);
          if (frame) evidence.push(frame);
        }
        if (gif) evidence.push(gif);
        const names = listOf(failing.map((step) => step.name));
        const selectors = failing.map((step) => step.selector);
        findings.add({
          title: many ? `No visible focus indicator on ${failing.length} controls` : `No visible focus indicator on "${failing[0]!.name}"`,
          severity: "high",
          meaning: `When someone moves to ${names} with the Tab key, nothing on screen shows that ${many ? "the control" : "it"} is focused, so keyboard users can't tell where they are.${many ? ` ${plural(failing.length, "control")} in total, in Tab order.` : ""}`,
          impact: "People who use a keyboard instead of a mouse (including many people with motor or vision impairments) get lost in the form and may type into the wrong field.",
          fix: `Don't remove the focus outline without a replacement on ${many ? "these controls" : `"${failing[0]!.name}"`} (${clip(selectors.join(", "), 200)}). Add a clear :focus-visible style, for example outline: 3px solid <brand colour>; outline-offset: 2px (a visible border, background or ring change works too).`,
          location: places[0]!,
          ...(many ? { locations: places } : {}),
          evidence,
          spec: playwrightSpec(
            "focus-visible",
            findings.items.length + 1,
            many ? `every control shows a visible focus indicator` : `${failing[0]!.name} shows a visible focus indicator`,
            ctx.targetUrl,
            `const indicator = (e: Element) => {
  const s = getComputedStyle(e);
  return {
    outlineShown: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0,
    style: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderStyle, s.borderWidth, s.borderColor, s.backgroundColor, s.textDecorationLine].join(" | "),
  };
};
for (const selector of ${JSON.stringify(selectors)}) {
  await page.goto(TARGET, { waitUntil: "networkidle" });
  const el = page.locator(selector).first();
  const resting = await el.evaluate(indicator);
  for (let i = 0; i < ${MAX_TABS}; i++) {
    await page.keyboard.press("Tab");
    if (await el.evaluate((e) => e === document.activeElement)) break;
  }
  const focused = await el.evaluate(indicator);
  // Focus must either draw an outline or change something visible about the control.
  expect(focused.outlineShown || focused.style !== resting.style, selector).toBe(true);
}`,
          ),
        });
      }
      return checkResult("focus-visible", scenario, startedAt, findings.items, `Tabbed through ${stops.length} focusable element${stops.length === 1 ? "" : "s"}`);
    });
  },
};

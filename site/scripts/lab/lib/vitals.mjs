/**
 * Lab vitals: LCP (time and element) and CLS, recorded from navigation. Install before goto(), read after.
 * Ported from site-design/evidence/scripts/measure.mjs and judge-eng/judge-measure.mjs (one method for every spec).
 */

/** Records LCP and layout shifts on every page the context opens. */
export async function installVitals(page) {
  await page.addInitScript(() => {
    window.__lcp = null;
    window.__cls = 0;
    window.__shifts = [];
    // The element as "tag#id: its text", or an image's address without the lab's origin and port, so two runs on two
    // ports describe it the same way.
    const describe = (element) => {
      if (!element) return null;
      const id = element.id ? `#${element.id}` : "";
      const source = element.currentSrc ? element.currentSrc.replace(location.origin, "") : "";
      const text = (element.innerText || source || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
      return `${element.tagName.toLowerCase()}${id}: ${text}`;
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = { t: Math.round(entry.startTime), el: describe(entry.element), tag: entry.element?.tagName.toLowerCase() ?? null };
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        window.__shifts.push({ value: entry.value, t: Math.round(entry.startTime) });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** LCP ({ t, el, tag }), CLS (rounded to 4 places) and the shifts, so far. */
export function readVitals(page) {
  return page.evaluate(() => ({ lcp: window.__lcp, cls: Math.round(window.__cls * 10000) / 10000, shifts: window.__shifts }));
}

/** Navigation timing: DOMContentLoaded and load, in ms from navigation start. */
export function readTiming(page) {
  return page.evaluate(() => {
    const [nav] = performance.getEntriesByType("navigation");
    return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) };
  });
}

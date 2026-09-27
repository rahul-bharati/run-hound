"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PrefetchScreenshots } from "@/components/screenshot";

export type TourTab = { id: string; label: string; title: string; text: string; image: ReactNode };

/**
 * "See it run": one tab per step of a real run. The images are rendered on the server and passed in; panels that
 * aren't shown stay hidden. Arrow keys, Home and End move between tabs, as in the WAI-ARIA tabs pattern.
 *
 * The hidden panels' screenshots are lazy, so on their own they would only start downloading when their tab is
 * opened. Instead the next tab's starts early, at low priority, once the tour is within about a viewport of the screen
 * (and the page itself has loaded; not with Data Saver on) and the visible tab's images have loaded, so it never
 * competes with the first paint or with the image the visitor is looking at. Once the visitor clicks or hovers a tab,
 * the rest follow one at a time, next tab first, each only when every image already on its way has loaded, so a click
 * never makes the image it shows share the link with a new one. All of them start as soon as a tab gets focus, and a
 * tab's own image as soon as the tab is hovered. Each is the panel's own <img>, loaded eagerly instead of lazily, so
 * it picks the same file from its srcset and nothing is fetched twice.
 *
 * The cost: a visitor who scrolls past without opening a tab downloads one more image per tour (the next tab's), not
 * every tab's.
 */
export function Tour({ tabs, label = "Steps of a real run" }: { tabs: TourTab[]; label?: string }) {
  const [active, setActive] = useState(0);
  const [near, setNear] = useState(false);
  // Until the visitor clicks or hovers a tab, only one hidden tab's image starts early.
  const [engaged, setEngaged] = useState(false);
  // The tabs whose images have started early (next in line, hovered or focused). A started image stays eager, so
  // switching tabs never turns one that is downloading back into a lazy one.
  const [started, setStarted] = useState<ReadonlySet<number>>(() => new Set());
  const last = tabs.length - 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    // With Data Saver on, only hovering or focusing the tabs starts their images early.
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    let observer: IntersectionObserver | undefined;
    const observe = () => {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          setNear(true);
          observer?.disconnect();
        },
        { rootMargin: "100% 0px" },
      );
      observer.observe(root);
    };
    if (document.readyState === "complete") observe();
    else window.addEventListener("load", observe, { once: true });
    return () => {
      window.removeEventListener("load", observe);
      observer?.disconnect();
    };
  }, []);

  // Once near, the next tab after the visible one whose image hasn't started starts, only when every image already
  // on its way (the visible tab's and the started ones) has loaded.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !near || (!engaged && started.size >= Math.min(1, last))) return;
    const next = Array.from({ length: last }, (_, d) => (active + d + 1) % tabs.length).find((i) => !started.has(i));
    if (next === undefined) return;
    const panels = [...root.querySelectorAll<HTMLElement>(':scope > [role="tabpanel"]')];
    const waiting = [active, ...started]
      .flatMap((i) => [...(panels[i]?.querySelectorAll("img") ?? [])])
      .filter((img) => !img.complete);
    const advance = () => setStarted((current) => new Set(current).add(next));
    if (waiting.length === 0) {
      const id = requestAnimationFrame(advance);
      return () => cancelAnimationFrame(id);
    }
    let left = waiting.length;
    const done = () => {
      left -= 1;
      if (left === 0) advance();
    };
    for (const img of waiting) {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    }
    return () => {
      for (const img of waiting) {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
      }
    };
  }, [near, engaged, started, active, last, tabs.length]);

  /** A hidden tab's image loads eagerly once it has started (next in line, hovered or focused). */
  const eager = (i: number) => i !== active && started.has(i);

  function start(...indices: number[]) {
    setStarted((current) =>
      indices.every((i) => current.has(i)) ? current : new Set([...current, ...indices]),
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next =
      event.key === "ArrowRight"
        ? (active + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (active - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label={label}
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
      >
        {tabs.map((tab, i) => {
          const selected = i === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                setActive(i);
                setEngaged(true);
              }}
              onKeyDown={onKeyDown}
              onPointerEnter={() => {
                start(i);
                setEngaged(true);
              }}
              // From a focused tab the arrow keys, Home and End reach every other tab.
              onFocus={() => start(...tabs.keys())}
              className={`flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl border px-4 py-2 text-[15px] font-semibold transition-colors ${
                selected
                  ? "border-accent/60 bg-accent/10 text-fg"
                  : "border-line-strong text-muted hover:border-accent/50 hover:text-fg"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-6 place-items-center rounded-md font-mono text-xs ${
                  selected ? "bg-accent text-accent-ink" : "border border-line-strong text-dim"
                }`}
              >
                {i + 1}
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={i !== active}
          className="flex flex-col gap-5"
        >
          <div className="flex max-w-3xl flex-col gap-2">
            <h3 className="font-display text-2xl font-bold tracking-tight">{tab.title}</h3>
            <p className="leading-relaxed text-muted">{tab.text}</p>
          </div>
          <PrefetchScreenshots value={eager(i)}>{tab.image}</PrefetchScreenshots>
        </div>
      ))}
    </div>
  );
}

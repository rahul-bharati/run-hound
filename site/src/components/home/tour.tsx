"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type TourTab = { id: string; label: string; title: string; text: string; image: ReactNode };

/**
 * "See it run": one tab per step of a real run. The images are rendered on the server and passed in; panels that
 * aren't shown stay hidden, so their (lazy) images load only when someone opens that tab. Arrow keys, Home and
 * End move between tabs, as in the WAI-ARIA tabs pattern.
 */
export function Tour({ tabs }: { tabs: TourTab[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = tabs.length - 1;
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
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Steps of a real run"
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
              onClick={() => setActive(i)}
              onKeyDown={onKeyDown}
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
          {tab.image}
        </div>
      ))}
    </div>
  );
}

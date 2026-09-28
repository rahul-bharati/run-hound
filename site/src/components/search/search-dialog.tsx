"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { countText, emptyParts, excerptParts, nextIndex } from "./search-logic";

/** The part of Pagefind 1.5.2's search API (pagefind.js, written by scripts/pagefind.mjs) the dialog uses. */
type Fragment = {
  url: string;
  excerpt: string;
  meta: { title?: string; group?: string };
  sub_results?: { title: string; url: string; excerpt: string }[];
};
type Pagefind = {
  options(options: { excerptLength?: number }): Promise<void>;
  init(): Promise<void>;
  debouncedSearch(
    term: string,
    options: object,
    debounceMs: number,
  ): Promise<null | { results: { id: string; data(): Promise<Fragment> }[] }>;
};

type Hit = { url: string; title: string; group: string; excerpt: string; subs: { url: string; title: string }[] };

/** Results shown at once; the status counts them all. */
const SHOWN = 8;
/** The status waits for the reader to pause (§3.16). */
const DEBOUNCE_MS = 300;

let api: Promise<Pagefind> | undefined;

/**
 * Pagefind's search API, from where the index is served (/pagefind/, never bundled), loaded once when the dialog first
 * opens, so its WASM is warm by the first keystroke. A failed load is forgotten, so the next query tries again.
 */
function loadPagefind(): Promise<Pagefind> {
  api ??= (
    // @ts-expect-error: pagefind.js is served at run time from the search index, not a module of the build.
    import(/* webpackIgnore: true */ "/pagefind/pagefind.js") as Promise<Pagefind>
  ).then(async (pagefind) => {
    await pagefind.options({ excerptLength: 18 });
    await pagefind.init();
    return pagefind;
  });
  api.catch(() => {
    api = undefined;
  });
  return api;
}

const toHit = (fragment: Fragment): Hit => ({
  url: fragment.url,
  title: fragment.meta.title ?? fragment.url,
  group: fragment.meta.group ?? "Page",
  excerpt: fragment.excerpt,
  subs: (fragment.sub_results ?? [])
    .filter((sub) => sub.url !== fragment.url && sub.url.includes("#"))
    .slice(0, 3)
    .map((sub) => ({ url: sub.url, title: sub.title })),
});

function Excerpt({ text }: { text: string }) {
  return (
    <span className="search-excerpt">
      {excerptParts(text).map((part, i) => (part.mark ? <mark key={i}>{part.text}</mark> : part.text))}
    </span>
  );
}

/**
 * The search dialog (DESIGN.md §3.16): a native modal <dialog> over Pagefind's index. Its h2 names it, the field is
 * labelled, and its own status announces the count once the reader pauses. Arrow keys move between the field and the
 * results, Enter follows one, Escape closes it; focus then returns to where it was before it opened.
 */
export function SearchDialog({
  open,
  docs,
  onClose,
  returnFocus,
}: {
  open: boolean;
  docs: string;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null> | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const searchId = useRef(0);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<{ query: string; count: number; hits: Hit[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      field.current?.focus();
      loadPagefind().catch(() => {});
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const search = (value: string) => {
    setQuery(value);
    const term = value.trim();
    const current = ++searchId.current;
    if (!term) {
      setShown(null);
      return;
    }
    loadPagefind()
      .then(async (pagefind) => {
        const response = await pagefind.debouncedSearch(term, {}, DEBOUNCE_MS);
        if (!response || current !== searchId.current) return;
        const fragments = await Promise.all(response.results.slice(0, SHOWN).map((result) => result.data()));
        if (current !== searchId.current) return;
        setProblem(null);
        setShown({ query: term, count: response.results.length, hits: fragments.map(toHit) });
      })
      .catch(() => {
        if (current !== searchId.current) return;
        setProblem(
          process.env.NODE_ENV === "production"
            ? "Search couldn't load. Check your connection, then type again."
            : "Search works in production builds.",
        );
      });
  };

  const close = () => dialog.current?.close();

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    // Escape closes the dialog at once. Left to the browser, the first Escape in a search field that holds text only
    // clears the text.
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const stops = [field.current, ...(dialog.current?.querySelectorAll<HTMLElement>("[data-result]") ?? [])].filter(
      (stop): stop is HTMLElement => stop !== null,
    );
    if (stops.length < 2) return;
    event.preventDefault();
    stops[nextIndex(stops.indexOf(document.activeElement as HTMLElement), stops.length, event.key)]?.focus();
  };

  const status = problem ?? (shown ? countText(shown.count) : "");
  const empty = shown && shown.count === 0 && !problem ? emptyParts(shown.query) : null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      data-query={shown?.query}
      className="search-dialog"
      onClose={() => {
        onClose();
        const back = returnFocus?.current;
        if (back?.isConnected) back.focus();
      }}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself, outside its panel) closes it.
        if (event.target === dialog.current) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="search-panel">
        <div className="flex items-center justify-between gap-4">
          <h2 id={`${id}-title`} className="text-body font-semibold text-fg">
            Search the docs, checks and FAQ
          </h2>
          <button type="button" onClick={close} className="search-close">
            Close
          </button>
        </div>
        <label htmlFor={`${id}-field`} className="sr-only">
          Search
        </label>
        <input
          ref={field}
          id={`${id}-field`}
          type="search"
          value={query}
          onChange={(event) => search(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className="search-field"
        />
        <p role="status" className="text-small text-muted">
          {status}
        </p>
        {empty ? (
          <p className="text-small text-muted">
            {empty.before}
            <Link href={docs} prefetch={false} onClick={close} className="search-docs-link">
              {empty.link}
            </Link>
            {empty.after}
          </p>
        ) : null}
        {shown && shown.hits.length > 0 ? (
          <ul className="search-results">
            {shown.hits.map((hit) => (
              <li key={hit.url}>
                <Link href={hit.url} prefetch={false} onClick={close} data-result="" className="search-result">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-fg">{hit.title}</span>
                    <span className="tag">{hit.group}</span>
                  </span>
                  <Excerpt text={hit.excerpt} />
                </Link>
                {hit.subs.length > 0 ? (
                  <ul className="search-subs">
                    {hit.subs.map((sub) => (
                      <li key={sub.url}>
                        <Link href={sub.url} prefetch={false} onClick={close} data-result="" className="search-sub">
                          {sub.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </dialog>
  );
}

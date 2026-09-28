"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { isSearchShortcut } from "./search-logic";

// The dialog is its own chunk, fetched on first open (or warmed when the pointer or focus reaches the trigger), so it
// adds nothing to any page's initial HTML or JS (DESIGN.md §3.16; scripts/check-budgets.mjs sizes it with pagefind.js).
const loadDialog = () => import("./search-dialog").then((module) => module.SearchDialog);
const SearchDialog = dynamic(loadDialog, { ssr: false });

/**
 * The header's Search button and the Ctrl+K / ⌘K shortcut (§3.2). Server-rendered: from 1280 px it reads "Search" with
 * the hint "Ctrl K" (both part of its name, "Search Ctrl K"); below, a 44 px icon button named "Search". `docs` is the
 * docs hub, which the empty state points to.
 */
export function SearchTrigger({ docs }: { docs: string }) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const isOpen = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Where focus was before the dialog opened: it goes back there when the dialog closes. A click that moves no focus
  // (Safari, macOS Firefox) leaves it on <body>; the trigger stands in, not the top of the page.
  const returnFocus = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    if (isOpen.current) return;
    isOpen.current = true;
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : trigger.current;
    setRequested(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      event.preventDefault();
      show();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show]);

  const warm = () => {
    void loadDialog();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-search-trigger=""
        aria-keyshortcuts="Control+K Meta+K"
        onClick={show}
        onPointerEnter={warm}
        onFocus={warm}
        className="search-trigger"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="shrink-0">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <span className="max-xl:sr-only">Search</span>{" "}
        <kbd className="search-trigger-hint max-xl:hidden">Ctrl K</kbd>
      </button>
      {requested ? (
        <SearchDialog
          open={open}
          docs={docs}
          returnFocus={returnFocus}
          onClose={() => {
            isOpen.current = false;
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

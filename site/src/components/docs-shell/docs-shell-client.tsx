"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The docs shell's only client code (§3.5), a few hundred bytes with no data of its own (it reads the DOM):
 *
 * - "On this page" (the column from 1280 px): the marker follows the section in view. The current section is the last
 *   h2 whose top is above the anchor line (scroll-padding-top + 16 px). An IntersectionObserver whose root starts at
 *   that line (no scroll listener, no requestAnimationFrame, nothing at rest) watches the h2s and every other block of
 *   the article: an h2 crossing the line changes its ratio from 1, and after a jump (Page Down, End, the scrollbar)
 *   the block now across the line changes its own, so the pick runs whenever the answer can change (and the footer
 *   coming whole into view runs it at the end of the page). The pick moves
 *   aria-current="location" to that section's link, and sets --marker-y (its ring's offset from the first ring) and
 *   data-ready on the trail, which moves the marker in 180 ms by CSS (at once while focus is in the list; globals.css).
 *   At the end of the page the last section is current.
 * - The docs bar (below 1024 px): following a link in an open panel closes it, and Escape closes it and returns focus to
 *   its summary. Without JavaScript the <details> still open and close.
 */
export function DocsShellClient() {
  // A client-side move to another docs page reads that page's headings again.
  const pathname = usePathname();
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    const wrap = document.querySelector<HTMLElement>(".docs-toc .step-trail-wrap");
    const links = wrap ? [...wrap.querySelectorAll<HTMLAnchorElement>("a.step-label")] : [];
    const targets = links.map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))));
    if (wrap && links.length > 0 && targets.every(Boolean)) {
      let current = -1;
      const show = (index: number) => {
        if (index === current) return;
        current = index;
        links.forEach((link, i) => (i === index ? link.setAttribute("aria-current", "location") : link.removeAttribute("aria-current")));
        const first = links[0].closest("li");
        const step = links[index].closest("li");
        if (first && step) wrap.style.setProperty("--marker-y", `${step.offsetTop - first.offsetTop}px`);
        wrap.setAttribute("data-ready", "");
      };
      const anchorLine = () => Math.round((parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + 16);
      const pick = () => {
        const line = anchorLine();
        const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
        let index = 0;
        targets.forEach((target, i) => {
          if (target && target.getBoundingClientRect().top < line) index = i;
        });
        show(atEnd && targets.at(-1)!.getBoundingClientRect().top < window.innerHeight ? targets.length - 1 : index);
      };
      const observer = new IntersectionObserver(pick, { rootMargin: `-${anchorLine()}px 0px 0px 0px`, threshold: [0, 1] });
      // The site footer is last on the page: it is whole in view exactly when the page reaches its end, so a jump to
      // the end (End, a flick) runs the pick there even when no block crosses the line on the final frame.
      const blocks = document.querySelector(".docs-article .prose-doc")?.children ?? [];
      const footer = document.querySelector(".site-footer");
      for (const element of new Set([...targets, ...blocks, footer])) if (element) observer.observe(element);
      window.addEventListener("hashchange", pick);
      pick();
      cleanups.push(() => {
        observer.disconnect();
        window.removeEventListener("hashchange", pick);
      });
    }

    const bar = document.querySelector<HTMLElement>("[data-docs-bar]");
    if (bar) {
      const close = (details: HTMLDetailsElement, focus: boolean) => {
        details.open = false;
        if (focus) details.querySelector("summary")?.focus();
      };
      const onClick = (event: MouseEvent) => {
        const link = (event.target as Element).closest("a");
        const details = link?.closest("details");
        if (details) close(details, false);
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        const details = (event.target as Element).closest("details");
        if (details?.open) close(details, true);
      };
      bar.addEventListener("click", onClick);
      bar.addEventListener("keydown", onKey);
      cleanups.push(() => {
        bar.removeEventListener("click", onClick);
        bar.removeEventListener("keydown", onKey);
      });
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [pathname]);
  return null;
}

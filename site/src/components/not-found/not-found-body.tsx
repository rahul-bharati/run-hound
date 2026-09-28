"use client";

/**
 * The 404's body (DESIGN.md §3.13): "The trail goes cold here.", with the line hound walking a dim trail and lifting
 * its nose where it ends (§4.3, the page's one drawing), then the way back: Home, Docs, and the bug form with the
 * missing path as the issue title. Mint only on the h1's key words and the primary button (§2.3).
 *
 * Why a client component: Next.js puts the root not-found tree in every page's RSC payload (the root layout's
 * not-found boundary), and three times in the 404's own HTML, and every page loads the chunks of the client components
 * in it. As server markup the drawing, the copy and the links cost every page about 4 KB of HTML (1.1 KB gzip,
 * measured on the built /docs/ai/ and /compare/); as one client component with three string props they cost it one
 * module reference, the markup is in the 404's HTML once (rendered on the server as before), and the words and the
 * drawing ride in this module's chunk, cached after the first page. To keep that chunk small:
 * - the motion gate loads only when this renders (it renders nothing on the server anyway), so its code, and
 *   the loaders of every island it can mount, stay out of every other page. It is imported in an effect at hydration,
 *   not through next/dynamic: next/dynamic mounts through Suspense, whose reveal React throttles to 300 ms, and a
 *   Save-Data reader's hold must be released at hydration (§4.5; measured: next/dynamic released it 300 ms after the
 *   first commit, this about 30 ms after hydration);
 * - the two buttons and the report link are the primitives' markup written out (ButtonLink's classes on NavLink,
 *   TextLink's external-link markup), not their code;
 * - no stylesheet of its own (a CSS import here would be preloaded on every page too): utilities only.
 */
import { type ComponentType, useEffect, useState } from "react";
import { NavLink } from "@/components/primitives/nav-link";
import type { Island } from "@/motion/motion-gate";
import { notFoundCopy } from "./copy";
import { ReportBrokenLink } from "./report-link";
import { TrailFigure } from "./trail-figure";

type Gate = ComponentType<{ islands: readonly Island[] }>;

/** The motion gate for the 404's trail, fetched at hydration (see above); nothing until then, as on the server. */
function LazyMotionGate({ islands }: { islands: readonly Island[] }) {
  const [Gate, setGate] = useState<Gate | null>(null);
  useEffect(() => {
    let live = true;
    import("@/motion/motion-gate").then((mod) => {
      if (live) setGate(() => mod.MotionGate);
    }).catch(() => {
      // A failed chunk load (offline, a deploy skew) leaves the drawing to the CSS hold's 3 s fallback (§4.5).
    });
    return () => {
      live = false;
    };
  }, []);
  return Gate ? <Gate islands={islands} /> : null;
}

export function NotFoundBody({ home, docs, formUrl }: { home: string; docs: string; formUrl: string }) {
  const { title, report } = notFoundCopy;
  return (
    <div className="container-page flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center sm:py-20">
      <TrailFigure />
      <p className="font-mono text-mono text-dim">{notFoundCopy.label}</p>
      <h1 className="max-w-heading text-balance font-display text-display-xl text-fg">
        {title.lead}
        <span className="text-accent" data-accent-exempt="">
          {title.accent}
        </span>
      </h1>
      <p className="max-w-measure text-lead text-muted">{notFoundCopy.text}</p>
      <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
        {/* ButtonLink's primary and secondary markup (primitives/button-link.tsx): the primary is exempt from the
            accent budget. */}
        <NavLink href={home} className="btn btn-primary has-arrow" data-accent-exempt="">
          {notFoundCopy.home}
        </NavLink>
        <NavLink href={docs} className="btn btn-secondary">
          {notFoundCopy.docs}
        </NavLink>
      </div>
      <p className="report-line">
        {report.question} <ReportBrokenLink formUrl={formUrl}>{report.link}</ReportBrokenLink>
      </p>
      <LazyMotionGate islands={["trail-404"]} />
    </div>
  );
}

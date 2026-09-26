import type { ReactNode } from "react";

/** Fictional studio logos: a small geometric mark plus a wordmark, drawn in currentColor. */
const LOGOS: { name: string; mark: ReactNode }[] = [
  {
    name: "Northwind",
    mark: <path d="M4 26 16 6l12 20H4Zm6.5-4h11L16 12.7 10.5 22Z" fillRule="evenodd" />,
  },
  {
    name: "Paper Crane",
    mark: <path d="M3 18 16 6l4 9 9-3-7 13H11l-2-5-6-2Z" />,
  },
  {
    name: "Lumen&Co",
    mark: (
      <>
        <circle cx="16" cy="16" r="6" />
        <path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </>
    ),
  },
  {
    name: "Quarry",
    mark: <path d="M16 4 27 10v12l-11 6-11-6V10l11-6Zm0 6-6 3.4v6.9l6 3.4 6-3.4v-6.9L16 10Z" fillRule="evenodd" />,
  },
  {
    name: "Oakline",
    mark: <path d="M16 3c7 4 10 10 7 17-2 4-5 6-7 9-2-3-5-5-7-9-3-7 0-13 7-17Zm-1 8v14h2V11h-2Z" fillRule="evenodd" />,
  },
  {
    name: "Brightside",
    mark: <path d="M4 22a12 12 0 0 1 24 0H4Zm-1 3h26v3H3v-3Z" />,
  },
];

/** "Trusted by" strip: fictional logos (aria-hidden) with a visible caption that says what they are. */
export function LogoCloud() {
  return (
    <section data-section="logo-cloud" className="border-y border-border/70 bg-card/60 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-center text-sm font-medium text-muted-foreground">Trusted by 1,200+ small studios and agencies</p>
        <div aria-hidden="true" className="mt-6 grid grid-cols-2 place-items-center gap-x-6 gap-y-6 text-muted-foreground sm:grid-cols-3 lg:grid-cols-6">
          {LOGOS.map((logo) => (
            <svg
              key={logo.name}
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 150 32"
              className="h-7 w-full max-w-36 opacity-80 transition-opacity hover:opacity-100"
              fill="currentColor"
            >
              <g>{logo.mark}</g>
              <text x="36" y="22" fontSize="16" fontWeight="650" letterSpacing="-0.02em" fontFamily="inherit">
                {logo.name}
              </text>
            </svg>
          ))}
        </div>
      </div>
    </section>
  );
}

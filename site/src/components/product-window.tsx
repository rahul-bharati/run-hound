import Image from "next/image";
import type { ReactNode } from "react";
import { ChevronIcon, ClockIcon, ReloadIcon } from "@/components/home/icons";
import motion from "@/components/home/motion.module.css";

type RowStatus = "finding" | "pass" | "running" | "queued";

/**
 * Accessibility scenarios in V0's run order (app/src/core/types.ts), named as the plan names them.
 * On Kennel with its bugs switched on, the axe scan and the keyboard-only walk both report findings.
 */
const accessibility: { name: string; status: RowStatus; note?: string }[] = [
  { name: "Axe scan, every form state", status: "finding", note: "finding" },
  { name: "Keyboard only", status: "finding", note: "finding" },
  { name: "Focus is visible", status: "running", note: "tab 1 / 17" },
  { name: "Errors are announced", status: "queued" },
  { name: "Paste and autofill", status: "queued" },
  { name: "Fits a 320 px screen", status: "queued" },
];

const collapsed = [
  { name: "Features", count: 6 },
  { name: "Security", count: 3 },
];

const nav = [
  { name: "Target", active: false },
  { name: "Plan", active: false },
  { name: "Run", active: true },
  { name: "Report", active: false },
];

function StatusDot({ status }: { status: RowStatus }) {
  if (status === "pass") {
    return (
      <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
        <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="m2.5 6.2 2.2 2.2 4.8-4.9" />
        </svg>
      </span>
    );
  }
  if (status === "finding") {
    return (
      <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-fail font-mono text-[11px] font-bold text-bg-deep">
        !
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        className={`size-[18px] shrink-0 rounded-full border-2 border-accent/25 border-t-accent ${motion.spin}`}
      />
    );
  }
  return <span className="size-[18px] shrink-0 rounded-full border-[1.5px] border-line-strong" />;
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[11px] font-semibold text-paper-ink">{label}</span>
      {children}
    </div>
  );
}

const input = "flex h-7 items-center rounded-[5px] border border-[#6b7280] bg-white px-2 text-[11px] text-paper-muted";

/**
 * The V0 live view as a product window: plan groups on the left, the browser under test on the right.
 * Shows a run on Kennel, the deliberately broken demo app, three scenarios in.
 * With `tilt`, it sits in perspective on large screens (homepage hero).
 */
export function ProductWindow({ tilt = false }: { tilt?: boolean }) {
  return (
    <figure
      className={`relative overflow-hidden rounded-[18px] border border-line-strong bg-surface shadow-[0_50px_100px_-20px_rgba(0,0,0,0.7),0_0_0_1px_rgba(94,230,163,0.04)] ${
        tilt ? "lg:origin-left lg:[transform:perspective(2200px)_rotateY(-11deg)_rotateX(4deg)]" : ""
      }`}
    >
      <figcaption className="sr-only">
        Run Hound V0 running on Kennel, our deliberately broken demo app, at http://localhost:3150/book: scenario
        3 of 15. In the Accessibility group, the axe scan and the keyboard-only walk have findings, the focus
        check is running and three scenarios are queued. Features (6 scenarios) and Security (3) are next. The
        live browser shows the Book a sitter form with the Pet name field focused.
      </figcaption>

      <div aria-hidden="true">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-line bg-bg-deep/60 px-4 py-3">
          <span className="size-[11px] rounded-full bg-[#ff5f57]/80" />
          <span className="size-[11px] rounded-full bg-[#febc2e]/80" />
          <span className="size-[11px] rounded-full bg-[#28c840]/80" />
        </div>

        <div className="grid sm:grid-cols-[124px_minmax(0,1fr)] md:grid-cols-[124px_minmax(0,1fr)_minmax(0,0.92fr)]">
          {/* Mini nav */}
          <div className="hidden flex-col gap-1 border-r border-line bg-bg-deep/50 p-3 sm:flex">
            <div className="mb-3 flex items-center gap-2 px-1.5 py-1">
              <Image
                src="/brand/hound-mark-light-160.png"
                alt=""
                width={160}
                height={92}
                unoptimized
                className="h-auto w-8"
              />
              <span className="font-display text-[13px] font-extrabold leading-tight tracking-tight">Run Hound</span>
            </div>
            {nav.map((item, i) => (
              <span
                key={item.name}
                className={`flex items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] ${
                  item.active ? "bg-surface-3 text-fg" : "text-dim"
                }`}
              >
                <span
                  className={`grid size-[18px] place-items-center rounded-[5px] font-mono text-[10px] ${
                    item.active ? "bg-accent text-accent-ink" : "border border-line-strong"
                  }`}
                >
                  {i + 1}
                </span>
                {item.name}
              </span>
            ))}
            <span className="mt-auto px-2 pt-6 font-mono text-[10px] leading-relaxed text-dim">v0.1.0</span>
          </div>

          {/* Run */}
          <div className="flex min-w-0 flex-col gap-3.5 p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-[17px] font-bold tracking-tight">Running checks…</p>
              <p className="font-mono text-[12px] text-muted">
                <span className="text-fg">3</span> of 15
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className={`h-full w-[17%] rounded-full bg-accent ${motion.shimmer}`} />
              </div>
              <span className="flex items-center gap-1 font-mono text-[11px] text-dim">
                <ClockIcon size={12} />
                00:21
              </span>
            </div>

            <div className="flex flex-col">
              <div className="flex items-center justify-between border-b border-line-soft pb-2">
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  <ChevronIcon size={13} className="rotate-90 text-accent" />
                  Accessibility
                </span>
                <span className="font-mono text-[11px] text-dim">6 scenarios</span>
              </div>
              <ul className="flex flex-col py-1">
                {accessibility.map((row) => (
                  <li
                    key={row.name}
                    className={`flex items-center gap-2.5 rounded-md px-1.5 py-[7px] text-[12px] ${
                      row.status === "running" ? "bg-surface-3 text-fg" : row.status === "queued" ? "text-dim" : "text-fg"
                    }`}
                  >
                    <StatusDot status={row.status} />
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    {row.note ? (
                      <span
                        className={`shrink-0 font-mono text-[10.5px] ${
                          row.status === "finding" ? "text-fail" : "text-accent"
                        }`}
                      >
                        {row.note}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {collapsed.map((group) => (
                <div
                  key={group.name}
                  className="flex items-center justify-between border-t border-line-soft py-2.5 text-[12.5px]"
                >
                  <span className="flex items-center gap-1.5 text-muted">
                    <ChevronIcon size={13} className="text-dim" />
                    {group.name}
                  </span>
                  <span className="font-mono text-[11px] text-dim">{group.count} scenarios</span>
                </div>
              ))}
            </div>
          </div>

          {/* Live browser */}
          <div className="flex min-w-0 flex-col gap-2.5 border-t border-line bg-stage p-3.5 sm:col-span-2 md:col-span-1 md:border-l md:border-t-0">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] font-semibold">
                <span className={`size-2 rounded-full bg-accent ${motion.pulse}`} />
                Live browser
              </span>
              <span className="rounded-full border border-accent/40 px-2 py-0.5 font-mono text-[10px] text-accent">
                LIVE
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              <div className="flex items-center gap-2 bg-surface-2 px-2.5 py-1.5">
                <ReloadIcon size={11} className="text-dim" />
                <span className="min-w-0 flex-1 truncate rounded-md bg-bg-deep px-2 py-1 font-mono text-[10.5px] text-muted">
                  http://localhost:3150/book
                </span>
              </div>
              <div className="flex flex-col gap-2.5 bg-white px-3.5 py-3.5 text-paper-ink">
                <div>
                  <p className="text-[15px] font-bold leading-tight">Book a sitter</p>
                  <p className="mt-0.5 text-[9.5px] leading-snug text-paper-muted">
                    Tell us about your pet and when you&apos;re away.
                  </p>
                </div>
                <Field label="Pet name">
                  <span className={`${input} text-paper-ink`}>
                    <span className={motion.caret} />
                  </span>
                </Field>
                <Field label="Pet type">
                  <span className="flex gap-1.5">
                    {["Dog", "Cat", "Other"].map((o) => (
                      <span key={o} className="rounded-[5px] border border-[#6b7280] px-2 py-1 text-[10.5px]">
                        {o}
                      </span>
                    ))}
                  </span>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Start date">
                    <span className={input}>mm/dd/yyyy</span>
                  </Field>
                  <Field label="End date">
                    <span className={input}>mm/dd/yyyy</span>
                  </Field>
                </div>
                <Field label="Owner email">
                  <span className={input} />
                </Field>
                <span className="mt-0.5 flex gap-2">
                  <span className="rounded-[5px] bg-[#1d4ed8] px-3.5 py-1.5 text-[11px] font-medium text-white">Book</span>
                  <span className="rounded-[5px] border border-[#1d4ed8] px-3 py-1.5 text-[11px] text-[#1d4ed8]">
                    Save draft
                  </span>
                </span>
              </div>
            </div>
            <p className="truncate font-mono text-[10.5px] text-muted">
              <span className="text-accent">NOW</span> Tab 1: Pet name (focused)
            </p>
          </div>
        </div>
      </div>
    </figure>
  );
}

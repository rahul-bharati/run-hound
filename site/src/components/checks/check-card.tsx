import { SeverityLabel } from "@/components/finding";
import type { Check, Version } from "@/components/checks/data";

/** Small mono roadmap badge ("V0"). V0 is highlighted because it is in the tester preview now. */
export function VersionBadge({ version, note }: { version: Version; note?: string }) {
  const tone = version === "V0" ? "border-accent/60 text-accent" : "border-line-strong text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] tracking-widest ${tone}`}
    >
      <span className="sr-only">{version === "V0" ? "In " : "Planned for "}</span>
      {version}
      {note ? <span className="ml-1.5 lowercase tracking-normal text-dim">{note}</span> : null}
    </span>
  );
}

export function AdvisoryBadge() {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-line-strong px-2 py-0.5 font-mono text-[11px] tracking-widest text-muted">
      ADVISORY
    </span>
  );
}

/** One catalog entry: name, plain-language line, typical severity, roadmap version and signal phrase. */
export function CheckCard({ check }: { check: Check }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VersionBadge version={check.version} note={check.note} />
          {check.advisory ? <AdvisoryBadge /> : null}
        </div>
        <span className="flex items-center gap-1.5">
          <span className="sr-only">Typical severity:</span>
          <SeverityLabel severity={check.severity} />
        </span>
      </div>
      <h3 className="font-display text-lg font-bold leading-snug">{check.name}</h3>
      <p className="text-sm leading-relaxed text-muted">{check.line}</p>
      <p className="mt-auto border-t border-line-soft pt-3 font-mono text-xs text-dim">
        <span className="tracking-widest">SIGNAL</span> <span className="text-muted">{check.signal}</span>
      </p>
    </li>
  );
}

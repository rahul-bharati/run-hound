export type Severity = "critical" | "high" | "medium" | "low";
export type Status = "pass" | "fail" | "running" | "queued";

const severityColor: Record<Severity, string> = {
  critical: "text-fail",
  high: "text-fail",
  medium: "text-amber",
  low: "text-dim",
};

export function SeverityLabel({ severity }: { severity: Severity }) {
  return (
    <span className={`font-mono text-[11px] tracking-widest ${severityColor[severity]}`}>
      {severity.toUpperCase()}
    </span>
  );
}

const statusColor: Record<Status, string> = {
  pass: "text-pass",
  fail: "text-fail",
  running: "text-amber",
  queued: "text-dim",
};

export function StatusLabel({ status }: { status: Status }) {
  return <span className={`font-mono text-xs ${statusColor[status]}`}>{status}</span>;
}

/** Compact finding card, as shown in reports and mockups. */
export function FindingCard({
  category,
  severity,
  title,
  summary,
  evidence,
  titleAs = "h3",
}: {
  category: string;
  severity: Severity;
  title: string;
  summary: string;
  evidence?: string;
  /** Use "p" inside mockups so sample findings stay out of the page's heading outline. */
  titleAs?: "h3" | "p";
}) {
  const Title = titleAs;
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-3 font-mono text-[11px] tracking-widest">
        <span className="text-dim">{category.toUpperCase()}</span>
        <SeverityLabel severity={severity} />
      </div>
      <Title className="font-display text-lg font-bold leading-snug">{title}</Title>
      <p className="text-sm leading-relaxed text-muted">{summary}</p>
      {evidence ? <p className="font-mono text-xs text-dim">{evidence}</p> : null}
    </article>
  );
}

/** Full plain-language finding: what it means, why it matters, what to ask your AI. */
export function FindingDetail({
  category,
  severity,
  title,
  meaning,
  impact,
  fix,
  evidence,
  headingLevel = 3,
}: {
  category: string;
  severity: Severity;
  title: string;
  meaning: string;
  impact: string;
  fix: string;
  evidence?: string;
  /** Use 4 when the finding sits inside a section that already has an h3. */
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3 font-mono text-xs tracking-widest">
        <span className="text-dim">{category.toUpperCase()}</span>
        <SeverityLabel severity={severity} />
      </div>
      <Heading className="font-display text-2xl font-bold leading-tight">{title}</Heading>
      <dl className="grid gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <dt className="font-mono text-[11px] tracking-widest text-dim">WHAT THIS MEANS</dt>
          <dd className="text-[15px] leading-relaxed">{meaning}</dd>
        </div>
        <div className="flex flex-col gap-1.5">
          <dt className="font-mono text-[11px] tracking-widest text-dim">WHY IT MATTERS</dt>
          <dd className="text-[15px] leading-relaxed">{impact}</dd>
        </div>
        <div className="flex flex-col gap-1.5">
          <dt className="font-mono text-[11px] tracking-widest text-dim">ASK YOUR AI</dt>
          <dd className="text-[15px] leading-relaxed">{fix}</dd>
        </div>
      </dl>
      {evidence ? <p className="font-mono text-xs text-dim">{evidence}</p> : null}
    </article>
  );
}

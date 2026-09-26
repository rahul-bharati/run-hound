export type RoadmapStatus = "shipped" | "current" | "preview" | "planned";

export type RoadmapStage = {
  /** The stage label ("V0"): a stage of what Run Hound can test, never a release number. */
  stage: string;
  name: string;
  status: RoadmapStatus;
  /** The releases that built the stage, or will, as a label that says so ("Release 0.1.0", "Since 0.4.0"). */
  release?: string;
  summary: string;
  adds?: string;
};

const statusStyle: Record<RoadmapStatus, { card: string; pill: string; dot: string }> = {
  shipped: { card: "border-line", pill: "border-line-strong text-muted", dot: "bg-muted" },
  "current": { card: "border-accent/60", pill: "border-accent text-accent", dot: "bg-accent" },
  // Partly released: part of the stage ships in the current release, the rest is planned.
  preview: { card: "border-dashed border-accent/40", pill: "border-dashed border-accent/60 text-accent", dot: "bg-accent/60" },
  planned: { card: "border-line", pill: "border-line-strong text-dim", dot: "bg-line-strong" },
};

/** Vertical roadmap with a status label per stage. The current stage is lit; a stage in preview is outlined. */
export function RoadmapList({ stages }: { stages: readonly RoadmapStage[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {stages.map((stage) => {
        const style = statusStyle[stage.status];
        const current = stage.status === "current";
        return (
          <li
            key={stage.stage}
            aria-current={current ? "step" : undefined}
            className={`grid gap-4 rounded-2xl border bg-surface p-6 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-8 sm:p-7 ${style.card}`}
          >
            <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-start">
              <span className={`font-display text-3xl font-extrabold tracking-tight ${current ? "text-accent" : ""}`}>
                <span className="sr-only">Stage </span>
                {stage.stage}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-widest ${style.pill}`}
              >
                <span aria-hidden="true" className={`size-1.5 rounded-full ${style.dot}`} />
                {stage.status.toUpperCase()}
              </span>
              {stage.release ? <span className="font-mono text-xs text-dim">{stage.release}</span> : null}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-display text-xl font-bold">{stage.name}</h3>
              <p className="leading-relaxed text-muted">{stage.summary}</p>
              {stage.adds ? <p className="text-[15px] leading-relaxed text-dim">{stage.adds}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

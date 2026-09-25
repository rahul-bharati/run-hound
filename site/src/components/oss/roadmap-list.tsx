export type RoadmapStatus = "shipped" | "current" | "planned";

export type RoadmapStage = {
  version: string;
  name: string;
  status: RoadmapStatus;
  /** Release number, for stages that have one ("0.1.0"). */
  release?: string;
  summary: string;
  adds?: string;
};

const statusStyle: Record<RoadmapStatus, { card: string; pill: string; dot: string }> = {
  shipped: { card: "border-line", pill: "border-line-strong text-muted", dot: "bg-muted" },
  "current": { card: "border-accent/60", pill: "border-accent text-accent", dot: "bg-accent" },
  planned: { card: "border-line", pill: "border-line-strong text-dim", dot: "bg-line-strong" },
};

/** Vertical roadmap with a status label per stage. The current stage (the current release) is lit. */
export function RoadmapList({ stages }: { stages: readonly RoadmapStage[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {stages.map((stage) => {
        const style = statusStyle[stage.status];
        const current = stage.status === "current";
        return (
          <li
            key={stage.version}
            aria-current={current ? "step" : undefined}
            className={`grid gap-4 rounded-2xl border bg-surface p-6 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-8 sm:p-7 ${style.card}`}
          >
            <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-start">
              <span className={`font-display text-3xl font-extrabold tracking-tight ${current ? "text-accent" : ""}`}>
                {stage.version}
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

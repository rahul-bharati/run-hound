export type RoadmapStage = {
  version: string;
  name: string;
  status: "tester preview" | "planned";
  summary: string;
  adds?: string;
};

/** Vertical roadmap with a status label per stage. */
export function RoadmapList({ stages }: { stages: readonly RoadmapStage[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {stages.map((stage) => {
        const current = stage.status === "tester preview";
        return (
          <li
            key={stage.version}
            className={`grid gap-3 rounded-2xl border bg-surface p-6 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-8 sm:p-7 ${
              current ? "border-accent/60" : "border-line"
            }`}
          >
            <div className="flex items-center gap-3 sm:flex-col sm:items-start">
              <span className="font-display text-3xl font-extrabold tracking-tight">{stage.version}</span>
              <span
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-widest ${
                  current ? "border-accent text-accent" : "border-line-strong text-dim"
                }`}
              >
                {stage.status.toUpperCase()}
              </span>
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

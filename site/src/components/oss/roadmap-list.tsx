import type { RoadmapStage, RoadmapStatus } from "@/content/open-source";
import { Tag } from "@/components/primitives/tag";

/** The status each stage is tagged with (a Tag: line-strong outline, muted mono; never accent, never warn, §2.5). */
const statusLabel: Record<RoadmapStatus, string> = {
  shipped: "Shipped",
  preview: "Preview",
  planned: "Planned",
};

/**
 * The roadmap as an ordered list of stages, V0 to V4 (DESIGN.md §3.8): the stage and its status tag on the left from
 * 640 px, its name, what it does and what each release added on the right. Static, calm: no stage is lit in accent, and
 * a stage in preview is told apart by its tag and a dashed border, not by colour alone.
 */
export function RoadmapList({ stages }: { stages: readonly RoadmapStage[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {stages.map((stage) => (
        <li
          key={stage.stage}
          className={`card grid gap-4 sm:grid-cols-12 sm:gap-6 ${stage.status === "preview" ? "border-dashed border-line-strong" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3 sm:flex-col sm:items-start">
            <p className="font-display text-display-m text-fg">
              <span className="sr-only">Stage </span>
              {stage.stage}
            </p>
            <Tag>{statusLabel[stage.status]}</Tag>
            {stage.release ? <p className="font-mono text-mono text-dim">{stage.release}</p> : null}
          </div>
          <div className="flex flex-col gap-2 sm:col-span-9">
            <h3 className="font-display text-title font-bold text-fg">{stage.name}</h3>
            <p className="text-body text-muted">{stage.summary}</p>
            {stage.adds ? <p className="text-small text-muted">{stage.adds}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

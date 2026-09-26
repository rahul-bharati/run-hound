import { ChevronRight, TrendingUp } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Tasks completed and created per week, for the last 12 weeks (demo data). */
const COMPLETED = [18, 22, 19, 25, 27, 24, 30, 33, 29, 36, 38, 41] as const;
const CREATED = [24, 26, 28, 27, 31, 33, 30, 35, 38, 37, 40, 44] as const;

const CHART_NAME = "Tasks completed and created per week";

/** Monday of the current week, then the 11 weeks before it, oldest first. */
function weekStarts(count: number): Date[] {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: count }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (count - 1 - i)));
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const HEIGHT = 240;
// right leaves room for half of a centred week label ("Sep 21") past the last point.
const MARGIN = { top: 12, right: 20, bottom: 28, left: 32 };

/** Series colours: validated for CVD separation and contrast against the card in each theme (see the dataviz notes). */
const SERIES_VARS = "[--series-done:#009966] [--series-new:#0084d1] dark:[--series-done:#00ae77] dark:[--series-new:#009ad8]";

export function ThroughputChart({ className }: { className?: string }) {
  const summaryId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  // Measured before paint, so the SVG is drawn at the card's real width (text never scales).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const weeks = useMemo(() => weekStarts(COMPLETED.length), []);
  const labels = weeks.map((d) => shortDate.format(d));
  const n = COMPLETED.length;
  const last = n - 1;
  const change = Math.round(((COMPLETED[last]! - COMPLETED[last - 1]!) / COMPLETED[last - 1]!) * 100);

  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const yMax = 50;
  const yTicks = [0, 10, 20, 30, 40, 50];
  const x = (i: number) => MARGIN.left + (i / (n - 1)) * innerW;
  const y = (v: number) => MARGIN.top + innerH - (v / yMax) * innerH;
  const path = (values: readonly number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const donePath = path(COMPLETED);
  const areaPath = `${donePath} L${x(last).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const labelEvery = innerW / n >= 52 ? 1 : innerW / n >= 30 ? 2 : 3;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * (n - 1);
    setActive(Math.min(last, Math.max(0, Math.round(rel))));
  };

  const total = COMPLETED.reduce((a, b) => a + b, 0);
  const best = Math.max(...COMPLETED);
  const bestIndex = COMPLETED.indexOf(best as (typeof COMPLETED)[number]);
  const summary = `Your team completed ${COMPLETED[last]} tasks in the week of ${labels[last]}, up from ${COMPLETED[0]} in the week of ${labels[0]}. ${CREATED[last]} new tasks came in that week, so completions are keeping pace with new work.`;

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CardTitle as="h2" className="text-lg">
            Team throughput
          </CardTitle>
          <Badge variant="success" className="gap-1 py-1">
            <TrendingUp aria-hidden="true" />+{change}% this week
          </Badge>
        </div>
        <CardDescription id={summaryId}>{summary}</CardDescription>
      </CardHeader>
      <CardContent className={cn("grid grid-cols-1 gap-3", SERIES_VARS)}>
        <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-4 rounded-[3px] border-t-2 border-(--series-done) bg-(--series-done)/15" />
            Completed
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-(--series-new)" />
            Created
          </li>
        </ul>

        <div ref={boxRef} className="relative w-full">
          <svg
            role="img"
            aria-label={CHART_NAME}
            aria-describedby={summaryId}
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="block max-w-full overflow-visible"
          >
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={MARGIN.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            {labels.map((label, i) =>
              i % labelEvery === (last % labelEvery) ? (
                <text key={label} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {label}
                </text>
              ) : null,
            )}

            <path d={areaPath} fill="var(--series-done)" fillOpacity={0.12} />
            <path d={donePath} fill="none" stroke="var(--series-done)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={path(CREATED)} fill="none" stroke="var(--series-new)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

            {active !== null && (
              <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={y(0)} className="stroke-muted-foreground/60" strokeWidth={1} shapeRendering="crispEdges" />
            )}
            {(active === null ? [last] : [active]).map((i) => (
              <g key={i}>
                <circle cx={x(i)} cy={y(CREATED[i]!)} r={4} fill="var(--series-new)" className="stroke-card" strokeWidth={2} />
                <circle cx={x(i)} cy={y(COMPLETED[i]!)} r={4} fill="var(--series-done)" className="stroke-card" strokeWidth={2} />
              </g>
            ))}
            <rect
              x={MARGIN.left - 12}
              y={MARGIN.top}
              width={innerW + 24}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setActive(null)}
            />
          </svg>

          {active !== null && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-10 w-40 rounded-xl border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-xl"
              style={{ left: Math.min(Math.max(x(active) - 80, 0), width - 160) }}
            >
              <p className="text-xs text-muted-foreground">Week of {labels[active]}</p>
              <p className="mt-1 flex items-center gap-2">
                <span className="h-0.5 w-3 rounded-full bg-(--series-done)" />
                <strong className="font-semibold tabular-nums">{COMPLETED[active]}</strong>
                <span className="text-muted-foreground">completed</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="h-0.5 w-3 rounded-full bg-(--series-new)" />
                <strong className="font-semibold tabular-nums">{CREATED[active]}</strong>
                <span className="text-muted-foreground">created</span>
              </p>
            </div>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-2 rounded-2xl border bg-muted/40 p-3 sm:gap-4 sm:p-4">
          {[
            { label: "Completed in 12 weeks", value: String(total) },
            { label: "Average a week", value: String(Math.round(total / n)) },
            { label: "Best week", value: `${best} · ${labels[bestIndex]}` },
          ].map((m) => (
            <div key={m.label} className="flex min-w-0 flex-col justify-between gap-1">
              <dt className="text-xs text-muted-foreground">{m.label}</dt>
              <dd className="text-lg font-semibold tracking-tight sm:text-xl">{m.value}</dd>
            </div>
          ))}
        </dl>

        <details className="group rounded-xl">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-primary outline-hidden select-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
            Show chart data
          </summary>
          <Table className="mt-2">
            <TableCaption className="mt-2 text-left">Tasks completed and created per week, oldest first.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Week of</TableHead>
                <TableHead scope="col" className="text-right">
                  Completed
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels.map((label, i) => (
                <TableRow key={label}>
                  <TableCell className="py-2">{label}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{COMPLETED[i]}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{CREATED[i]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      </CardContent>
    </Card>
  );
}

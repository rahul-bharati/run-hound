/** Small presentational pieces shared by the dashboard and settings pages. */
import { CircleCheck, CirclePause, CirclePlay } from "lucide-react";
import type { ComponentProps } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Member, ProjectPriority, ProjectStatus } from "@/lib/api";
import { images } from "@/lib/images";
import { cn, initials } from "@/lib/utils";
import { priorityLabel, statusLabel } from "./constants";

const STATUS_STYLE = {
  active: { variant: "success", icon: CirclePlay },
  paused: { variant: "warning", icon: CirclePause },
  done: { variant: "secondary", icon: CircleCheck },
} as const;

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const { variant, icon: Icon } = STATUS_STYLE[status];
  return (
    <Badge variant={variant} className={cn("gap-1.5 py-1", className)}>
      <Icon aria-hidden="true" />
      {statusLabel(status)}
    </Badge>
  );
}

export const PRIORITY_LEVEL = { low: 1, medium: 2, high: 3 } as const;

/**
 * A three-bar meter (decorative: the label next to it says the priority). Unlit bars stay visible but faint, so
 * "Low" reads as one of three bars rather than a stray dot, which is what lucide's Signal icons look like at 16px.
 */
export function PriorityBars({ level, className }: { level: 1 | 2 | 3; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cn("size-4 shrink-0", className)}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 5} y={10 - i * 4} width={3} height={4 + i * 4} rx={1} fill="currentColor" opacity={i < level ? 1 : 0.22} />
      ))}
    </svg>
  );
}

export function PriorityLabel({ priority, className }: { priority: ProjectPriority; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", priority === "high" ? "font-medium text-foreground" : "text-muted-foreground", className)}>
      <PriorityBars level={PRIORITY_LEVEL[priority]} className={priority === "high" ? "text-primary" : undefined} />
      {priorityLabel(priority)}
    </span>
  );
}

/** A member's portrait. Decorative by default (alt=""): the name is always shown next to it. */
export function MemberAvatar({ member, className, alt = "", ...props }: { member: Pick<Member, "name" | "avatar"> | undefined; alt?: string } & ComponentProps<typeof Avatar>) {
  const image = member && typeof member.avatar === "number" ? images.avatars[member.avatar] : undefined;
  return (
    <Avatar className={cn("size-8", className)} {...props}>
      {image && <AvatarImage src={image.src} alt={alt} width={image.width} height={image.height} />}
      <AvatarFallback aria-hidden="true">{member ? initials(member.name) : "?"}</AvatarFallback>
    </Avatar>
  );
}

/** A tiny decorative trend line for stat cards (aria-hidden; the card's text carries the numbers). */
export function Sparkline({ values, className }: { values: readonly number[]; className?: string }) {
  const w = 96;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-24 overflow-visible", className)}>
      <path d={`${line} L${w},${h} L0,${h} Z`} className="fill-primary/10" />
      <path d={line} className="fill-none stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={3} className="fill-primary stroke-card" strokeWidth={2} />
    </svg>
  );
}

/** Days from today (local) to a YYYY-MM-DD date: negative when past. */
export function daysUntil(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** "Due today", "in 3 days", "2 days ago". */
export function relativeDue(isoDate: string): string {
  const n = daysUntil(isoDate);
  if (Number.isNaN(n)) return "";
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n > 1) return `in ${n} days`;
  if (n === -1) return "1 day ago";
  return `${-n} days ago`;
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A landing section's eyebrow, h2 and lead paragraph. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  children,
  align = "center",
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      <p className="text-sm font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {children && <p className="mt-4 text-lg text-pretty text-muted-foreground">{children}</p>}
    </div>
  );
}

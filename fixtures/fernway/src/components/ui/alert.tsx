import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-xl border px-4 py-3 text-sm", {
  variants: {
    variant: {
      info: "border-info/30 bg-card text-foreground [&>svg]:text-info",
      success: "border-success/30 bg-accent text-accent-foreground [&>svg]:text-success",
      destructive: "border-destructive/40 bg-card text-foreground [&>svg]:text-destructive",
    },
  },
  defaultVariants: { variant: "info" },
});

const icons = { info: Info, success: CircleCheck, destructive: CircleAlert } as const;

/**
 * An inline message box. The role follows the variant unless given: `destructive` -> role="alert" (save errors,
 * "Email or password is incorrect"), `success` / `info` -> role="status" (confirmations). Render it only when there
 * is something to say (or keep an empty live region mounted and change its text).
 */
export function Alert({ className, variant = "info", role, children, ...props }: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const Icon = icons[variant ?? "info"];
  return (
    <div data-slot="alert" role={role ?? (variant === "destructive" ? "alert" : "status")} className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon aria-hidden="true" className="mt-0.5 size-4" />
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="alert-title" className={cn("font-semibold", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="alert-description" className={cn("text-muted-foreground", className)} {...props} />;
}

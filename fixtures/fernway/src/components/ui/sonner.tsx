import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";

/**
 * The app's single sonner toaster (rendered once in App.tsx), themed with the design tokens. Toasts are announced
 * politely by sonner's live region. Import `toast` from here or from "sonner".
 */
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-right"
      // Sonner names its live region "Notifications" by default; the app shell already has a "Notifications"
      // button and popover, so the toast region gets its own name.
      containerAriaLabel="Status messages"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "0.875rem",
        } as CSSProperties
      }
      toastOptions={{ classNames: { toast: "shadow-xl", description: "!text-muted-foreground" } }}
      {...props}
    />
  );
}

export { toast } from "sonner";

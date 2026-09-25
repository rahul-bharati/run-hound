import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Light/dark switch (CONTRACT.md): accessible name "Switch to dark theme" / "Switch to light theme",
 * aria-pressed = dark theme on.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Button type="button" variant="ghost" size="icon" aria-pressed={dark} onClick={toggleTheme} className={cn("rounded-full", className)}>
      {dark ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
      <span className="sr-only">{dark ? "Switch to light theme" : "Switch to dark theme"}</span>
    </Button>
  );
}

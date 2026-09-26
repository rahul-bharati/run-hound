import { Menu } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** In-page sections of the landing page (ids the landing page gives its sections). */
export const LANDING_SECTIONS = [
  { id: "features", label: "Features" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
] as const;

const navLink =
  "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Sticky glass header for the marketing pages (CONTRACT.md "/ Landing"): logo link "Fernway", nav links (Features,
 * Pricing, FAQ as in-page anchors on /), theme toggle, "Sign in" (/login) and "Get started" (/signup). Below md the
 * nav and account links move into a sheet opened by "Open menu".
 */
export function MarketingHeader({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className={cn("glass sticky top-0 z-40 border-b border-border/70", className)}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Logo to="/" />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          {LANDING_SECTIONS.map((s) => (
            <Link key={s.id} to={{ pathname: "/", hash: `#${s.id}` }} className={navLink}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          <Link to="/login" className={cn(navLink, "hidden sm:inline-flex")}>
            Sign in
          </Link>
          <Button asChild size="sm" className="hidden rounded-full px-4 sm:inline-flex">
            <Link to="/signup">Get started</Link>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="rounded-full md:hidden">
                <Menu aria-hidden="true" className="size-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="sm:max-w-xs">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription>Jump to a section or sign in.</SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
                {LANDING_SECTIONS.map((s) => (
                  <Link key={s.id} to={{ pathname: "/", hash: `#${s.id}` }} className={cn(navLink, "text-base")} onClick={() => setOpen(false)}>
                    {s.label}
                  </Link>
                ))}
                <Link to="/login" className={cn(navLink, "text-base")} onClick={() => setOpen(false)}>
                  Sign in
                </Link>
                <Button asChild className="mt-3 rounded-full">
                  <Link to="/signup" onClick={() => setOpen(false)}>
                    Get started
                  </Link>
                </Button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

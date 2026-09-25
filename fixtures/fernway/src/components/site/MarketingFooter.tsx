import type { ReactNode } from "react";
import { Link } from "react-router";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

const footerLink =
  "inline-flex min-h-6 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const COLUMNS: { title: string; links: { label: string; to: string | { pathname: string; hash: string } }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", to: { pathname: "/", hash: "#features" } },
      { label: "Pricing", to: { pathname: "/", hash: "#pricing" } },
      { label: "FAQ", to: { pathname: "/", hash: "#faq" } },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Create account", to: "/signup" },
      { label: "Sign in", to: "/login" },
      { label: "Set up a workspace", to: "/onboarding" },
    ],
  },
  {
    title: "Demo workspace",
    links: [
      { label: "Dashboard", to: "/app" },
      { label: "Settings", to: "/app/settings" },
    ],
  },
];

/**
 * Site footer: brand, link columns and an optional slot (`children`) for the landing page's Newsletter form,
 * rendered in its own column. Pages without a newsletter render it without children.
 */
export function MarketingFooter({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <footer className={cn("border-t border-border/70 bg-card/60", className)}>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_2fr] lg:px-8">
        <div className="flex flex-col gap-4">
          <Logo to="/" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Project planning for small studios: timelines, workloads and client updates in one calm place.
          </p>
          {children && <div className="mt-2 max-w-md">{children}</div>}
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-sm font-semibold text-foreground">{col.title}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to} className={footerLink}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="border-t border-border/70">
        <p className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted-foreground sm:px-6 lg:px-8">
          © {new Date().getFullYear()} Fernway Labs. A demo app for testing Run Hound; no real accounts or payments.
        </p>
      </div>
    </footer>
  );
}

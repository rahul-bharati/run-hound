import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import Dashboard from "@/pages/Dashboard";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";
import Onboarding from "@/pages/Onboarding";
import Settings from "@/pages/Settings";
import Signup from "@/pages/Signup";

/** The client-side routes (CONTRACT.md "Routes"); the server answers each with index.html and 200. */
export const ROUTES = ["/", "/signup", "/login", "/onboarding", "/app", "/app/settings"] as const;

/** Scrolls to the top on a new page, or to the element named by the hash (in-page anchors like /#pricing). */
function RouteEffects() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    // Wait a frame so the target page has rendered.
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);
  return null;
}

/** "Skip to content": the first tab stop on every page; every page has <main id="main" tabIndex={-1}>. */
function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden"
      onClick={(e) => {
        const main = document.getElementById("main");
        if (!main) return;
        e.preventDefault();
        main.focus();
        main.scrollIntoView({ block: "start" });
      }}
    >
      Skip to content
    </a>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <SkipLink />
          <RouteEffects />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/app" element={<Dashboard />} />
            <Route path="/app/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}

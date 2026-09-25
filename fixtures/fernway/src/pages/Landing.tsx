import { MarketingFooter } from "@/components/site/MarketingFooter";
import { MarketingHeader } from "@/components/site/MarketingHeader";
import { useDocumentTitle } from "@/lib/utils";
import { CtaBand } from "./landing/CtaBand";
import { Faq } from "./landing/Faq";
import { Features } from "./landing/Features";
import { Hero } from "./landing/Hero";
import { LogoCloud } from "./landing/LogoCloud";
import { NewsletterForm } from "./landing/NewsletterForm";
import { Pricing } from "./landing/Pricing";
import { Testimonials } from "./landing/Testimonials";

/**
 * "/": the marketing landing page (CONTRACT.md "/ Landing"). Forms in the DOM on load: Waitlist (hero) and
 * Newsletter (footer); the Demo form lives in the "Book a demo" dialog. Planted bugs: W01 (WaitlistForm), W02
 * (NewsletterForm).
 */
export default function Landing() {
  useDocumentTitle("Project planning for small studios");
  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-background">
      {/* Decorative backdrop behind the header and hero: gradient mesh plus a faint grid, fading out downwards. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[64rem] [mask-image:linear-gradient(to_bottom,black_65%,transparent)]">
        <div className="bg-mesh absolute inset-0" />
        <div className="bg-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      </div>
      <MarketingHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-hidden">
        <Hero />
        <LogoCloud />
        <Features />
        <Pricing />
        <Testimonials />
        <Faq />
        <CtaBand />
      </main>
      <MarketingFooter>
        <NewsletterForm />
      </MarketingFooter>
    </div>
  );
}

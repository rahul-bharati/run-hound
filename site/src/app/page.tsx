import { AppWindow, FlaskConical, Laptop, ScanSearch, ShieldCheck, SlidersHorizontal, Sparkles, UsersRound } from "lucide-react";
import { AiBuilt, Close, Start, Trust, Why } from "@/components/home/bands";
import { BookingsCrop } from "@/components/home/bookings-crop";
import { ChecksBand } from "@/components/home/checks-band";
import { HomeHero } from "@/components/home/home-hero";
import { HowItWorks } from "@/components/home/how-it-works";
import { JsonLd } from "@/components/json-ld";
import { screens } from "@/components/screens";
import { Sprite } from "@/components/sprite";
import { routeMetadata } from "@/lib/metadata";
import { graph, maintainerNode, routeNodes, softwareNode, websiteNode } from "@/lib/structured-data";
import MotionGate from "@/motion/motion-gate-loader";
import "@/components/home/home.css";

/** Title, description and canonical from the registry (content/routes/pages.ts, "home"). */
export const metadata = routeMetadata("home");

/**
 * The home page defines the site, its maintainer and the app (lib/structured-data.ts); every other page refers to
 * them by id. The app's screenshots are the plan and the report, the two screens that show what it does. The page
 * node comes from the registry, like every other page's.
 */
const structuredData = graph(
  websiteNode(),
  maintainerNode(),
  softwareNode({ screenshots: [screens.plan, screens.report] }),
  ...routeNodes("home"),
);

/**
 * The homepage (DESIGN.md §3.1): a pitch and a router in eight blocks. Every word is in content/home.ts; the run's facts
 * in content/hero-run.ts. The page's one SVG sprite holds the tick, the GitHub mark, the line hound and the eight icons
 * of the AI-built and trust bands (§2.9). The motion gate mounts the hero run and the scroll runtime after load plus
 * idle, only when motion is allowed (§4.4); without it, every figure is the finished frame the server rendered.
 */
export default function Home() {
  return (
    <>
      <Sprite
        github
        hound
        icons={{
          widgets: SlidersHorizontal,
          dialogs: AppWindow,
          accounts: UsersRound,
          fernway: FlaskConical,
          local: Laptop,
          guard: ShieldCheck,
          ai: Sparkles,
          evidence: ScanSearch,
        }}
      />
      <HomeHero />
      <Why />
      <HowItWorks crop={<BookingsCrop />} />
      <ChecksBand />
      <AiBuilt />
      <Trust />
      <Start />
      <Close />
      {/* Last in <main>: the RSC payload repeats this block near the end of the document, and gzip only reuses what
          it has seen in the last 32 KB, so here the repeat costs almost nothing (the §5.2 HTML budget). */}
      <JsonLd data={structuredData} />
      <MotionGate islands={["hero-run", "scroll"]} />
    </>
  );
}

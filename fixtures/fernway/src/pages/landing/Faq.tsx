import { LifeBuoy } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SectionHeading } from "./SectionHeading";

const QUESTIONS = [
  {
    q: "Is Fernway free during early access?",
    a: "Yes. Everyone who joins from the waitlist gets the Studio plan free for three months once their invite arrives. After that you pick a plan, or stay on Starter for free. No card is needed to start.",
  },
  {
    q: "How many people can join a workspace?",
    a: "Starter covers up to two people. Studio and Agency are billed per seat with no upper limit, and clients you invite to a portal never count as seats.",
  },
  {
    q: "Can our clients see their projects?",
    a: "Yes. A client portal shares one project's timeline, files and approvals on a private link, without giving the client access to anything else in your workspace.",
  },
  {
    q: "Can we import from spreadsheets or another tool?",
    a: "Import projects and tasks from a CSV file, or bring them over from Trello, Asana or Notion in a few clicks. Nothing is removed from the original tool.",
  },
  {
    q: "Where is our data stored?",
    a: "Workspace data is encrypted in transit and at rest, and you can export everything as CSV or JSON at any time. This demo keeps its data in memory and resets it when the server restarts.",
  },
];

/** FAQ (id="faq"): a five-item Radix Accordion, one item open at a time. */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-20">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8 lg:py-28">
        <div>
          <SectionHeading id="faq-heading" eyebrow="FAQ" title="Frequently asked questions" align="left">
            Everything teams ask before switching. Still curious? Book a demo and we'll walk you through it.
          </SectionHeading>
          <div className="mt-8 hidden items-center gap-3 rounded-2xl border bg-card p-4 text-sm shadow-soft lg:flex">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
              <LifeBuoy className="size-5" />
            </span>
            <p className="text-muted-foreground">
              <span className="block font-semibold text-foreground">Real people, fast answers</span>
              Our support team replies within four working hours.
            </p>
          </div>
        </div>
        <div className="rounded-2xl border bg-card px-5 shadow-soft sm:px-7">
          <Accordion type="single" collapsible>
            {QUESTIONS.map((item, i) => (
              <AccordionItem key={item.q} value={`faq-${i + 1}`}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionContent>{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}

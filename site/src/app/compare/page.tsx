import Link from "next/link";
import { Check, Contrast, X, type LucideIcon } from "lucide-react";
import {
  capabilities,
  compareJsonLd,
  comparePage,
  notYet,
  researchUrl,
  tools,
  type Mark,
} from "@/components/compare/data";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { Card, PageHeader, Section } from "@/components/layout";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata(comparePage);

const link = "text-accent underline underline-offset-4 hover:text-accent-strong";

// Calm marks: the mint accent for "yes", neutral greys otherwise. Never the fail colour: this page compares, it
// doesn't grade.
const marks: Record<Mark, { label: string; icon?: LucideIcon; className: string }> = {
  yes: { label: "Yes", icon: Check, className: "text-accent" },
  some: { label: "Partly", icon: Contrast, className: "text-muted" },
  no: { label: "No", icon: X, className: "text-dim" },
  unknown: { label: "Not covered by our research", className: "text-dim" },
};

/** Cell text, with `code` marks shown as code that never breaks across lines (a flag such as --plan-only). */
function CellText({ text }: { text: string }) {
  return text.split(/`([^`]*)`/).map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="whitespace-nowrap font-mono text-[0.9em]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/** A cell: its mark as an icon (named for screen readers), then what the research says, or the mark's name alone. */
function MarkCell({ mark, text, strong = false }: { mark: Mark; text?: string; strong?: boolean }) {
  const { label, icon, className } = marks[mark];
  if (!icon) {
    return (
      <span className="text-dim">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-2">
      <Icon icon={icon} size={16} className={`mt-1 ${className}`} />
      {text ? (
        <span className={strong ? "text-fg" : "text-muted"}>
          <span className="sr-only">{label}: </span>
          <CellText text={text} />
        </span>
      ) : (
        <span className={`font-medium ${strong || mark === "yes" ? "text-fg" : "text-muted"}`}>{label}</span>
      )}
    </span>
  );
}

/** The marks, explained once above the table. */
function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted" aria-label="Legend">
      {(Object.keys(marks) as Mark[]).map((mark) => {
        const { label, icon, className } = marks[mark];
        return (
          <li key={mark} className="flex items-center gap-2">
            {icon ? (
              <Icon icon={icon} size={16} className={className} />
            ) : (
              <span aria-hidden="true" className="w-4 text-center text-dim">
                —
              </span>
            )}
            {label}
          </li>
        );
      })}
    </ul>
  );
}

export default function ComparePage() {
  return (
    <>
      <JsonLd data={compareJsonLd()} />
      <PageHeader
        eyebrow="COMPARE"
        title={
          <>
            Run Hound vs Playwright, <span className="text-accent">axe-core and scanners.</span>
          </>
        }
        lede="Run Hound builds on Playwright and axe-core rather than replacing them, and it tests the running app, while the AI builders' own scanners mostly read the code. This page compares what each one checks, capability by capability, and says where they work together."
      >
        <p className="font-mono text-xs uppercase tracking-widest text-dim">
          As of release {site.version} ·{" "}
          <time dateTime={site.releasedIso} className="whitespace-nowrap text-muted">
            {site.released}
          </time>
        </p>
      </PageHeader>

      <Section
        id="at-a-glance"
        title="At a glance"
        intro={
          <>
            Capabilities only. What the table says about other tools comes from{" "}
            <a href={researchUrl} className={link}>
              our research
            </a>
            , with its sources linked below (it lists none for Lighthouse, WAVE or Burp); a dash means the research
            doesn&apos;t say.
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Legend />
          <p className="text-sm text-dim xl:hidden">Scroll the table sideways to see every tool.</p>
          {/* The table scrolls sideways inside this box, never the page. `relative` makes the box the containing
              block of the cells' screen-reader text (sr-only is absolutely positioned), so it is clipped here too
              instead of widening the page. */}
          <div
            role="region"
            aria-labelledby="compare-caption"
            tabIndex={0}
            className="relative overflow-x-auto rounded-2xl border border-line bg-surface"
          >
            <table className="w-full min-w-[68rem] border-collapse text-left text-[15px] leading-relaxed">
              <caption id="compare-caption" className="sr-only">
                What Run Hound, Playwright&apos;s test agents, accessibility rule engines, AI-builder scanners and external
                security scanners each do, as of release {site.version}
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 shadow-[1px_0_0_0_var(--color-line)] w-36 bg-surface px-4 py-4 align-bottom sm:w-48 font-mono text-xs font-normal tracking-widest text-dim sm:px-5"
                  >
                    CAPABILITY
                  </th>
                  <th scope="col" className="w-56 bg-accent/5 px-4 py-4 align-bottom sm:px-5">
                    <span className="font-display text-lg font-bold text-accent">{site.name}</span>
                  </th>
                  {tools.map((tool) => (
                    <th key={tool.id} scope="col" className="px-4 py-4 align-bottom font-semibold sm:px-5">
                      {tool.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capabilities.map((row) => (
                  <tr key={row.capability} className="border-b border-line-soft last:border-b-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 shadow-[1px_0_0_0_var(--color-line)] bg-surface px-4 py-4 align-top font-semibold text-fg sm:px-5"
                    >
                      {row.capability}
                    </th>
                    <td className="bg-accent/5 px-4 py-4 align-top sm:px-5">
                      <MarkCell mark="yes" text={row.runHound} strong />
                    </td>
                    {tools.map((tool) => (
                      <td key={tool.id} className="px-4 py-4 align-top sm:px-5">
                        <MarkCell {...row.cells[tool.id]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section
        id="tool-by-tool"
        title="Tool by tool"
        intro="What each one is for, what Run Hound adds, and how they fit together."
        className="bg-band"
      >
        <ul className="grid gap-5 lg:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool.id} id={tool.id} className="scroll-mt-28">
              <Card className="flex h-full flex-col gap-4">
                <h3 className="font-display text-2xl font-bold leading-snug">{tool.name}</h3>
                <p className="leading-relaxed text-muted">{tool.what}</p>
                <div className="flex flex-col gap-1.5">
                  <p className="font-mono text-xs tracking-widest text-accent">WHAT RUN HOUND ADDS</p>
                  <p className="leading-relaxed text-muted">{tool.adds}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="font-mono text-xs tracking-widest text-dim">TOGETHER</p>
                  <p className="leading-relaxed text-muted">{tool.together}</p>
                </div>
                <p className="mt-auto text-sm leading-relaxed text-dim">
                  {tool.sources.length > 1 ? "Sources: " : "Source: "}
                  {tool.sources.map((source, i) => (
                    <span key={source.href}>
                      {i > 0 ? ", " : ""}
                      <a href={source.href} className={link}>
                        {source.label}
                      </a>
                    </span>
                  ))}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="not-yet"
        title="What Run Hound doesn't do yet"
        intro={`Release ${site.version} tests one page of an app on your machine. So that the comparison isn't read as more than it is, this is what it doesn't do yet.`}
      >
        <Card className="max-w-3xl">
          <ul className="flex list-disc flex-col gap-3 pl-5 leading-relaxed text-muted marker:text-dim">
            {notYet.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
        <p className="max-w-3xl leading-relaxed text-muted">
          More in the{" "}
          <Link href="/faq/" className={link}>
            answers to common questions
          </Link>
          , the{" "}
          <Link href="/docs/#limitations" className={link}>
            known limitations
          </Link>{" "}
          and{" "}
          <Link href="/ai-built-apps/" className={link}>
            testing apps built with Lovable, Bolt and v0
          </Link>
          .
        </p>
      </Section>
    </>
  );
}

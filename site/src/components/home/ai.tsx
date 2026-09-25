import type { LucideIcon } from "lucide-react";
import { CheckCheck, Cpu, ListChecks, MessageSquareText, Sparkles, UserCheck } from "lucide-react";
import { ComingSoonBadge } from "@/components/button-link";
import { Icon } from "@/components/icon";

/**
 * The AI features that are planned but not built. Everything here is labelled "Coming soon" (docs/brand.md): the
 * preview uses no model and sends nothing to any AI provider.
 */
const features: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Sparkles,
    title: "AI planning",
    text: "A model reads the page you point Run Hound at and proposes scenarios the built-in checks don't cover, such as the paths a feature is meant to support and the ways people could break it. You approve each one before anything runs, just as you do today.",
  },
  {
    icon: MessageSquareText,
    title: "AI explanations",
    text: "Each finding explained in the terms of your own app, with a fix prompt written for the AI tool you build with. The evidence, the measured facts and the verdict stay exactly as the real check recorded them.",
  },
  {
    icon: Cpu,
    title: "Bring your own model",
    text: "Run a local model with Ollama, so nothing leaves your machine, or use a cloud provider: AWS Bedrock or any OpenAI-compatible endpoint. Opt-in, and off unless you switch it on.",
  },
];

/** Where a model will fit in a run: it proposes and explains; you and the real checks do the rest. */
const flow: { icon: LucideIcon; step: string; who: string; soon: boolean }[] = [
  { icon: Sparkles, step: "Proposes scenarios", who: "AI model", soon: true },
  { icon: UserCheck, step: "Approves the plan", who: "You", soon: false },
  { icon: ListChecks, step: "Decides pass or fail", who: "Real checks in a real browser", soon: false },
  { icon: CheckCheck, step: "Explains the finding", who: "AI model", soon: true },
];

export function AiComingSoon() {
  return (
    <div className="flex flex-col gap-10">
      <ul className="grid gap-5 md:grid-cols-3">
        {features.map((f) => (
          <li key={f.title} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <span className="grid size-10 place-items-center rounded-xl border border-line-strong text-accent" aria-hidden="true">
                <Icon icon={f.icon} size={20} />
              </span>
              <ComingSoonBadge />
            </div>
            <h3 className="font-display text-xl font-bold tracking-tight">{f.title}</h3>
            <p className="leading-relaxed text-muted">{f.text}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-5 rounded-2xl border border-line bg-bg-deep p-6 sm:p-8">
        <p className="font-mono text-xs tracking-widest text-dim">WHERE AI WILL FIT IN A RUN</p>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {flow.map((f, i) => (
            <li
              key={f.step}
              className={`flex flex-col gap-2 rounded-xl border p-4 ${f.soon ? "border-dashed border-line-strong" : "border-accent/40 bg-accent/5"}`}
            >
              <span className="flex items-center gap-2 font-mono text-xs tracking-widest text-dim">
                <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <span className={f.soon ? "text-dim" : "text-accent"}>{f.soon ? "COMING SOON" : "TODAY"}</span>
              </span>
              <span className="flex items-center gap-2 font-semibold">
                <Icon icon={f.icon} size={16} className={f.soon ? "text-muted" : "text-accent"} />
                {f.step}
              </span>
              <span className="text-sm text-muted">{f.who}</span>
            </li>
          ))}
        </ol>
        <p className="max-w-3xl leading-relaxed text-muted">
          <strong className="text-fg">What won&apos;t change:</strong> a model never decides whether something passed.
          Every verdict comes from a real check in a real browser, with the evidence to prove it. Findings that rely on
          judgement stay marked advisory. Until these features ship, the preview uses no model and sends nothing to any AI
          provider.
        </p>
      </div>
    </div>
  );
}

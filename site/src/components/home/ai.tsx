import type { LucideIcon } from "lucide-react";
import { CheckCheck, ListChecks, Lock, MessageSquareText, Route, Server, Sparkles, UserCheck } from "lucide-react";
import { Icon } from "@/components/icon";
import { aiScreens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { Tour, type TourTab } from "./tour";

// Full windows take the container width (as in See it run); the narrower crops are capped at 768 px.
const wide =
  "(min-width: 1280px) 1136px, (min-width: 1024px) calc(100vw - 144px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";
const narrow = "(min-width: 832px) 768px, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

/** The AI layer in the real web UI, from a run on Kennel with a 9B model on Ollama. */
const tabs: TourTab[] = [
  {
    id: "ai-settings",
    label: "Settings",
    title: "Pick your model, test it",
    text: "Settings → AI lists the models your server has. Here it's Ollama on the same machine with a 9B model: no API key, nothing leaves the laptop, and Test connection confirms it answers.",
    image: <Screenshot screen={aiScreens.settings} sizes={narrow} className="max-w-3xl" />,
  },
  {
    id: "ai-plan",
    label: "Plan review",
    title: "A reason for every scenario",
    text: "With Review with AI ticked, the model reads the redacted page structure and gives each built-in scenario a one-line reason for this page. The plan says which model reviewed it, and the checks are the same ones as without AI.",
    image: <Screenshot screen={aiScreens.plan} sizes={wide} />,
  },
  {
    id: "ai-suggested",
    label: "Suggested flows",
    title: "Extra flows, unticked until you choose",
    text: "Suggested by AI flows are built only from the fields and buttons Run Hound found, and you see every step before you run one. Each ends in a deterministic check, and what it finds is reported as advisory.",
    image: <Screenshot screen={aiScreens.suggested} sizes={narrow} className="max-w-3xl" />,
  },
  {
    id: "ai-explanation",
    label: "Explanation",
    title: "The finding, in plain words",
    text: "After the run, each finding gets an AI explanation and an Ask your AI prompt, below the built-in advice and labelled advisory. The verdict, severity and evidence are what the real check recorded.",
    image: <Screenshot screen={aiScreens.explanation} sizes={wide} />,
  },
];

/**
 * The optional AI layer shipped in 0.3.0 (docs/ai-spec.md): plan review, suggested flows and explanations with the
 * user's own model. Off by default, and a model never decides pass or fail (docs/brand.md).
 */
const features: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Sparkles,
    title: "Reviews the plan",
    text: "Your model reads the redacted structure of the page and recommends and ranks each built-in scenario, with a one-line reason you see in the plan. It never ticks a destructive scenario, and nothing is added, removed or reordered.",
  },
  {
    icon: Route,
    title: "Suggests extra flows",
    text: "Up to 5 flows the built-in checks don't cover, built only from the fields and buttons Run Hound found. Each ends in a deterministic check, is unticked until you choose it, and a failure is reported as advisory, with evidence and a Playwright test.",
  },
  {
    icon: MessageSquareText,
    title: "Explains findings",
    text: "After the run, each finding gets a plain-words AI explanation and a prompt for the AI tool you build with, shown beside the built-in text and labelled advisory. The evidence, facts and verdict stay as the real check recorded them.",
  },
];

const providers = ["Ollama", "LM Studio", "llama.cpp", "vLLM", "Any OpenAI-compatible endpoint", "Amazon Bedrock"];

/** Where a model fits in a run: it reviews, suggests and explains; you and the real checks do the rest. */
const flow: { icon: LucideIcon; step: string; who: string; ai: boolean }[] = [
  { icon: Sparkles, step: "Reviews the plan, suggests flows", who: "Your AI model", ai: true },
  { icon: UserCheck, step: "Approves the plan", who: "You", ai: false },
  { icon: ListChecks, step: "Decides pass or fail", who: "Real checks in a real browser", ai: false },
  { icon: CheckCheck, step: "Explains the finding", who: "Your AI model", ai: true },
];

export function AiSection() {
  return (
    <div className="flex flex-col gap-10">
      <ul className="grid gap-5 md:grid-cols-3">
        {features.map((f) => (
          <li key={f.title} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 sm:p-7">
            <span className="grid size-10 place-items-center rounded-xl border border-line-strong text-accent" aria-hidden="true">
              <Icon icon={f.icon} size={20} />
            </span>
            <h3 className="font-display text-xl font-bold tracking-tight">{f.title}</h3>
            <p className="leading-relaxed text-muted">{f.text}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-4">
        <Tour tabs={tabs} label="AI in the web UI" />
        <p className="font-mono text-xs tracking-widest text-dim">
          REAL SCREENSHOTS: A 9B MODEL ON OLLAMA, REVIEWING A RUN ON KENNEL
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 sm:p-7">
          <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-dim">
            <Icon icon={Server} size={16} className="text-accent" />
            BRING YOUR OWN MODEL
          </p>
          <ul className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <li key={p} className="rounded-full border border-line-strong px-3 py-1 text-sm text-muted">
                {p}
              </li>
            ))}
          </ul>
          <p className="leading-relaxed text-muted">
            Set it up in Settings → AI or with <code className="font-mono text-fg">--ai</code> on the command line.
            Bedrock takes a Bedrock API key, AWS access keys or an AWS profile, including IAM Identity Center (SSO)
            after <code className="font-mono text-fg">aws sso login</code>. Small local models work; if the model
            fails or times out, you get the built-in plan with a warning.
          </p>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 sm:p-7">
          <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-dim">
            <Icon icon={Lock} size={16} className="text-accent" />
            WHAT IS SENT
          </p>
          <p className="leading-relaxed text-muted">
            AI is <strong className="text-fg">off by default</strong>. When it&apos;s on, only redacted page structure
            goes to the model you configure: the page title and path, field labels and types, option labels, button names and the scenario list.
            Never typed values, cookies, response bodies or screenshots.
          </p>
          <p className="leading-relaxed text-muted">
            A local model needs nothing more. A remote endpoint is refused until you consent for that host. API keys
            stay on the server and never appear in the UI or reports.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5 rounded-2xl border border-line bg-bg-deep p-6 sm:p-8">
        <p className="font-mono text-xs tracking-widest text-dim">WHERE AI FITS IN A RUN</p>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {flow.map((f, i) => (
            <li
              key={f.step}
              className={`flex flex-col gap-2 rounded-xl border p-4 ${f.ai ? "border-dashed border-line-strong" : "border-accent/40 bg-accent/5"}`}
            >
              <span className="flex items-center gap-2 font-mono text-xs tracking-widest text-dim">
                <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <span className={f.ai ? "text-dim" : "text-accent"}>{f.ai ? "OPTIONAL" : "ALWAYS"}</span>
              </span>
              <span className="flex items-center gap-2 font-semibold">
                <Icon icon={f.icon} size={16} className={f.ai ? "text-muted" : "text-accent"} />
                {f.step}
              </span>
              <span className="text-sm text-muted">{f.who}</span>
            </li>
          ))}
        </ol>
        <p className="max-w-3xl leading-relaxed text-muted">
          <strong className="text-fg">Real checks still decide:</strong> a model never decides whether something
          passed. Every verdict comes from a real check in a real browser, with the evidence to prove it, and anything
          the model adds is marked advisory. With AI off, the plan, the run and the report are exactly what the built-in
          checks produce.
        </p>
      </div>
    </div>
  );
}

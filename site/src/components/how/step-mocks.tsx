import type { ReactNode } from "react";
import { StatusLabel, type Status } from "@/components/finding";

/** Frame shared by the small static mock panels on the How it works page. */
function MockPanel({ label, caption, children }: { label: string; caption: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-surface">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 font-mono text-xs tracking-widest text-dim">
        <span>{label}</span>
        <span>SAMPLE</span>
      </div>
      {children}
    </figure>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const tree = [
  { role: "heading", name: "Book a sitter", ok: true },
  { role: "textbox", name: "Pet name", ok: true },
  { role: "generic", name: "Dog (clickable, no role)", ok: false },
  { role: "textbox", name: "(no label) placeholder: Phone", ok: false },
  { role: "button", name: "Book", ok: true },
];

/** Step 1: browser crop with the accessibility tree the agent reads. */
export function ExploreMock() {
  return (
    <MockPanel
      label="EXPLORE · localhost:3000/book"
      caption="Sample: the agent reads the booking form's accessibility tree. Two elements stand out: a pet-type option with no role and a phone field with no label."
    >
      <div className="grid gap-4 bg-stage p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl bg-paper p-5 text-paper-ink" aria-hidden="true">
          <p className="font-display text-lg font-bold">Book a sitter</p>
          <p className="text-xs text-paper-muted">Pet name</p>
          <p className="flex h-9 items-center rounded-md border border-paper-line bg-white px-3 text-sm">Biscuit</p>
          <div className="flex gap-1.5">
            {["Dog", "Cat", "Other"].map((option) => (
              <span key={option} className="rounded-md border border-dashed border-paper-fail bg-white px-2.5 py-1.5 text-xs">
                {option}
              </span>
            ))}
          </div>
          <p className="flex h-9 items-center rounded-md border border-paper-line bg-white px-3 text-sm text-paper-muted">
            Phone
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] tracking-widest text-dim">ACCESSIBILITY TREE</p>
          <ul className="flex flex-col gap-1.5 font-mono text-xs">
            {tree.map((node) => (
              <li key={node.name} className="flex flex-col gap-0.5 rounded-md bg-surface-2 px-2.5 py-1.5">
                <span className={node.ok ? "text-muted" : "text-fail"}>{node.role}</span>
                <span className="break-words text-fg">{node.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MockPanel>
  );
}

const scenarios: { feature: string; items: { name: string; kind: "golden" | "danger"; priority: string }[] }[] = [
  {
    feature: "Booking form",
    items: [
      { name: "Book with valid details", kind: "golden", priority: "P1" },
      { name: "Double-click Book", kind: "danger", priority: "P1" },
      { name: "Server error on submit", kind: "danger", priority: "P1" },
      { name: "End date before start date", kind: "danger", priority: "P2" },
    ],
  },
  {
    feature: "Accessibility",
    items: [
      { name: "Complete with keyboard only", kind: "golden", priority: "P1" },
      { name: "Errors are announced", kind: "danger", priority: "P2" },
    ],
  },
];

/** Step 2: generated scenarios grouped by feature and prioritized. */
export function PlanMock() {
  return (
    <MockPanel
      label="PLAN · 6 SCENARIOS"
      caption="Sample plan: golden-path and danger-path scenarios grouped by feature, each with a priority."
    >
      <div className="flex flex-col gap-5 p-5">
        {scenarios.map((group) => (
          <div key={group.feature} className="flex flex-col gap-2">
            <p className="font-mono text-[11px] tracking-widest text-dim">{group.feature.toUpperCase()}</p>
            <ul className="flex flex-col gap-1.5">
              {group.items.map((item) => (
                <li
                  key={item.name}
                  className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm"
                >
                  <span>{item.name}</span>
                  <span className="flex shrink-0 gap-2 font-mono text-[11px] tracking-widest">
                    <span className={item.kind === "danger" ? "text-amber" : "text-pass"}>
                      {item.kind.toUpperCase()}
                    </span>
                    <span className="text-dim">{item.priority}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </MockPanel>
  );
}

const review = [
  { name: "Book with valid details", state: "keep" },
  { name: "Double-click Book", state: "keep" },
  { name: "Server error on submit", state: "keep" },
  { name: "Submit a real payment", state: "removed" },
  { name: "Complete with keyboard only", state: "keep" },
  { name: "Paste into confirm password", state: "added" },
] as const;

/** Step 3: the review screen. Decorative only; nothing here is interactive. */
export function ApproveMock() {
  return (
    <MockPanel
      label="APPROVE · YOUR REVIEW"
      caption="Sample review screen: five scenarios kept, one destructive scenario removed, one scenario added by the user, and an approve button. Nothing runs until the plan is approved."
    >
      <div className="flex flex-col gap-4 p-5">
        <ul className="flex flex-col gap-1.5">
          {review.map((item) => (
            <li
              key={item.name}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                item.state === "removed" ? "text-dim" : "bg-surface-2"
              }`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded border ${
                  item.state === "removed" ? "border-line-strong" : "border-amber bg-amber text-amber-ink"
                }`}
                aria-hidden="true"
              >
                {item.state === "removed" ? null : <CheckIcon />}
              </span>
              <span className={item.state === "removed" ? "line-through" : ""}>{item.name}</span>
              <span className="ml-auto font-mono text-[11px] tracking-widest">
                {item.state === "removed" ? <span className="text-dim">REMOVED</span> : null}
                {item.state === "added" ? <span className="text-amber">ADDED</span> : null}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4" aria-hidden="true">
          <span className="text-sm text-muted">5 scenarios · destructive actions off</span>
          <span className="rounded-full bg-amber px-4 py-2 text-sm font-semibold text-amber-ink">Approve and run</span>
        </div>
      </div>
    </MockPanel>
  );
}

const steps: { action: string; status: Status; evidence: string }[] = [
  { action: "Fill “Pet name” with Biscuit", status: "pass", evidence: "screenshot · console clean" },
  { action: "Click “Book” twice", status: "fail", evidence: "screenshot · 2 booking requests" },
  { action: "Reload the page", status: "pass", evidence: "screenshot · network log" },
  { action: "Tab to “Pet type”", status: "running", evidence: "capturing…" },
];

/** Step 4: approved scenarios running, with evidence captured at every step. */
export function ExecuteMock() {
  return (
    <MockPanel
      label="EXECUTE · STEP LOG"
      caption="Sample step log: each browser action records a screenshot, console output and network traffic. One step failed because clicking Book twice sent two booking requests."
    >
      <ol className="flex flex-col divide-y divide-line-soft">
        {steps.map((step, index) => (
          <li key={step.action} className="flex items-start gap-4 px-5 py-3.5">
            <span className="font-mono text-xs text-dim">{String(index + 1).padStart(2, "0")}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm">{step.action}</span>
              <span className="font-mono text-xs text-dim">{step.evidence}</span>
            </div>
            <StatusLabel status={step.status} />
          </li>
        ))}
      </ol>
    </MockPanel>
  );
}

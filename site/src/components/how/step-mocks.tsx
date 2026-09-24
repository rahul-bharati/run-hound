import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { StatusLabel, type Status } from "@/components/finding";
import { Icon } from "@/components/icon";

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
      caption="Sample: Run Hound reads the booking form's accessibility tree. Two elements stand out: a pet-type option with no role and a phone field with no label."
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

const scenarios: { group: string; items: { name: string; kind: "golden" | "danger"; records: number }[] }[] = [
  {
    group: "Accessibility",
    items: [
      { name: "Fill in and submit the form using only the keyboard", kind: "golden", records: 1 },
      { name: "Load the form on a 320 px wide screen", kind: "golden", records: 0 },
    ],
  },
  {
    group: "Features",
    items: [
      { name: "Load the form and complete it with valid data", kind: "golden", records: 1 },
      { name: "Submit while the server answers with an error", kind: "danger", records: 0 },
      { name: "Double-click submit", kind: "danger", records: 2 },
    ],
  },
  {
    group: "Security",
    items: [{ name: "Paste into password fields and check autofill hints", kind: "golden", records: 0 }],
  },
];

/** Step 2: scenarios under the three check groups, each tagged golden or danger. */
export function PlanMock() {
  return (
    <MockPanel
      label="PLAN · 6 OF 15 SCENARIOS"
      caption="Sample plan: scenarios listed under Accessibility, Features and Security, each tagged golden path or danger path, with the number of test records it may create."
    >
      <div className="flex flex-col gap-5 p-5">
        {scenarios.map((group) => (
          <div key={group.group} className="flex flex-col gap-2">
            <p className="font-mono text-[11px] tracking-widest text-dim">{group.group.toUpperCase()}</p>
            <ul className="flex flex-col gap-1.5">
              {group.items.map((item) => (
                <li
                  key={item.name}
                  className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm"
                >
                  <span>{item.name}</span>
                  <span className="flex shrink-0 gap-2 font-mono text-[11px] tracking-widest">
                    <span className={item.kind === "danger" ? "text-warn" : "text-pass"}>
                      {item.kind.toUpperCase()}
                    </span>
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
  { name: "Load the form and complete it with valid data", state: "keep" },
  { name: "Double-click submit", state: "keep" },
  { name: "Submit while the server answers with an error", state: "keep" },
  { name: "Click “Delete draft” (destructive)", state: "off" },
  { name: "Fill in and submit the form using only the keyboard", state: "keep" },
  { name: "Send far too much text and a broken body", state: "skipped" },
] as const;

/** Step 3: the review screen. Decorative only; nothing here is interactive. */
export function ApproveMock() {
  return (
    <MockPanel
      label="APPROVE · YOUR PICK"
      caption="Sample review screen: four scenarios ticked, one destructive scenario left off by default, one unticked by the user, and a Run approved checks button. Nothing runs until you press it."
    >
      <div className="flex flex-col gap-4 p-5">
        <ul className="flex flex-col gap-1.5">
          {review.map((item) => {
            const on = item.state === "keep";
            return (
              <li
                key={item.name}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${on ? "bg-surface-2" : "text-dim"}`}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded border ${
                    on ? "border-accent bg-accent text-accent-ink" : "border-line-strong"
                  }`}
                  aria-hidden="true"
                >
                  {on ? <Icon icon={Check} size={14} /> : null}
                </span>
                <span>{item.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tracking-widest">
                  {item.state === "off" ? <span className="text-warn">OFF BY DEFAULT</span> : null}
                  {item.state === "skipped" ? <span className="text-dim">UNTICKED</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4" aria-hidden="true">
          <span className="text-sm text-muted">4 approved · destructive scenarios off</span>
          <span className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">Run approved checks</span>
        </div>
      </div>
    </MockPanel>
  );
}

const steps: { action: string; status: Status; evidence: string; time: string }[] = [
  { action: "Fill “Pet name” with a test value", status: "pass", evidence: "screenshot · console clean", time: "0.4 s" },
  { action: "Double-click “Book”", status: "fail", evidence: "2 POST /api/bookings · 2 records", time: "1.2 s" },
  { action: "Reload the page", status: "pass", evidence: "screenshot · network log", time: "0.8 s" },
  { action: "Tab to “Pet type”", status: "running", evidence: "capturing…", time: "…" },
];

/** Step 4: approved scenarios running group by group, with evidence and timing at every step. */
export function ExecuteMock() {
  return (
    <MockPanel
      label="RUN · FEATURES · 5 OF 15"
      caption="Sample step log: each browser action records a screenshot, console output, network traffic and how long it took. One step failed because clicking Book twice sent two booking requests."
    >
      <ol className="flex flex-col divide-y divide-line-soft">
        {steps.map((step, index) => (
          <li key={step.action} className="flex items-start gap-4 px-5 py-3.5">
            <span className="font-mono text-xs text-dim">{String(index + 1).padStart(2, "0")}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm">{step.action}</span>
              <span className="font-mono text-xs text-dim">{step.evidence}</span>
            </div>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <StatusLabel status={step.status} />
              <span className="font-mono text-[11px] text-dim">{step.time}</span>
            </span>
          </li>
        ))}
      </ol>
    </MockPanel>
  );
}

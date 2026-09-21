import { FindingCard, StatusLabel, type Status } from "@/components/finding";

const plan: { name: string; status: Status }[] = [
  { name: "Book with valid details", status: "pass" },
  { name: "Reload after booking", status: "pass" },
  { name: "Double-click Book", status: "fail" },
  { name: "Server error on submit", status: "fail" },
  { name: "Keyboard only", status: "running" },
  { name: "Errors announced", status: "queued" },
  { name: "Bundle secret scan", status: "queued" },
  { name: "Reflow at 320 px", status: "queued" },
];

/**
 * Static mockup of a Run Hound run: approved plan, the browser under test,
 * and findings so far. Sample data only.
 */
export function ProductWindow() {
  return (
    <figure className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[0_40px_80px_rgba(0,0,0,0.45)]">
      <figcaption className="sr-only">
        Sample Run Hound run on a booking form: 2 scenarios passed, 2 failed, the keyboard-only
        scenario is running and 3 are queued.
      </figcaption>

      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 font-mono text-xs text-dim sm:text-[13px]">
        <div className="flex gap-2" aria-hidden="true">
          <span className="size-[11px] rounded-full bg-line-strong" />
          <span className="size-[11px] rounded-full bg-line-strong" />
          <span className="size-[11px] rounded-full bg-line-strong" />
        </div>
        <span className="hidden truncate sm:block">run on localhost:3000/book</span>
        <span className="text-amber">running 5 / 8</span>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <div className="hidden flex-col gap-1.5 border-r border-line p-5 text-sm lg:flex">
          <p className="mb-2 font-mono text-xs text-dim">APPROVED PLAN</p>
          <ul className="flex flex-col gap-1.5">
            {plan.map((step) => (
              <li
                key={step.name}
                className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 ${
                  step.status === "running" ? "border border-amber bg-surface-3" : ""
                } ${step.status === "queued" ? "text-dim" : ""}`}
              >
                <span>{step.name}</span>
                <StatusLabel status={step.status} />
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-4 bg-stage p-5 sm:p-7">
          <p className="font-mono text-xs text-dim">BROWSER · step 4 of 7 · Tab</p>
          <div className="flex flex-1 flex-col gap-4 rounded-xl bg-paper p-6 text-paper-ink sm:p-8">
            <p className="font-display text-2xl font-bold">Book a sitter</p>
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] text-paper-muted">Pet name</p>
              <p className="flex h-11 items-center rounded-lg border-2 border-amber bg-white px-3.5 text-[15px]">
                Biscuit
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] text-paper-muted">Pet type</p>
              <div className="flex flex-wrap gap-2">
                {["Dog", "Cat", "Other"].map((option) => (
                  <span
                    key={option}
                    className="rounded-lg border border-dashed border-paper-fail bg-white px-4 py-2.5 text-sm"
                  >
                    {option}
                  </span>
                ))}
              </div>
            </div>
            <p className="font-mono text-xs text-paper-fail">Tab skipped the pet-type options</p>
            <span className="mt-auto flex h-11 w-40 items-center justify-center rounded-lg bg-paper-ink text-[15px] text-white">
              Book
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3.5 border-t border-line p-5 md:border-l md:border-t-0">
          <p className="font-mono text-xs text-dim">FINDINGS SO FAR</p>
          <FindingCard
            titleAs="p"
            category="Broken feature"
            severity="high"
            title="One click, two bookings"
            summary="The Book button stays active while sending."
          />
          <FindingCard
            titleAs="p"
            category="Broken feature"
            severity="medium"
            title="Errors vanish silently"
            summary="A server error leaves the spinner running forever."
          />
          <p className="mt-auto font-mono text-xs text-dim">each finding: screenshot · network log · .spec.ts</p>
        </div>
      </div>
    </figure>
  );
}

/**
 * On-page table of contents. Inline on small screens (two columns from sm), sticky beside the content on desktop.
 * `headingId` must be unique on the page; it names the navigation landmark.
 */
export function DocsToc({
  items,
  headingId = "docs-toc-heading",
  label = "On this page",
}: {
  items: readonly { id: string; label: string }[];
  headingId?: string;
  label?: string;
}) {
  return (
    <nav
      aria-labelledby={headingId}
      className="rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:border-0 lg:bg-transparent lg:p-0"
    >
      <p id={headingId} className="font-mono text-xs tracking-widest text-dim">
        {label.toUpperCase()}
      </p>
      <ol className="mt-3 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-line">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="-ml-px flex min-h-11 items-center border-l border-transparent py-1 text-[15px] leading-snug text-muted transition-colors hover:text-accent lg:min-h-9 lg:pl-4 lg:hover:border-accent"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

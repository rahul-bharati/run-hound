/** On-page table of contents. Inline on small screens, sticky beside the content on desktop. */
export function DocsToc({ items }: { items: readonly { id: string; label: string }[] }) {
  return (
    <nav
      aria-labelledby="docs-toc-heading"
      className="rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-28 lg:self-start lg:border-0 lg:bg-transparent lg:p-0"
    >
      <p id="docs-toc-heading" className="font-mono text-xs tracking-widest text-dim">
        ON THIS PAGE
      </p>
      <ol className="mt-3 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-line">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="-ml-px flex min-h-11 items-center border-l border-transparent text-[15px] text-muted hover:text-amber lg:pl-4 lg:hover:border-amber"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

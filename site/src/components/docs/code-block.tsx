/** Multi-line shell or config snippet. Scrolls sideways inside itself, never the page. */
export function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-bg-deep">
      <figcaption className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 font-mono text-[11px] tracking-widest text-dim">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
        {label.toUpperCase()}
      </figcaption>
      <pre tabIndex={0} role="region" aria-label={label} className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed text-fg">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

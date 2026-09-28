/**
 * A few lines of a config file to add to your own (vite.config.ts, next.config.ts): the code block's look (a labelled
 * bar, bg-deep, 13 px mono) without Copy or the "$" prompts, which are for commands (the CodeBlock primitive). It
 * scrolls sideways inside itself as a focusable region named by `label`, never the page, and stays out of the search
 * index like every code block (§3.16).
 */
export function ConfigBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="code-block" data-pagefind-ignore="">
      <div className="code-block-bar min-h-target-row">
        <span className="code-block-label">{label}</span>
      </div>
      <pre className="code-block-pre" tabIndex={0} role="region" aria-label={label}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

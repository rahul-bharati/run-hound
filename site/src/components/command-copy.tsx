"use client";

import { useState } from "react";

export function CommandCopy({ command, className = "" }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`flex max-w-full flex-col items-start gap-2 ${className}`}>
      <div className="flex w-full items-center gap-3 rounded-xl border border-line-strong bg-surface py-2 pl-4 pr-2 font-mono text-sm">
        <code className="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">
          <span className="text-accent" aria-hidden="true">
            ${" "}
          </span>
          {command}
        </code>
        <button
          type="button"
          onClick={copy}
          className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-xs font-medium text-muted hover:border-accent hover:text-accent"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? "Command copied to clipboard" : ""}
        </span>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ComingSoonBadge } from "@/components/button-link";

export function CommandCopy({
  command,
  comingSoon = false,
  className = "",
}: {
  command: string;
  comingSoon?: boolean;
  className?: string;
}) {
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
      {comingSoon ? <ComingSoonBadge /> : null}
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
          disabled={comingSoon}
          className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-xs font-medium text-muted enabled:hover:border-accent enabled:hover:text-accent disabled:cursor-not-allowed disabled:text-dim"
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

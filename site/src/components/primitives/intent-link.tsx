"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A link that prefetches only once the reader shows intent: a hover, a touch or keyboard focus. Next.js's documented
 * pattern (node_modules/next/dist/docs/01-app/02-guides/prefetching.md, "Hover-triggered prefetch"): prefetch={false}
 * until then, null (the default) after. NavLink uses it for prefetch="intent".
 */
export function IntentLink({ onMouseEnter, onTouchStart, onFocus, ...props }: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [active, setActive] = useState(false);
  return (
    <Link
      {...props}
      prefetch={active ? null : false}
      onMouseEnter={(event) => {
        setActive(true);
        onMouseEnter?.(event);
      }}
      onTouchStart={(event) => {
        setActive(true);
        onTouchStart?.(event);
      }}
      onFocus={(event) => {
        setActive(true);
        onFocus?.(event);
      }}
    />
  );
}

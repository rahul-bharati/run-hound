import Link from "next/link";
import { site } from "@/lib/site";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="text-amber"
    >
      <rect x="2" y="2" width="24" height="24" rx="7" />
      <path d="M8 11l4 3-4 3" />
      <path d="M15 18h5" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 font-display text-[22px] font-extrabold tracking-tight text-fg"
    >
      <LogoMark />
      <span>{site.name}</span>
    </Link>
  );
}

/**
 * Kennel's icons and illustrations, drawn inline so the page makes no extra requests.
 * Every graphic here is decorative (aria-hidden): names and labels always come from real text.
 * Icon paths are from Lucide (https://lucide.dev, ISC licence), copied from lucide-static 1.48.0.
 */

const ICONS = {
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  badgeCheck: (
    <>
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m16 9-5.5 5.5L8 12" />
    </>
  ),
  calendar: (
    <>
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 13h.01" />
      <path d="M12 13h.01" />
      <path d="M16 13h.01" />
      <path d="M8 17h.01" />
      <path d="M12 17h.01" />
    </>
  ),
  camera: (
    <>
      <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  cat: (
    <>
      <path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z" />
      <path d="M8 14v.5" />
      <path d="M16 14v.5" />
      <path d="M11.25 16.25h1.5L12 17l-.75-.75Z" />
    </>
  ),
  circleCheck: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m16 9-5.5 5.5L8 12" />
    </>
  ),
  circleAlert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  dog: (
    <>
      <path d="M11.25 16.25h1.5L12 17z" />
      <path d="M16 14v.5" />
      <path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309" />
      <path d="M8 14v.5" />
      <path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5" />
    </>
  ),
  heart: (
    <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
  ),
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  mail: (
    <>
      <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
      <rect x="2" y="4" width="20" height="16" rx="2" />
    </>
  ),
  notes: (
    <>
      <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
      <path d="M2 6h4" />
      <path d="M2 10h4" />
      <path d="M2 14h4" />
      <path d="M2 18h4" />
      <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
    </>
  ),
  paw: (
    <>
      <circle cx="11" cy="4" r="2" />
      <circle cx="18" cy="8" r="2" />
      <circle cx="20" cy="16" r="2" />
      <path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z" />
    </>
  ),
  phone: (
    <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
  ),
  rabbit: (
    <>
      <path d="M13 16a3 3 0 0 1 2.24 5" />
      <path d="M18 12h.01" />
      <path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3" />
      <path d="M20 8.54V4a2 2 0 1 0-4 0v3" />
      <path d="M7.612 12.524a3 3 0 1 0-1.6 4.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  save: (
    <>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
      <path d="M20 2v4" />
      <path d="M22 4h-4" />
      <circle cx="4" cy="20" r="2" />
    </>
  ),
  trash: (
    <>
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

/** A decorative 24x24 stroke icon; size it with CSS (width/height) or the `size` prop. */
export function Icon({ name, className, size = 20 }: { name: IconName; className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

/** Kennel's mark: a filled paw on a warm rounded square. */
export function PawLogo() {
  return (
    <svg aria-hidden="true" focusable="false" className="logo-mark" width="40" height="40" viewBox="0 0 40 40">
      <defs>
        <linearGradient id="kennel-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb923c" />
          <stop offset="1" stopColor="#c2410c" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#kennel-logo-bg)" />
      <g fill="#fffaf2">
        <ellipse cx="11.2" cy="16.4" rx="3" ry="3.9" transform="rotate(-24 11.2 16.4)" />
        <ellipse cx="16.8" cy="10.6" rx="3" ry="3.9" transform="rotate(-8 16.8 10.6)" />
        <ellipse cx="23.2" cy="10.6" rx="3" ry="3.9" transform="rotate(8 23.2 10.6)" />
        <ellipse cx="28.8" cy="16.4" rx="3" ry="3.9" transform="rotate(24 28.8 16.4)" />
        <path d="M20 17.6c-4.3 0-8.4 5.3-8.4 9.3 0 2.8 2.1 4.2 4.4 4.2 1.6 0 2.6-.8 4-.8s2.4.8 4 .8c2.3 0 4.4-1.4 4.4-4.2 0-4-4.1-9.3-8.4-9.3z" />
      </g>
    </svg>
  );
}

/** Hero illustration: a dog and a cat sharing a pet bed, with a few hearts and sparkles. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 360 280" width="360" height="280">
      <defs>
        <radialGradient id="kennel-art-glow" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0" stopColor="#fff7ed" />
          <stop offset="0.7" stopColor="#ffedd5" />
          <stop offset="1" stopColor="#fed7aa" />
        </radialGradient>
        <linearGradient id="kennel-art-bed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f97316" />
          <stop offset="1" stopColor="#c2410c" />
        </linearGradient>
      </defs>

      {/* backdrop */}
      <circle cx="184" cy="146" r="124" fill="url(#kennel-art-glow)" />
      <circle cx="306" cy="56" r="22" fill="#fde68a" />
      <circle cx="306" cy="56" r="32" fill="#fde68a" opacity="0.35" />
      <path d="M40 92c10-6 22-6 30 0" stroke="#fdba74" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M52 78c6-3 13-3 18 0" stroke="#fdba74" strokeWidth="4" fill="none" strokeLinecap="round" />

      {/* cat tail (behind everything) */}
      <path d="M290 214c34-4 44-36 30-58-6-10-18-8-16 2" stroke="#78716c" strokeWidth="13" fill="none" strokeLinecap="round" />

      {/* dog */}
      <ellipse cx="128" cy="200" rx="56" ry="42" fill="#d6955b" />
      <ellipse cx="128" cy="210" rx="30" ry="26" fill="#f3d2ad" />
      <ellipse cx="84" cy="124" rx="17" ry="33" transform="rotate(22 84 124)" fill="#8b5a2b" />
      <ellipse cx="172" cy="124" rx="17" ry="33" transform="rotate(-22 172 124)" fill="#8b5a2b" />
      <circle cx="128" cy="126" r="45" fill="#e3a86e" />
      <ellipse cx="146" cy="108" rx="15" ry="13" fill="#c98549" />
      <ellipse cx="128" cy="146" rx="24" ry="18" fill="#fbe3c8" />
      <circle cx="110" cy="116" r="5.5" fill="#2b1d14" />
      <circle cx="146" cy="112" r="5.5" fill="#2b1d14" />
      <circle cx="112" cy="114" r="1.8" fill="#ffffff" />
      <circle cx="148" cy="110" r="1.8" fill="#ffffff" />
      <ellipse cx="128" cy="137" rx="8.5" ry="6" fill="#2b1d14" />
      <path d="M128 143v6" stroke="#2b1d14" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M119 149c5 5 13 5 18 0" stroke="#2b1d14" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M123 151c0 9 10 9 10 0z" fill="#f472b6" />
      <path d="M92 168c22 14 50 14 72 0" stroke="#0f766e" strokeWidth="8" fill="none" strokeLinecap="round" />
      <circle cx="128" cy="180" r="7" fill="#fbbf24" stroke="#b45309" strokeWidth="2" />

      {/* cat */}
      <ellipse cx="250" cy="206" rx="46" ry="36" fill="#78716c" />
      <ellipse cx="250" cy="214" rx="24" ry="22" fill="#e7e5e4" />
      <path d="M216 136l4-44 30 26z" fill="#78716c" />
      <path d="M284 136l-4-44-30 26z" fill="#78716c" />
      <path d="M222 124l2-22 14 13z" fill="#fda4af" />
      <path d="M278 124l-2-22-14 13z" fill="#fda4af" />
      <circle cx="250" cy="146" r="40" fill="#8a837d" />
      <path d="M238 110c4 6 20 6 24 0" stroke="#6b645e" strokeWidth="4" fill="none" strokeLinecap="round" />
      <ellipse cx="250" cy="162" rx="18" ry="12" fill="#e7e5e4" />
      <ellipse cx="235" cy="144" rx="6" ry="7" fill="#fde68a" />
      <ellipse cx="265" cy="144" rx="6" ry="7" fill="#fde68a" />
      <ellipse cx="235" cy="144" rx="2.2" ry="5.6" fill="#2b1d14" />
      <ellipse cx="265" cy="144" rx="2.2" ry="5.6" fill="#2b1d14" />
      <path d="M245 155h10l-5 5z" fill="#fb7185" />
      <path d="M250 160c-2 5-8 6-11 3M250 160c2 5 8 6 11 3" stroke="#2b1d14" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M226 158h-18M227 164l-17 4M274 158h18M273 164l17 4" stroke="#57534e" strokeWidth="1.6" strokeLinecap="round" />

      {/* pet bed in front */}
      <rect x="44" y="216" width="276" height="44" rx="22" fill="url(#kennel-art-bed)" />
      <rect x="62" y="222" width="240" height="12" rx="6" fill="#fdba74" opacity="0.55" />

      {/* hearts and sparkles */}
      <g className="hearts">
        <path d="M196 60c-5-8-18-4-14 6 2 5 9 10 14 14 5-4 12-9 14-14 4-10-9-14-14-6z" fill="#fb7185" />
        <path d="M222 34c-3-5-11-2.5-8.5 3.6 1.2 3 5.5 6 8.5 8.4 3-2.4 7.3-5.4 8.5-8.4 2.5-6.1-5.5-8.6-8.5-3.6z" fill="#fda4af" />
      </g>
      <path d="M62 180l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#f59e0b" />
      <path d="M318 118l2.2 5.8 5.8 2.2-5.8 2.2-2.2 5.8-2.2-5.8-5.8-2.2 5.8-2.2z" fill="#f59e0b" />
      <g fill="#fdba74">
        <circle cx="30" cy="246" r="3" />
        <circle cx="36" cy="240" r="3" />
        <circle cx="43" cy="242" r="3" />
        <ellipse cx="37" cy="250" rx="5" ry="4" />
      </g>
    </svg>
  );
}

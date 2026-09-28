import { relative, sep } from "node:path";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tailwind from "eslint-plugin-tailwindcss";

const site = import.meta.dirname;

/**
 * The arbitrary Tailwind values (class names like px-[72px]) each file had when the redesign began, exactly as
 * eslint-plugin-tailwindcss 4.4.0's no-arbitrary-value finds them (28 September 2026, 0.6.0 at e2efe48; 136 in all). A
 * file may keep only these, each at most as often as it had it: a rewrite at the same path can't swap one for a new
 * value, and every other file, so every new component, may have none (DESIGN.md §5.2, ES1: values become tokens in
 * src/styles/tokens.css or classes in src/app/globals.css or a module beside the component). Grouped by the node that
 * rewrites the file (§5.4): a rewritten file reaches 0, and its entry is deleted when that node merges. Entries only
 * ever shrink. scripts/check-budgets.mjs keeps the build's own count of the whole of src/ (139) as the ratchet.
 */
export const arbitraryAllowance = {
  // P1 (the homepage)
  "src/app/page.tsx": [
    "bg-[radial-gradient(50%_60%_at_50%_100%,rgba(94,230,163,0.10),transparent_70%)]", "leading-[1.02]",
    "lg:grid-cols-[1.4fr_1fr]", "sm:grid-cols-[9.5rem_1fr]", "text-[15px]", "text-[15px]", "text-[15px]", "text-[15px]",
    "text-[15px]", "text-[15px]", "text-[15px]", "tracking-[-0.03em]", "tracking-[-0.03em]",
  ],
  "src/components/home/evidence.tsx": [
    "aspect-[16/10]", "lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]", "motion-safe:group-hover:scale-[1.015]",
    "text-[0.9em]", "text-[11px]", "text-[15px]",
  ],
  "src/components/home/groups.tsx": ["text-[11px]", "text-[15px]"],
  "src/components/home/hero.tsx": [
    "bg-[radial-gradient(60%_45%_at_50%_20%,rgba(94,230,163,0.09),transparent_70%)]", "leading-[0.98]",
    "lg:opacity-[0.1]", "lg:w-[980px]", "opacity-[0.06]", "sm:text-[13px]", "text-[11px]", "text-[12px]",
    "text-[14.5px]", "text-[2.6rem]", "tracking-[-0.03em]", "tracking-[0.18em]", "w-[760px]", "xl:text-[5rem]",
  ],
  "src/components/home/steps.tsx": [
    "shadow-[0_0_0_6px_rgba(94,230,163,0.08),0_0_32px_rgba(94,230,163,0.25)]", "text-[15px]",
  ],
  "src/components/home/tour.tsx": ["text-[15px]"],
  // H1 (header and footer)
  "src/components/site-footer.tsx": [
    "lg:px-[72px]", "lg:px-[72px]", "tracking-[-0.02em]", "xl:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]",
  ],
  "src/components/site-header.tsx": [
    "lg:px-[72px]", "text-[15px]", "text-[15px]", "text-[15px]", "w-[min(16rem,calc(100vw-2rem))]",
  ],
  // D1 (the docs hub)
  "src/app/docs/page.tsx": [
    "lg:grid-cols-[220px_minmax(0,1fr)]", "min-w-[34rem]", "text-[11px]", "text-[11px]", "text-[11px]", "text-[13px]",
    "text-[15px]", "text-[15px]", "text-[15px]", "text-[15px]", "text-[15px]", "text-[15px]", "text-[15px]",
  ],
  // C1 (the checks hub)
  "src/app/checks/page.tsx": [
    "leading-[1.1]", "lg:grid-cols-[1fr_1.5fr]", "sm:text-[2.5rem]", "text-[15px]", "text-[15px]", "text-[15px]",
    "text-[15px]", "text-[15px]",
  ],
  "src/components/checks/check-card.tsx": ["text-[11px]", "text-[11px]"],
  // F1 (open source, FAQ, compare)
  "src/app/compare/page.tsx": [
    "min-w-[68rem]", "shadow-[1px_0_0_0_var(--color-line)]", "shadow-[1px_0_0_0_var(--color-line)]", "text-[0.9em]",
    "text-[15px]",
  ],
  "src/app/faq/page.tsx": ["lg:grid-cols-[220px_minmax(0,1fr)]"],
  "src/app/open-source/page.tsx": [
    "min-w-[36rem]", "text-[15px]", "text-[15px]", "text-[15px]", "text-[15px]", "text-[15px]",
  ],
  "src/components/oss/roadmap-list.tsx": ["sm:grid-cols-[160px_minmax(0,1fr)]", "text-[11px]", "text-[15px]"],
  // F2 (how it works, demo, AI-built apps)
  "src/app/ai-built-apps/page.tsx": ["text-[13px]", "text-[15px]"],
  "src/app/demo/page.tsx": ["lg:grid-cols-[1.3fr_1fr]", "lg:grid-cols-[1.4fr_1fr]"],
  "src/app/how-it-works/page.tsx": [
    "leading-[1.1]", "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]", "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
    "sm:text-[2.5rem]",
  ],
  "src/components/demo/evidence-figure.tsx": ["text-[11px]"],
  "src/components/finding.tsx": [
    "text-[11px]", "text-[11px]", "text-[11px]", "text-[11px]", "text-[11px]", "text-[15px]", "text-[15px]",
    "text-[15px]",
  ],
  "src/components/screenshot.tsx": [
    "rounded-[14px]", "shadow-[0_40px_80px_-24px_rgba(0,0,0,0.75),0_0_0_1px_rgba(94,230,163,0.04)]",
  ],
  // F3 (404 and legal)
  "src/app/not-found.tsx": ["leading-[0.98]", "tracking-[-0.03em]"],
  "src/components/legal/legal.tsx": [
    "after:content-['#']", "leading-[1.02]", "lg:grid-cols-[220px_minmax(0,1fr)]", "max-w-[70ch]", "text-[15px]",
    "text-[2.5rem]", "tracking-[-0.03em]",
  ],
  // E1 deletes these once nothing imports them, or no node rewrites them
  "src/components/consent/consent.tsx": ["lg:px-[72px]", "text-[15px]", "text-[15px]"],
  "src/components/docs/callout.tsx": ["text-[15px]"],
  "src/components/docs/code-block.tsx": ["text-[11px]", "text-[13px]"],
  "src/components/docs/toc.tsx": ["lg:max-h-[calc(100vh-7rem)]", "text-[15px]"],
  "src/components/get-started.tsx": ["text-[15px]", "text-[15px]", "text-[15px]"],
  "src/components/layout.tsx": [
    "leading-[0.98]", "leading-[1.1]", "lg:opacity-[0.07]", "lg:px-[72px]", "opacity-[0.05]", "sm:text-[2.5rem]",
    "text-[10px]", "text-[2.75rem]", "tracking-[-0.03em]", "tracking-[0.18em]",
  ],
  "src/components/logo.tsx": ["text-[22px]", "tracking-[-0.02em]"],
};

/**
 * site/arbitrary-values: eslint-plugin-tailwindcss's no-arbitrary-value, with each file's findings checked off against
 * its allowance above. The plugin's rule finds the values (className attributes, template literals, clsx-style calls,
 * with their variants); this reports each one that isn't left in the file's allowance.
 */
const arbitraryValues = {
  meta: {
    type: "problem",
    docs: { description: "Only the arbitrary Tailwind values a file had when the redesign began (none in new files)." },
    schema: [{ type: "object", properties: { allowance: { type: "object" } }, additionalProperties: false }],
  },
  create(context) {
    const found = [];
    // The plugin's rule, reporting into `found` instead of to ESLint; everything else it reads comes from the real context.
    const collecting = Object.create(context, { report: { value: (descriptor) => found.push(descriptor) } });
    const listeners = tailwind.rules["no-arbitrary-value"].create(collecting);
    const file = relative(site, context.filename).split(sep).join("/");
    const allowed = context.options[0]?.allowance?.[file] ?? [];
    return {
      ...listeners,
      "Program:exit"(node) {
        listeners["Program:exit"]?.(node);
        const left = new Map();
        for (const value of allowed) left.set(value, (left.get(value) ?? 0) + 1);
        for (const { loc, node: at, data } of found) {
          const value = data?.className;
          if (left.get(value) > 0) {
            left.set(value, left.get(value) - 1);
            continue;
          }
          const why = allowed.length === 0 ? "none is allowed here" : `this file may keep only the ${allowed.length} it had when the redesign began`;
          context.report({
            ...(loc ? { loc } : { node: at }),
            message: `Arbitrary value '${value}': ${why}. Use a token (src/styles/tokens.css) or a component class (src/app/globals.css, or a *.module.css beside the component).`,
          });
        }
      },
    };
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts"],
    plugins: { site: { rules: { "arbitrary-values": arbitraryValues } }, tailwindcss: tailwind },
    settings: {
      tailwindcss: {
        cssConfigPath: "./src/app/globals.css",
        // The plugin's default class-joining functions (README, 4.4.0), and the site's own cx() (primitives/class-names.ts),
        // whose arguments would otherwise escape the rule.
        functions: ["classnames", "classNames", "clsx", "cn", "ctl", "cva", "tv", "tw", "twMerge", "twJoin", "cx"],
      },
    },
    rules: { "site/arbitrary-values": ["error", { allowance: arbitraryAllowance }] },
  },
  // GSAP (and @gsap/react) is imported only in src/motion/, which loads it after the page has loaded and only when
  // motion is allowed (DESIGN.md §4.4); scripts/check-budgets.mjs bans it from every initial chunk too.
  {
    files: ["src/**/*.{ts,tsx,mts,js,mjs}"],
    ignores: ["src/motion/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["gsap", "gsap/*", "@gsap/*"], message: "GSAP is imported only in src/motion/ (DESIGN.md §4.4)." }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Build output of a dev server started with another root (e.g. site/site/.next); never source.
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The search index pnpm build writes (scripts/pagefind.mjs; git-ignored): Pagefind's own bundled scripts.
    "public/pagefind/**",
  ]),
]);

export default eslintConfig;

import { Band, SectionHeading } from "@/components/primitives/layout";
import { ArrowLink } from "@/components/primitives/links";
import { NavLink } from "@/components/primitives/nav-link";
import { Tag } from "@/components/primitives/tag";
import { Tick } from "@/components/primitives/tick";
import { bandIndex, home } from "@/content/home";

/**
 * The three check cards (DESIGN.md §3.1 block 3, §4.3): each group's count in fg, its name as a mono label, its question
 * as an h3, four examples and "and N more". Each example is one check, named in the checks data's plain words and linked
 * to its page; the link is fg with a line-strong underline that turns accent on hover and focus. No card top bars: the
 * only accent at rest is the twelve small ticks (a 1.75 px stroke, below the accent budget's "strong").
 *
 * The scroll runtime's one-shot effect (effects/card-trace.ts) draws a dim trace round each card, which fades, and draws
 * the ticks; the cards and their words are there throughout. The traces rest hidden by class.
 */
export function CheckCards() {
  return (
    <ul className="hm-cards" data-motion="card-trace">
      {home.checks.groups.map((group) => (
        <li key={group.name} className="card hm-card">
          <svg className="hm-outline" aria-hidden="true">
            <rect className="hm-trace rest-hidden" data-part="trace" x="0.75" y="0.75" rx="16" />
          </svg>
          <p>
            <b>{group.count}</b>
            <span className="hm-label">{group.name}</span>
          </p>
          <h3>{group.question}</h3>
          <ul>
            {group.examples.map((example) => (
              <li key={example.check} className="tick-row">
                <Tick draw />
                <span>
                  <NavLink href={example.href} prefetch="intent">
                    {example.label}
                  </NavLink>
                  {example.tag ? <Tag>{example.tag}</Tag> : null}
                </span>
              </li>
            ))}
          </ul>
          <ArrowLink href={group.more.href} prefetch="intent">
            {group.more.label}
          </ArrowLink>
        </li>
      ))}
    </ul>
  );
}

/** Block 3, "26 checks: accessibility, features and security" (#checks). */
export function ChecksBand() {
  const checks = home.checks;
  return (
    <Band id={checks.id} index={bandIndex("checks")} labelledBy={`${checks.id}-title`}>
      <SectionHeading id={`${checks.id}-title`} title={checks.title} />
      <CheckCards />
      <p className="hm-links">
        <ArrowLink href={checks.all.href}>{checks.all.label}</ArrowLink>
      </p>
    </Band>
  );
}

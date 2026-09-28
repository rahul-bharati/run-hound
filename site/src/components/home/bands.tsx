import { Command } from "@/components/primitives/command";
import { ButtonLink } from "@/components/primitives/button-link";
import { IconTile } from "@/components/primitives/card";
import { FactStrip } from "@/components/primitives/fact-strip";
import { Band, Container, SectionHeading } from "@/components/primitives/layout";
import { ArrowLink } from "@/components/primitives/links";
import { NavLink } from "@/components/primitives/nav-link";
import { Tag } from "@/components/primitives/tag";
import { LineHound } from "@/components/hound/line-hound";
import { bandIndex, home } from "@/content/home";
import { ui } from "@/content/ui";

/** Links off the site say where they open, for screen readers ("(opens GitHub)"). */
const opens = (href: string) => (href.startsWith("https://github.com/") ? "GitHub" : undefined);

/**
 * Block 1, "AI builds fast. It ships holes too." (#why): three sourced numbers in one strip divided by hairlines, each
 * source linked. Static: nothing counts up (§4.1 rule 10).
 */
export function Why() {
  const why = home.why;
  return (
    <Band id={why.id} index={bandIndex("why")} labelledBy={`${why.id}-title`}>
      <SectionHeading id={`${why.id}-title`} title={why.title} />
      <ul className="hm-stats">
        {why.stats.map((stat) => (
          <li key={stat.value}>
            <b>{stat.value}</b>
            <p>{stat.text}</p>
            <p className="hm-label">
              <a href={stat.source.href}>{stat.source.label}</a>
            </p>
          </li>
        ))}
      </ul>
      <p className="hm-links">
        <ArrowLink href={why.link.href} opens="GitHub">
          {why.link.label}
        </ArrowLink>
      </p>
    </Band>
  );
}

/**
 * Block 4, "Works on Lovable, Bolt and v0 apps." (#ai-built-apps): the intro says what "your app" must be, then four
 * static cards with muted icon tiles (icons never draw themselves). The Signed-in runs card keeps #signed-in.
 */
export function AiBuilt() {
  const band = home.aiBuilt;
  return (
    <Band id={band.id} index={bandIndex("aiBuilt")} labelledBy={`${band.id}-title`}>
      <SectionHeading id={`${band.id}-title`} title={band.title} intro={band.intro} />
      <ul className="hm-grid4">
        {band.cards.map((card) => (
          <li key={card.title} id={"id" in card ? card.id : undefined} className="card">
            <IconTile icon={card.icon} />
            <div>
              <h3>
                {card.title}
                {"tag" in card && card.tag ? <Tag>{card.tag}</Tag> : null}
              </h3>
              <p>{card.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="hm-links">
        <ArrowLink href={band.link.href}>{band.link.label}</ArrowLink>
      </p>
    </Band>
  );
}

/**
 * Block 5, "Runs on your machine. Real checks decide." (#safety, on the tinted band): four items with muted icon
 * tiles. "AI is optional" keeps #ai.
 */
export function Trust() {
  const band = home.trust;
  return (
    <Band id={band.id} index={bandIndex("trust")} tone="band" labelledBy={`${band.id}-title`}>
      <SectionHeading id={`${band.id}-title`} title={band.title} />
      <ul className="hm-grid4">
        {band.items.map((item) => (
          <li key={item.title} id={"id" in item ? item.id : undefined}>
            <IconTile icon={item.icon} />
            <div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="hm-links">
        <ArrowLink href={band.link.href}>{band.link.label}</ArrowLink>
      </p>
    </Band>
  );
}

/**
 * Block 6, "Free and open source. Start with one command." (#start): the command with Copy and its next step, three
 * ways on (your app, the test lab, CI), each led by a link; then the project's links and the facts line.
 */
export function Start() {
  const band = home.start;
  return (
    <Band id={band.id} index={bandIndex("start")} labelledBy={`${band.id}-title`}>
      <SectionHeading id={`${band.id}-title`} title={band.title} />
      <div className="hm-start">
        <div className="hm-start-main">
          <Command command={band.command} next={ui.afterCopy} hint={band.hint} label={band.srOnly} />
          <ul className="hm-ways">
            {band.lines.map((line) => (
              <li key={line.lead.href}>
                <NavLink href={line.lead.href}>{line.lead.label}</NavLink>{" "}
                {"before" in line ? line.before : null}
                {"code" in line ? (
                  <>
                    {"before" in line ? " " : null}
                    <code>{line.code}</code>
                  </>
                ) : null}
                {"after" in line ? (line.after === "." ? line.after : ` ${line.after}`) : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="hm-start-side">
          <ul className="hm-start-links">
            {band.links.map((link) => (
              <li key={link.label}>
                <ArrowLink href={link.href} opens={opens(link.href)}>
                  {link.label}
                </ArrowLink>
              </li>
            ))}
          </ul>
          <FactStrip items={band.facts} />
        </div>
      </div>
    </Band>
  );
}

/**
 * Block 7, the close: the resting line hound (64 px, from 640 px; its one appearance on the page, static), the closing
 * h2 in Display L with its key words in accent (an exempt use), one line, and the two buttons.
 */
export function Close() {
  const close = home.close;
  const [primary, secondary] = close.buttons;
  return (
    <section className="hm-close" aria-labelledby="close-title">
      <Container className="hm-close-inner">
        <LineHound size={64} className="hm-hound" />
        <h2 id="close-title" className="hm-close-title">
          {close.title.lead}{" "}
          <span className="hm-key" data-accent-exempt="">
            {close.title.key}
          </span>
        </h2>
        <p className="hm-close-line">{close.line}</p>
        <div className="hm-actions hm-close-actions">
          <ButtonLink href={primary.href}>{primary.label}</ButtonLink>
          <ButtonLink href={secondary.href} variant="secondary" icon="github">
            {secondary.label}
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
